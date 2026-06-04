package com.tasfb2b.planificador.service;

/*
 * Sistema TASF.B2B — Motor de Optimización Logística
 * Grupo 4D — Curso de Proyecto de Diseño de Software
 * Autores: Jim Navarrete, Diego Silvestre, Jose Avalos, Mathias Medina
 * Fecha: Mayo 2026
 */

import com.tasfb2b.aeropuerto.domain.Aeropuerto;
import com.tasfb2b.aeropuerto.repository.AeropuertoRepository;
import com.tasfb2b.planificador.domain.CollapseEndCondition;
import com.tasfb2b.planificador.domain.Route;
import com.tasfb2b.planificador.domain.SimulationDayReport;
import com.tasfb2b.planificador.domain.Solution;
import com.tasfb2b.planificador.simulation.SimulationRunner;
import com.tasfb2b.planificador.simulation.SimulationState;
import com.tasfb2b.superlote.domain.SuperLot;
import com.tasfb2b.superlote.service.SuperLotService;
import com.tasfb2b.envio.service.EnvioService;
import com.tasfb2b.vuelo.domain.Vuelo;
import com.tasfb2b.vuelo.repository.VueloRepository;
import com.tasfb2b.planificador.strategy.NetworkAdapter;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Servicio de simulación multi-día con ejecución asíncrona y micro-batching.
 *
 * <p>Mejoras integradas de V2:
 * <ul>
 *   <li>Micro-batching: 48 ciclos/día (cada 30 min simulados) en vez de 1 plan/día</li>
 *   <li>Estado global persistente (SimulationState incremental via advanceTo)</li>
 *   <li>MapSnapshot volatile para sincronización thread-safe con WsPublisher</li>
 *   <li>Colapso informativo con condiciones de terminación configurables</li>
 *   <li>avgRouteLength calculado incrementalmente</li>
 *   <li>Log de profiling estructurado por ciclo</li>
 * </ul>
 *
 * <p>Mantiene del proyecto principal:
 * <ul>
 *   <li>Selección HGA / ALNS por parámetro</li>
 *   <li>Exportación MD y trazabilidad de algoritmo</li>
 *   </ul>
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class SimulationService {

        private final SimulationRunner simulator;
        private final HGAPlannerService planner;
        private final ALNSPlannerService alnsPlanner;
        private final AeropuertoRepository airportRepo;
        private final SuperLotService superLotService;
        private final SimulationProgressHolder progressHolder;
        private final EnvioService envioService;
        private final SimulationWsPublisher wsPublisher;
        private final CollapseHelper collapseHelper;
        private final VueloRepository vueloRepo;
        private final NetworkAdapter networkAdapter;

        @Value("${tasf.data.path}")
        private String dataPath;

        private static final int SA_MINUTES = 30;
        private static final int CYCLES_PER_DAY = 1440 / SA_MINUTES;

        private static final LocalDate DEFAULT_START_DATE = LocalDate.of(2026, 1, 1);
        /** Ventana de planificación por ciclo (ms). */
        private static final long PLANNER_WINDOW_MS = 500;
        /** Ventana para planificación HGA (una sola vez por día). */
        private static final long HGA_WINDOW_MS = 8_000L;

        public record WsEnvelope<T>(long seq, T data) {}

        /**
         * Inicia la simulación en el pool {@code simulationExecutor}.
         * El controlador responde HTTP 202 inmediatamente con el UUID de sesión.
         */
        @Async("simulationExecutor")
        public void runAsync(String sessionId, int dias, String algorithm, LocalDate startDate, int playbackMinutes, String preCancelledFlightIds) {
                SimulationProgressHolder.SimulationSessionState session = progressHolder.get(sessionId);
                if (session == null) return;

                LocalDate fechaInicio = (startDate != null) ? startDate : DEFAULT_START_DATE;

                try {
                        long startEpochMs = fechaInicio.atStartOfDay()
                                .toInstant(ZoneOffset.UTC).toEpochMilli();
                        session.setStartEpoch(startEpochMs);

                        List<SimulationDayReport> reports = runFullSimulation(
                                dias, session, algorithm, fechaInicio, playbackMinutes, preCancelledFlightIds);
                        session.getReports().addAll(reports);

                        int totalAttended = reports.stream().mapToInt(SimulationDayReport::getMalatetasAtendidas).sum();
                        int totalDemand   = reports.stream().mapToInt(SimulationDayReport::getTotalMaletas).sum();
                        int totalMissed   = totalDemand - totalAttended;
                        double slaFinal   = totalDemand == 0 ? 0 : (totalAttended * 100.0) / totalDemand;

                        session.setTotalAttended(totalAttended);
                        session.setTotalMissed(totalMissed);
                        session.setSlaFinal(slaFinal);
                        session.setSlaPercent(slaFinal);

                        Map<String, Object> metrics = new HashMap<>();
                        metrics.put("deliveredOnTime",  totalAttended);
                        metrics.put("totalDeliveries",  totalDemand);
                        metrics.put("slaPercent",        slaFinal);
                        metrics.put("avgRouteLength",    Math.round(session.getAvgRouteLength() * 10.0) / 10.0);
                        metrics.put("replanifications",  session.getRescuedFlights());
                        metrics.put("execTime",          "Completado");
                        metrics.put("rescuedFlights",    session.getRescuedFlights());

                        progressHolder.saveAlgorithmResult(algorithm != null ? algorithm : "HGA", metrics);
                        progressHolder.markDone(sessionId);

                        wsPublisher.pushImmediate(sessionId, session);

                } catch (Exception ex) {
                        log.error("Simulation failed", ex);
                        progressHolder.markFailed(sessionId, ex.getMessage());
                        wsPublisher.pushImmediate(sessionId, session);
                }
        }

        // ── SIMULACIÓN PRINCIPAL CON MICRO-BATCHING ─────────────────────────

        public record PreCancellation(Long flightId, Integer day) {}

        private List<SimulationDayReport> runFullSimulation(
                        int dias,
                        SimulationProgressHolder.SimulationSessionState session,
                        String algorithm,
                        LocalDate fechaInicio,
                        int playbackMinutes,
                        String preCancelledFlightIds) {

                // Parsear pre-cancelaciones (ej: 5:2, 12, 15:all)
                List<PreCancellation> preCancellations = new ArrayList<>();
                if (preCancelledFlightIds != null && !preCancelledFlightIds.isBlank()) {
                        for (String entry : preCancelledFlightIds.split(",")) {
                                try {
                                        entry = entry.trim();
                                        if (entry.contains(":")) {
                                                String[] parts = entry.split(":");
                                                Long fId = Long.parseLong(parts[0].trim());
                                                String dayPart = parts[1].trim();
                                                Integer dNum = null;
                                                if (!"all".equalsIgnoreCase(dayPart)) {
                                                        dNum = Integer.parseInt(dayPart);
                                                }
                                                preCancellations.add(new PreCancellation(fId, dNum));
                                        } else {
                                                Long fId = Long.parseLong(entry);
                                                preCancellations.add(new PreCancellation(fId, null));
                                        }
                                } catch (Exception ignored) {}
                        }
                }

                // Restaurar todos los vuelos al empezar para limpiar remanentes de otras simulaciones
                restaurarVuelosEnBD();

                Map<String, Aeropuerto> airportMap = airportRepo.findAll().stream()
                                .collect(Collectors.toMap(Aeropuerto::getIcaoCode, a -> a));

                List<SimulationDayReport> history = new ArrayList<>();
                long currentTime = fechaInicio.atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli();
                List<SuperLot> pendientes = new ArrayList<>();
                List<Route> inTransitRoutes = new ArrayList<>();

                // Acumuladores para avgRouteLength (calculado incrementalmente)
                long totalFlightLegs = 0;
                long totalRoutesWithFlights = 0;

                // Estado global persistente multi-día
                Solution masterSolution = new Solution();
                masterSolution.setRoutes(new ArrayList<>());

                SimulationState globalState = new SimulationState(
                        new ArrayList<>(airportMap.values()),
                        new ArrayList<>(),
                        currentTime
                );

                boolean hubsReduced = false;
                boolean useHga = !"alns".equalsIgnoreCase(algorithm);

                for (int day = 0; day < dias; day++) {

                        LocalDate fechaDia = fechaInicio.plusDays(day);

                        // Si es un nuevo día (day > 0), restaurar vuelos cancelados del día anterior
                        if (day > 0) {
                                restaurarVuelosEnBD();
                        }

                        // Aplicar pre-cancelaciones correspondientes al día actual (day es 0-indexed, día simulado es day + 1)
                        final int currentDayNum = day + 1;
                        List<Long> currentDayCancellations = preCancellations.stream()
                                        .filter(pc -> pc.day() == null || pc.day() == currentDayNum)
                                        .map(PreCancellation::flightId)
                                        .toList();

                        if (!currentDayCancellations.isEmpty()) {
                                List<Vuelo> preCancelados = vueloRepo.findAllByIdWithAirports(currentDayCancellations);
                                preCancelados.forEach(v -> v.setCancelled(true));
                                vueloRepo.saveAll(preCancelados);
                                networkAdapter.invalidateGraph();
                                log.info("[SimulationService] Aplicando {} vuelo(s) pre-cancelado(s) para el Día {}.", preCancelados.size(), currentDayNum);
                                for (Vuelo vf : preCancelados) {
                                        session.getEventLog().add(String.format(
                                                "[Pre-sim] 🚨 Vuelo %d (%s -> %s) PRE-CANCELADO para el Día %d.",
                                                vf.getId(), vf.getOrigen().getIcaoCode(), vf.getDestino().getIcaoCode(), currentDayNum));
                                }
                        }

                        // Sliding window: cargar solo envíos de este día
                        envioService.cargarPorDia(fechaDia, dataPath);

                        // Purgar datos de hace 3+ días para liberar heap
                        if (day >= 3) {
                                envioService.purgarAntesDe(fechaInicio.plusDays(day - 2));
                        }

                        List<SuperLot> lotsDelDia = new ArrayList<>(pendientes);
                        lotsDelDia.addAll(superLotService.agruparEnviosPorFecha(fechaDia));

                        // Registro de vuelos cancelados y procesados para el día actual
                        Set<Long> processedCancelledFlightIds = new HashSet<>();

                        // Reducción de hubs una sola vez al entrar en modo colapso
                        if (session.isCollapseMode() && !hubsReduced) {
                                collapseHelper.reduceHubCapacity(airportMap);
                                hubsReduced = true;
                        }

                        long sleepPerCycleMs = computeSleepPerCycleMs(dias, playbackMinutes);

                        // ── MICRO-BATCHING: 48 ciclos por día ──────────────────
                        for (int cycle = 0; cycle < CYCLES_PER_DAY; cycle++) {
                                long currentSimTime = currentTime + ((long) cycle * SA_MINUTES * 60_000L);
                                long nextSimTime = currentSimTime + (SA_MINUTES * 60_000L);

                                int simHour   = (cycle * SA_MINUTES) / 60;
                                int simMinute = (cycle * SA_MINUTES) % 60;
                                String simulatedTimeStr = String.format("Día %d - %02d:%02d", day + 1, simHour, simMinute);

                                int currentPercent = (int)(
                                        ((day * (double) CYCLES_PER_DAY + cycle) / (dias * (double) CYCLES_PER_DAY)) * 100);

                                // ── DETECTAR CANCELACIONES MANUALES (REPLANT OPERATIVA REACTIVA) ──
                                try {
                                        List<Vuelo> canceladosDb = vueloRepo.findByCancelledTrue();
                                        for (Vuelo vf : canceladosDb) {
                                                if (!processedCancelledFlightIds.contains(vf.getId())) {
                                                        processedCancelledFlightIds.add(vf.getId());

                                                        // 1. Inyectar mensaje en el Event Log de la sesión
                                                        session.getEventLog().add(String.format(
                                                                "[%02d:%02d] 🚨 Vuelo %d (%s -> %s) CANCELADO MANUALMENTE por el operario.",
                                                                simHour, simMinute, vf.getId(),
                                                                vf.getOrigen().getIcaoCode(), vf.getDestino().getIcaoCode()));

                                                        // 2. Identificar rutas en masterSolution afectadas
                                                        List<Route> afectadas = masterSolution.getRoutes().stream()
                                                                .filter(r -> r.getArrivalTime() > currentSimTime)
                                                                .filter(r -> !"cancelled".equals(r.getStatus()))
                                                                .filter(r -> r.getFlights().stream().anyMatch(flight -> flight.getId().equals(vf.getId())))
                                                                .collect(Collectors.toList());

                                                        if (!afectadas.isEmpty()) {
                                                                session.setRescuedFlights(session.getRescuedFlights() + afectadas.size());
                                                                for (Route r : afectadas) {
                                                                        r.setStatus("cancelled");
                                                                        int cantidad = r.getCapacidadAsignada();
                                                                        r.setCapacidadAsignada(0);

                                                                        // Re-encolar para replanificación con ALNS/HGA en el ciclo actual/siguiente
                                                                        SuperLot replanLot = elevateToMaxPriority(r.getLot(), currentSimTime);
                                                                        replanLot.setTotalMaletas(cantidad);
                                                                        lotsDelDia.add(replanLot);

                                                                        session.getEventLog().add(String.format(
                                                                                "[%02d:%02d] 🔄 Replanificando automáticamente lote %d (%s -> %s) afectado por cancelación.",
                                                                                simHour, simMinute, r.getLot().getId(),
                                                                                r.getLot().getOrigenIcao(), r.getLot().getDestinoIcao()));
                                                                }
                                                        }
                                                }
                                        }
                                } catch (Exception e) {
                                        log.warn("[SimulationService] Error procesando cancelaciones en ciclo: {}", e.getMessage());
                                }

                                // Micro-batching: extraer lotes de esta ventana temporal
                                List<SuperLot> lotesVentana = lotsDelDia.stream()
                                    .filter(l -> l.getReadyTime() < nextSimTime)
                                    .collect(Collectors.toList());
                                lotsDelDia.removeAll(lotesVentana);

                                // Planificar lotes de esta ventana con el algoritmo elegido
                                long tPlanner0 = System.nanoTime();
                                Solution sol;
                                if (useHga) {
                                        sol = planner.plan(lotesVentana, null, HGA_WINDOW_MS);
                                } else {
                                        sol = alnsPlanner.plan(lotesVentana, PLANNER_WINDOW_MS);
                                }
                                long plannerNanos = System.nanoTime() - tPlanner0;

                                // Inyección de colapso (paralela)
                                if (session.isCollapseMode()) {
                                        int rescued = collapseHelper.applyCollapseInjections(
                                                        session, sol.getRoutes(), algorithm);
                                        if (rescued > 0) {
                                                session.setRescuedFlights(session.getRescuedFlights() + rescued);
                                        }
                                }

                                // Acumular rutas al master solution
                                masterSolution.getRoutes().addAll(sol.getRoutes());

                                // Avanzar estado global usando advanceTo incremental
                                simulator.advanceTo(globalState, masterSolution.getRoutes(),
                                        airportMap, currentTime, nextSimTime);

                                // En tránsito: solo rutas con capacidad asignada > 0
                                inTransitRoutes.addAll(sol.getRoutes().stream()
                                        .filter(r -> r.getCapacidadAsignada() > 0)
                                        .collect(Collectors.toList()));
                                // Deduplicar por lote ID (mantener la más reciente)
                                inTransitRoutes = new ArrayList<>(inTransitRoutes.stream()
                                        .collect(Collectors.toMap(r -> r.getLot().getId(), r -> r, (a, b) -> b))
                                        .values());
                                // Limpiar rutas que ya terminaron de volar
                                inTransitRoutes.removeIf(r -> r.getArrivalTime() <= nextSimTime - (SA_MINUTES * 60_000L));

                                // Event log sintético
                                if (cycle == 0) {
                                        session.getEventLog().add(String.format(
                                                "[00:00] Iniciando operaciones del Día %d con %d maletas en primer batch.",
                                                day + 1, lotesVentana.size()));
                                } else if (cycle == CYCLES_PER_DAY / 2) {
                                        session.getEventLog().add("[12:00] Reporte de medio día.");
                                }
                                if (globalState.isColapsado() && cycle == (int)(CYCLES_PER_DAY * 0.75)) {
                                        session.getEventLog().add("[18:00] ¡ALERTA! Posible colapso detectado en la red.");
                                }

                                // Lotes remanentes: no atendidos o con exceso
                                List<SuperLot> remanentes = sol.getRoutes().stream()
                                    .filter(r -> r.excedeCapacidad() || r.isNoAtendido())
                                    .map(r -> {
                                        SuperLot nextLot = elevateToMaxPriority(r.getLot(), nextSimTime);
                                        nextLot.setTotalMaletas(r.getDemandaNoAtendida());
                                        return nextLot;
                                    })
                                    .collect(Collectors.toList());

                                if (cycle < CYCLES_PER_DAY - 1) {
                                    lotsDelDia.addAll(remanentes); // Reintentar en siguiente batch hoy
                                } else {
                                    pendientes = remanentes; // Pasan al día siguiente
                                }

                                // Actualizar progreso con agrupación por vuelo físico
                                double slaPercent = 100; // placeholder hasta fin de día
                                long tUpdate0 = System.nanoTime();
                                updateProgress(session, day + 1, dias, currentPercent,
                                               simulatedTimeStr, slaPercent, globalState, airportMap,
                                               inTransitRoutes, nextSimTime, currentTime);
                                long tUpdate1 = System.nanoTime();

                                // Log de profiling estructurado con Ta, Sa, K y Sc explícitos
                                double Ta = plannerNanos / 1_000_000.0;
                                double K = (SA_MINUTES * 60.0 * 1000.0) / sleepPerCycleMs;
                                double Sc = SA_MINUTES;
                                log.debug("[PROFILER] Session: {} | Day: {} | Cycle: {} | " +
                                         "Ta (Planner): {:.2f}ms | Sa (Salto Algoritmo): {}min | " +
                                         "K (Aceleración): {:.2f}x | Sc (Consumo): {}min | " +
                                         "Build: {:.2f}ms | Apply: {:.2f}ms | Update: {:.2f}ms | " +
                                         "Lots: {} | Routes: {}",
                                         session.getSessionId(), day + 1, cycle,
                                         Ta, SA_MINUTES, K, Sc,
                                         globalState.getBuildEventsTimeNanos() / 1_000_000.0,
                                         globalState.getApplyEventsTimeNanos() / 1_000_000.0,
                                         (tUpdate1 - tUpdate0) / 1_000_000.0,
                                         lotesVentana.size(),
                                         masterSolution.getRoutes().size());

                                try {
                                        Thread.sleep(sleepPerCycleMs);
                                } catch (InterruptedException e) {
                                        Thread.currentThread().interrupt();
                                        return history;
                                }
                        }

                        // ── FIN DEL DÍA: CONSOLIDAR MÉTRICAS ──────────────────
                        final long dayStartTime = currentTime;
                        int totalMaletas = masterSolution.getRoutes().stream()
                                .filter(r -> r.getLot().getReadyTime() >= dayStartTime
                                        && r.getLot().getReadyTime() < (dayStartTime + 24L * 60 * 60 * 1000))
                                .mapToInt(r -> r.getLot().getTotalMaletas()).sum();
                        int malatetasAtendidas = masterSolution.getRoutes().stream()
                                .filter(r -> r.getLot().getReadyTime() >= dayStartTime
                                        && r.getLot().getReadyTime() < (dayStartTime + 24L * 60 * 60 * 1000))
                                .mapToInt(Route::getCapacidadAsignada).sum();
                        double slaPercent = totalMaletas == 0 ? 0 : (malatetasAtendidas * 100.0) / totalMaletas;

                        // avgRouteLength incremental
                        for (Route rt : masterSolution.getRoutes()) {
                                if (rt.getFlights() != null && !rt.getFlights().isEmpty()) {
                                        totalFlightLegs += rt.getFlights().size();
                                        totalRoutesWithFlights++;
                                }
                        }

                        SimulationDayReport report = new SimulationDayReport();
                        report.setDayIndex(day);
                        report.setStartTime(currentTime);
                        report.setEndTime(currentTime + 24L * 60 * 60 * 1000);
                        report.setRoutes(List.of()); // Ligero: no retener rutas en memoria
                        report.setColapsed(globalState.isColapsado());
                        report.setAirportSaturation(globalState.getSaturacionAeropuerto());
                        report.setCollapseTime(globalState.isColapsado() ? globalState.getCurrentTime() : -1L);
                        report.setSlaPercent(slaPercent);
                        report.setTotalMaletas(totalMaletas);
                        report.setMalatetasAtendidas(malatetasAtendidas);
                        report.setMaletasEntregadas(globalState.getMaletasEntregadas());
                        report.setPendingLots(pendientes);
                        history.add(report);

                        // Condición de parada del modo colapso
                        if (session.isCollapseMode()
                                        && session.getEndCondition() != CollapseEndCondition.NONE) {
                                CollapseHelper.CollapseCheckResult check = collapseHelper.checkEndCondition(
                                                session, report, globalState, airportMap);
                                if (check.terminated()) {
                                        report.setColapsed(true);
                                        report.setCollapseTime(report.getEndTime());
                                        session.setCollapseDayIndex(day + 1);
                                        session.setCollapseReason(check.reason());
                                        session.getEventLog().add(String.format(
                                                        "[Fin] Colapso efectivo: %s (día %d)",
                                                        check.reason(), day + 1));
                                        log.info("[Colapso] Terminación por {} en día {}: {}",
                                                        session.getEndCondition(), day + 1, check.reason());
                                        break;
                                }
                        }

                        currentTime += 24L * 60 * 60 * 1000;
                }

                // Guardar avgRouteLength calculado incrementalmente
                session.setAvgRouteLength(
                        totalRoutesWithFlights == 0 ? 0.0
                                : (double) totalFlightLegs / totalRoutesWithFlights
                );

                return history;
        }

        // ── HELPERS PRIVADOS ────────────────────────────────────────────────

        private SuperLot elevateToMaxPriority(SuperLot lot, long currentTime) {
                return new SuperLot(
                        lot.getId(), lot.getOrigenIcao(), lot.getDestinoIcao(),
                        lot.getTotalMaletas(),
                        currentTime + 24L * 60 * 60 * 1000,
                        lot.getSla(), lot.isIntercontinental(),
                        Integer.MAX_VALUE);
        }

        /**
         * Actualiza progreso agrupando rutas por VUELO FÍSICO (evita aviones duplicados).
         * Usa MapSnapshot volatile para sincronización con el WsPublisher.
         */
        private void updateProgress(SimulationProgressHolder.SimulationSessionState session,
                        int completedDays, int totalDays, int currentPercent,
                        String simulatedTime, double slaPercent,
                        SimulationState state, Map<String, Aeropuerto> airportMap,
                        List<Route> activeRoutesList,
                        long currentSimTime, long baseTime) {

                session.setCurrentDay(completedDays);
                session.setPercent(currentPercent);
                session.setSimulatedTime(simulatedTime);
                session.setSlaPercent(slaPercent);

                Map<String, Integer> loads = new HashMap<>();
                airportMap.keySet().forEach(icao -> loads.put(icao, state.getOccupancyPercent(icao, airportMap)));
                session.setAirportLoads(loads);

                int critical = (int) loads.values().stream().filter(pct -> pct >= 90).count();
                session.setCriticalNodes(critical);
                session.setCurrentEpochTime(currentSimTime);

                int totalBagsWaiting = state.getCargaAeropuerto().values().stream().mapToInt(Integer::intValue).sum();
                session.setTotalBagsWaiting(totalBagsWaiting);

                // Agrupar por vuelo físico para evitar aviones duplicados
                Map<String, Map<String, Object>> vuelosFisicos = new HashMap<>();

                for (Route r : activeRoutesList) {
                        List<Vuelo> flights = r.getFlights();
                        if (flights == null || flights.isEmpty()) continue;

                        String baseStatus  = r.isTarde() ? "critical" : (r.isNoAtendido() ? "blocked" : "normal");
                        String routeStatus = "normal".equals(r.getStatus()) ? baseStatus : r.getStatus();

                        long routeTime = r.getLot().getReadyTime();

                        for (int i = 0; i < flights.size(); i++) {
                                Vuelo v = flights.get(i);
                                String fromIcao = r.getHops().get(i);
                                String toIcao   = r.getHops().get(i + 1);

                                long depEpoch = v.calcularSiguienteSalida(routeTime);
                                long arrEpoch = depEpoch + v.getDuracionMs();
                                routeTime = arrEpoch;

                                if (currentSimTime < depEpoch || currentSimTime >= arrEpoch) continue;

                                String mapKey = v.getId() + "-" + depEpoch;

                                if (!vuelosFisicos.containsKey(mapKey)) {
                                        Map<String, Object> segMap = new HashMap<>();
                                        segMap.put("id", "vuelo-" + mapKey);
                                        segMap.put("from", fromIcao);
                                        segMap.put("to", toIcao);
                                        segMap.put("progress", computeFlightProgress(currentSimTime, depEpoch, arrEpoch));
                                        segMap.put("status", routeStatus);
                                        segMap.put("departureTime", depEpoch);
                                        segMap.put("arrivalTime", arrEpoch);
                                        segMap.put("ocupacionReal", r.getCapacidadAsignada());
                                        segMap.put("capacidadMax", v.getCapacidadTotal());
                                        vuelosFisicos.put(mapKey, segMap);
                                } else {
                                        Map<String, Object> existing = vuelosFisicos.get(mapKey);
                                        int ocupacionActual = (int) existing.get("ocupacionReal");
                                        existing.put("ocupacionReal", ocupacionActual + r.getCapacidadAsignada());
                                        if ("critical".equals(routeStatus) || "rescued".equals(routeStatus)) {
                                                existing.put("status", routeStatus);
                                        }
                                }
                        }
                }

                // Calcular % de ocupación del avión físico
                List<Map<String, Object>> activeRoutes = new ArrayList<>();
                for (Map<String, Object> avion : vuelosFisicos.values()) {
                        int ocupacion = (int) avion.get("ocupacionReal");
                        int max = (int) avion.get("capacidadMax");
                        double capacityPercent = (ocupacion * 100.0) / Math.max(1, max);
                        avion.put("capacityPercent", Math.min(100.0, capacityPercent));
                        avion.remove("ocupacionReal");
                        avion.remove("capacidadMax");
                        activeRoutes.add(avion);
                }

                session.setActiveRoutes(activeRoutes);

                // MapSnapshot inmutable para el WsPublisher (thread-safe)
                session.setMapSnapshot(new SimulationProgressHolder.MapSnapshot(
                        currentSimTime,
                        simulatedTime,
                        new ArrayList<>(activeRoutes)
                ));
        }

        private long computeSleepPerCycleMs(int totalDays, int playbackMinutes) {
                int minutes = playbackMinutes;
                if (minutes < 1) minutes = 1;
                minutes = Math.max(1, Math.min(minutes, 90));
                long totalCycles = (long) totalDays * CYCLES_PER_DAY;
                long ms = (long) minutes * 60_000L / totalCycles;
                return Math.max(250L, ms);
        }

        private double computeFlightProgress(long currentEpochTime, long dep, long arr) {
                if (dep <= 0 || arr <= 0 || arr <= dep) return 0.0;
                double p = (currentEpochTime - dep) / (double) (arr - dep);
                if (p < 0) return 0.0;
                if (p > 1) return 1.0;
                return p;
        }

        private void restaurarVuelosEnBD() {
                try {
                        List<Vuelo> cancelados = vueloRepo.findByCancelledTrue();
                        if (!cancelados.isEmpty()) {
                                log.info("[SimulationService] Restaurando {} vuelo(s) cancelado(s) para el inicio de la simulación / nuevo día.", cancelados.size());
                                cancelados.forEach(v -> v.setCancelled(false));
                                vueloRepo.saveAll(cancelados);
                                networkAdapter.invalidateGraph();
                        }
                } catch (Exception e) {
                        log.warn("[SimulationService] Error al restaurar vuelos cancelados en BD: {}", e.getMessage());
                }
        }
}
