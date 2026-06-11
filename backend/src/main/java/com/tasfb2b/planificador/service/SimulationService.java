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
import com.tasfb2b.bloqueo.service.BloqueoService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executor;
import java.util.stream.Collectors;

/**
 * Servicio de simulación multi-día con ejecución asíncrona y micro-batching.
 *
 * <p>Mejoras de la Versión 3.0 Integradas:
 * <ul>
 * <li><b>Planificación State-Aware</b>: Inyecta capacidades de vuelos y carga de almacenes en tiempo real al ALNS
 * para evitar el double-booking entre ciclos de planificación.</li>
 * <li><b>Motor de Eventos Discretos</b>: Uso de PriorityQueue global para una simulación incremental eficiente.</li>
 * <li><b>Control de Drift</b>: Compensación activa de tiempo de procesamiento para mantener 60 FPS en playback.</li>
 * <li><b>Eficiencia de Memoria</b>: Cálculo incremental de KPIs para evitar el almacenamiento de millones de objetos Route.</li>
 * <li><b>Resiliencia Reactiva</b>: Detección de cancelaciones manuales con replanificación inmediata.</li>
 * </ul>
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class SimulationService {

        private final SimulationRunner simulator;
        private final com.tasfb2b.planificador.simulation.EventEngine eventEngine;
        private final ALNSPlannerService alnsPlanner;
        private final AeropuertoRepository airportRepo;
        private final VueloRepository vueloRepo;
        private final SuperLotService superLotService;
        private final SimulationProgressHolder progressHolder;
        private final EnvioService envioService;
        private final SimulationWsPublisher wsPublisher;
        private final CollapseHelper collapseHelper;
        private final NetworkAdapter networkAdapter;
        private final BloqueoService bloqueoService;

        // -- DIAGNOSTIC STATE --
        private final ConcurrentHashMap<String, Map<String, String>> prevRoutesBySession = new ConcurrentHashMap<>();

        @Value("${tasf.data.path}")
        private String dataPath;

        /**
         * Duracion objetivo (minutos) para el playback visual de toda la simulacion.
         */
        @Value("${tasf.sim.playback.targetMinutes:60}")
        private int playbackTargetMinutes;

        /** Fecha base por defecto: inicio del dataset académico TASF.B2B. */
        private static final LocalDate DEFAULT_START_DATE = LocalDate.of(2026, 1, 2);

        /** Tiempo máximo del planificador ALNS por ciclo (ms). */
        private static final long PLANNER_WINDOW_MS = 500;

        // ── PLANIFICACIÓN PROGRAMADA (PLANIFICACION_PROGRAMADA.md) ──────────
        /**
         * Sa = Salto del algoritmo: granularidad de ciclos en minutos de tiempo simulado.
         */
        @Value("${tasf.sim.saMinutes:10}")
        private int saMinutes;

        public record WsEnvelope<T>(long seq, T data) {}

        /**
         * Inicia la simulación en el pool {@code simulationExecutor}.
         */
        @Async("simulationExecutor")
        public void runAsync(String sessionId, int dias, String algorithm, LocalDate startDate, int playbackMinutes, String preCancelledFlightIds, String startTime) {
                SimulationProgressHolder.SimulationSessionState session = progressHolder.get(sessionId);
                if (session == null) return;
                
                LocalDate fechaInicio = (startDate != null) ? startDate : DEFAULT_START_DATE;

                try {
                        long startEpochMs = fechaInicio.atStartOfDay()
                                .toInstant(ZoneOffset.UTC).toEpochMilli();
                        session.setStartEpoch(startEpochMs);

                        List<SimulationDayReport> reports = runFullSimulation(
                                dias, session, algorithm, fechaInicio, playbackMinutes, preCancelledFlightIds, startTime);
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

                        progressHolder.saveAlgorithmResult("ALNS", metrics);

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
                        String preCancelledFlightIds,
                        String startTimeStr) {

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

                List<Vuelo> todosLosVuelos = vueloRepo.findAll();
                todosLosVuelos.forEach(v -> {
                    v.getOrigen().getIcaoCode();
                    v.getDestino().getIcaoCode();
                });

                List<SimulationDayReport> history = new ArrayList<>();
                long startTime = fechaInicio.atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli();
                long currentTime = startTime;
                List<SuperLot> pendientes = new ArrayList<>();
                List<Route> inTransitRoutes = new ArrayList<>();

                // ── SIMULACIÓN INCREMENTAL ORIENTADA A EVENTOS ──
                SimulationState globalState = new SimulationState(
                        new ArrayList<>(airportMap.values()),
                        todosLosVuelos,
                        startTime,
                        bloqueoService
                );
                
                PriorityQueue<com.tasfb2b.planificador.domain.Event> globalEventQueue = 
                        new PriorityQueue<>(Comparator.comparingLong(com.tasfb2b.planificador.domain.Event::getTime));

                long totalFlightLegs = 0;
                long totalRoutesWithFlights = 0;

int cyclesPerDay = 1440 / saMinutes;
                
                // Estado global persistente multi-día
                Solution masterSolution = new Solution();
                masterSolution.setRoutes(new ArrayList<>());
                boolean hubsReduced = false;
                Set<Long> processedCancelledFlightIds = new HashSet<>();

                for (int day = 0; day < dias; day++) {

                        LocalDate fechaDia = fechaInicio.plusDays(day);
                        long dayStartEpochMs = fechaDia.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli();

                        // Si es un nuevo día (day > 0), restaurar vuelos cancelados del día anterior
                        if (day > 0) {
                                restaurarVuelosEnBD();
                                processedCancelledFlightIds.clear();
                        }

                        // Aplicar pre-cancelaciones correspondientes al día actual
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

                        envioService.cargarPorDia(fechaDia, dataPath);
                        if (day >= 3) envioService.purgarAntesDe(fechaInicio.plusDays(day - 2));

                        List<SuperLot> lotsDelDia = new ArrayList<>(pendientes);
                        lotsDelDia.addAll(superLotService.agruparEnviosPorFecha(fechaDia));
                        
                        // ── CONSOLIDACIÓN DE CARGA (Eficiencia) ──
                        lotsDelDia = superLotService.mergeLots(lotsDelDia);
                        pendientes.clear();

                        // Reducción de hubs una sola vez al entrar en modo colapso
                        if (session.isCollapseMode() && !hubsReduced) {
                                collapseHelper.reduceHubCapacity(airportMap);
                                hubsReduced = true;
                        }

                        long sleepPerCycleMs = computeSleepPerCycleMs(dias, playbackMinutes, cyclesPerDay);
                        
                        int malatetasAtendidasDia = 0;
                        int totalMaletasDia = 0;
                        int maletasEntregadasAlEmpezarDia = globalState.getMaletasEntregadas();
                        
                        int startCycle = 0;
                        if (day == 0 && startTimeStr != null && startTimeStr.contains(":")) {
                                try {
                                        String[] parts = startTimeStr.split(":");
                                        int targetHour = Integer.parseInt(parts[0].trim());
                                        int targetMin = Integer.parseInt(parts[1].trim());
                                        startCycle = (targetHour * 60 + targetMin) / saMinutes;
                                } catch (Exception ignored) {}
                        }

                        for (int cycle = 0; cycle < cyclesPerDay; cycle++) {
                                long currentSimTime = currentTime + ((long) cycle * saMinutes * 60_000L);
                                long nextSimTime = currentSimTime + (saMinutes * 60_000L);

                                int simHour   = (cycle * saMinutes) / 60;
                                int simMinute = (cycle * saMinutes) % 60;
                                String simulatedTimeStr = String.format("Día %d - %02d:%02d", day + 1, simHour, simMinute);

                                // ── DETECTAR CANCELACIONES MANUALES (REPLANT OPERATIVA REACTIVA) ──
                                try {
                                        List<Vuelo> canceladosDb = vueloRepo.findByCancelledTrue();
                                        for (Vuelo vf : canceladosDb) {
                                                if (!processedCancelledFlightIds.contains(vf.getId())) {
                                                        processedCancelledFlightIds.add(vf.getId());

                                                        session.getEventLog().add(String.format(
                                                                "[%02d:%02d] 🚨 Vuelo %d (%s -> %s) CANCELADO MANUALMENTE por el operario.",
                                                                simHour, simMinute, vf.getId(),
                                                                vf.getOrigen().getIcaoCode(), vf.getDestino().getIcaoCode()));

                                                        // Identificar rutas afectadas en inTransitRoutes (V3 usa inTransitRoutes para visibilidad)
                                                        List<Route> afectadas = inTransitRoutes.stream()
                                                                .filter(r -> r.getArrivalTime() > currentSimTime)
                                                                .filter(r -> !"cancelled".equals(r.getStatus()))
                                                                .filter(r -> r.getFlights().stream().anyMatch(flight -> flight.getId().equals(vf.getId())))
                                                                .toList();

                                                        if (!afectadas.isEmpty()) {
                                                                session.setRescuedFlights(session.getRescuedFlights() + afectadas.size());
                                                                for (Route r : afectadas) {
                                                                        r.setStatus("cancelled");
                                                                        int cantidad = r.getCapacidadAsignada();
                                                                        r.setCapacidadAsignada(0);

                                                                        // Re-encolar para replanificación
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

                                List<SuperLot> lotesVentana = lotsDelDia.stream()
                                    .filter(l -> l.getReadyTime() < nextSimTime)
                                    .collect(Collectors.toList());
                                lotsDelDia.removeAll(lotesVentana);

                                // ── ALNS STATE-AWARE: Inyectamos el estado actual de la red ──
                                Solution sol = alnsPlanner.plan(lotesVentana, PLANNER_WINDOW_MS, 
                                        globalState.getCapacidadVuelo(), globalState.getCargaAeropuerto());
                                
                                masterSolution.getRoutes().addAll(sol.getRoutes());
                                
                                totalMaletasDia += lotesVentana.stream().mapToInt(SuperLot::getTotalMaletas).sum();
                                malatetasAtendidasDia += sol.getRoutes().stream().mapToInt(Route::getCapacidadAsignada).sum();

                                if (session.isCollapseMode()) {
                                        collapseHelper.applyCollapseInjections(session, sol.getRoutes(), algorithm);
                                }

                                // ── TRADUCCIÓN A EVENTOS FUTUROS ──
                                List<com.tasfb2b.planificador.domain.Event> newEvents = eventEngine.buildEvents(sol.getRoutes(), dayStartEpochMs);
                                globalEventQueue.addAll(newEvents);
                                
                                // Gestión de visualización (vuelos en tránsito)
                                inTransitRoutes.addAll(sol.getRoutes().stream()
                                        .filter(r -> r.getCapacidadAsignada() > 0)
                                        .collect(Collectors.toList()));
                                inTransitRoutes = inTransitRoutes.stream()
                                        .collect(Collectors.toMap(r -> r.getLot().getId(), r -> r, (a, b) -> b))
                                        .values()
                                        .stream()
                                        .filter(r -> r.getArrivalTime() > currentSimTime) 
                                        .collect(Collectors.toList());

                                // Métricas incrementales de rutas
                                for (Route rt : sol.getRoutes()) {
                                        if (rt.getFlights() != null && !rt.getFlights().isEmpty()) {
                                                totalFlightLegs += rt.getFlights().size();
                                                totalRoutesWithFlights++;
                                        }
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

                                if (cycle < cyclesPerDay - 1) {
                                    lotsDelDia.addAll(remanentes); 
                                } else {
                                    pendientes = remanentes; 
                                }

                                // ── MICRO-STEPPING: AVANCE DEL MOTOR (CONSUMO DE COLA) ──
                                int microSteps = saMinutes; 
                                long stepDurationMs = 60_000L;
                                long sleepPerMicroStep = sleepPerCycleMs / microSteps;

                                for (int step = 0; step < microSteps; step++) {
                                        long tMicroStart = System.nanoTime();
                                        long microEnd = currentSimTime + ((step + 1) * stepDurationMs);

                                        while (!globalEventQueue.isEmpty() && globalEventQueue.peek().getTime() <= microEnd) {
                                                globalState.apply(globalEventQueue.poll(), airportMap);
                                        }

                                        int mHour = (int) (((microEnd - startTime) % (24 * 60 * 60_000L)) / 3600_000L);
                                        int mMin = (int) (((microEnd - startTime) % 3600_000L) / 60_000L);
                                        String mTimeStr = String.format("Día %d - %02d:%02d", day + 1, mHour, mMin);

                                        double totalMicroSteps = (double)dias * cyclesPerDay * microSteps;
                                        int mPercent = (int) ((((day * (double)cyclesPerDay * microSteps) + (cycle * (double)microSteps) + step) / totalMicroSteps) * 100);

                                        updateProgress(session, day + 1, dias, mPercent,
                                                       mTimeStr, 100.0, globalState, airportMap,
                                                       inTransitRoutes, microEnd, currentTime, algorithm);

                                        long tMicroEnd = System.nanoTime();
                                        long workTimeMs = (tMicroEnd - tMicroStart) / 1_000_000;
                                        long adjustedSleep = Math.max(0, sleepPerMicroStep - workTimeMs);

                                        try {
                                                if (day == 0 && cycle < startCycle) {
                                                        // Fast-forward (no sleep)
                                                } else {
                                                        if (adjustedSleep > 0) Thread.sleep(adjustedSleep);
                                                }
                                        } catch (InterruptedException e) {
                                                Thread.currentThread().interrupt();
                                                return history;
                                        }
                                }
                        }

                        // --- AL FINAL DEL DIA CONSOLIDAR METRICAS ---
                        double slaPercent = totalMaletasDia == 0 ? 0 : (malatetasAtendidasDia * 100.0) / totalMaletasDia;

                        SimulationDayReport report = new SimulationDayReport();
                        report.setDayIndex(day);
                        report.setStartTime(currentTime);
                        report.setEndTime(currentTime + 24L * 60 * 60 * 1000);
final long dayStartTimeVal = currentTime;
                        List<Route> dayRoutes = masterSolution.getRoutes().stream()
                                .filter(r -> r.getLot().getReadyTime() >= dayStartTimeVal
                                        && r.getLot().getReadyTime() < (dayStartTimeVal + 24L * 60 * 60 * 1000))
                                .collect(Collectors.toList());
                        report.setRoutes(dayRoutes);
                        report.setColapsed(globalState.isColapsado());
                        report.setAirportSaturation(globalState.getSaturacionAeropuerto());
                        report.setCollapseTime(globalState.isColapsado() ? globalState.getCurrentTime() : -1L);
                        report.setSlaPercent(slaPercent);
                        report.setTotalMaletas(totalMaletasDia);
                        report.setMalatetasAtendidas(malatetasAtendidasDia);
                        report.setMaletasEntregadas(globalState.getMaletasEntregadas() - maletasEntregadasAlEmpezarDia);
                        report.setPendingLots(pendientes);

                        history.add(report);

                        if (session.isCollapseMode() && session.getEndCondition() != CollapseEndCondition.NONE) {
                                CollapseHelper.CollapseCheckResult check = collapseHelper.checkEndCondition(
                                                session, report, globalState, airportMap);
                                if (check.terminated()) {
                                        report.setColapsed(true);
                                        report.setCollapseTime(report.getEndTime());
                                        session.setCollapseDayIndex(day + 1);
                                        session.setCollapseReason(check.reason());
                                        session.getEventLog().add(String.format("[Fin] Colapso efectivo: %s (día %d)", check.reason(), day + 1));
                                        log.info("[Colapso] Terminación por {} en día {}: {}",
                                                        session.getEndCondition(), day + 1, check.reason());
                                        break;
                                }
                        }

                        currentTime += 24L * 60 * 60 * 1000;
                }

                session.setAvgRouteLength(totalRoutesWithFlights == 0 ? 0.0 : (double) totalFlightLegs / totalRoutesWithFlights);
                return history;
        }

        private SuperLot elevateToMaxPriority(SuperLot lot, long currentTime) {
                return new SuperLot(
                        lot.getId(), lot.getOrigenIcao(), lot.getDestinoIcao(),
                        lot.getTotalMaletas(),
                        currentTime + 24L * 60 * 60 * 1000,
                        lot.getSla(), lot.isIntercontinental(),
                        Integer.MAX_VALUE);
        }

        private void updateProgress(SimulationProgressHolder.SimulationSessionState session,
                        int completedDays, int totalDays, int currentPercent, String simulatedTime,
                        double slaPercent, SimulationState state, Map<String, Aeropuerto> airportMap,
                        List<Route> activeRoutesList, long currentSimTime, long baseTime, String algorithm) {

                session.setCurrentDay(completedDays);
                session.setPercent(currentPercent);
                session.setSimulatedTime(simulatedTime);
                session.setSlaPercent(slaPercent);

                Map<String, Map<String, Object>> loads = new HashMap<>();
                for (String icao : airportMap.keySet()) {
                    Map<String, Object> airportData = new HashMap<>();
                    airportData.put("bags", state.getLoadAt(icao));
                    airportData.put("occupancy", state.getOccupancyPercent(icao, airportMap));
                    loads.put(icao, airportData);
                }
                session.setAirportLoads(loads);

                int critical = (int) loads.values().stream()
                    .filter(data -> (int)data.get("occupancy") >= 90).count();
                session.setCriticalNodes(critical);
                session.setCurrentEpochTime(currentSimTime);
                session.setTotalBagsWaiting(state.getCargaAeropuerto().values().stream().mapToInt(Integer::intValue).sum());

                Map<String, Map<String, Object>> vuelosFisicos = new HashMap<>();
                for (Route r : activeRoutesList) {
                        List<Vuelo> flights = r.getFlights();
                        if (flights == null || flights.isEmpty()) continue;

                        String routeStatus = "normal".equals(r.getStatus()) ? 
                                (r.isTarde() ? "critical" : (r.isNoAtendido() ? "blocked" : "normal")) : r.getStatus();

                        long routeTime = r.getLot().getReadyTime();
                        for (int i = 0; i < flights.size(); i++) {
                                Vuelo v = flights.get(i);
                                long depEpoch = v.getDepartureEpoch(baseTime); 
                                long arrEpoch = v.getArrivalEpoch(baseTime);
                                routeTime = arrEpoch;

                                if (currentSimTime < depEpoch) {
                                        if (i == 0) {
                                            // Aún no despega el primer tramo
                                        } else {
                                            // Layover: Ya aterrizó de un tramo anterior pero no despega el siguiente
                                            System.out.printf("[LAYOVER_DIAG] Time=%s Flight=%s Shipment=%s At=%s NextDep=%s%n",
                                                simulatedTime, v.getId(), r.getLot().getId(), v.getOrigen().getIcaoCode(), new Date(depEpoch));
                                        }
                                        continue;
                                }
                                // No mantener segmentos tras aterrizar para evitar solapamiento visual.
                                if (currentSimTime >= arrEpoch) {
                                        continue;
                                }

                                String mapKey = v.getId() + "-" + depEpoch;
                                vuelosFisicos.computeIfAbsent(mapKey, k -> {
                                        Map<String, Object> segMap = new HashMap<>();
                                        segMap.put("id", "vuelo-" + mapKey);
                                        segMap.put("from", v.getOrigen().getIcaoCode());
                                        segMap.put("to", v.getDestino().getIcaoCode());
                                        segMap.put("progress", computeFlightProgress(currentSimTime, depEpoch, arrEpoch));
                                        segMap.put("status", routeStatus);
                                        segMap.put("departureTime", depEpoch);
                                        segMap.put("arrivalTime", arrEpoch);
                                        segMap.put("ocupacionReal", 0);
                                        segMap.put("capacidadMax", v.getCapacidadTotal());
                                        return segMap;
                                });
                                
                                Map<String, Object> existing = vuelosFisicos.get(mapKey);
                                existing.put("ocupacionReal", (int)existing.get("ocupacionReal") + r.getCapacidadAsignada());
                                if (isHigherPriority(routeStatus, (String)existing.get("status"))) {
                                        existing.put("status", routeStatus);
                                }
                        }
                }

                List<Map<String, Object>> activeRoutes = new ArrayList<>();
                Map<String, String> currentRouteStructure = new HashMap<>();
                Map<String, String> prevRoutes = prevRoutesBySession.getOrDefault(session.getSessionId(), Collections.emptyMap());

                for (Map<String, Object> avion : vuelosFisicos.values()) {
                        String id = (String) avion.get("id");
                        String from = (String) avion.get("from");
                        String to = (String) avion.get("to");
                        String routeStr = from + "->" + to;
                        currentRouteStructure.put(id, routeStr);

                        if (prevRoutes.containsKey(id) && !prevRoutes.get(id).equals(routeStr)) {
                            System.out.printf("[ROUTE_CHANGE] Time=%s Flight=%s PreviousRoute=%s CurrentRoute=%s%n",
                                    simulatedTime, id, prevRoutes.get(id), routeStr);
                        }

                        int ocupacion = (int) avion.get("ocupacionReal");
                        int max = (int) avion.get("capacidadMax");
double capacityPercent = (ocupacion * 100.0) / Math.max(1, max);
                        avion.put("capacityPercent", Math.min(100.0, capacityPercent));
                        avion.remove("ocupacionReal");
                        avion.remove("capacidadMax");
                        activeRoutes.add(avion);
                }
                prevRoutesBySession.put(session.getSessionId(), currentRouteStructure);

                session.setActiveRoutes(activeRoutes);
                session.setMapSnapshot(new SimulationProgressHolder.MapSnapshot(currentSimTime, simulatedTime, new ArrayList<>(activeRoutes)));

                // Frame atómico para el visualizador
                session.setWsFrame(new SimulationProgressHolder.WsFrame(
                        session.getSessionId(),
                        session.getStatus().name(),
                        currentSimTime,
                        simulatedTime,
                        currentPercent,
                        completedDays,
                        totalDays,
                        slaPercent,
                        critical,
                        loads,
                        session.getTotalBagsWaiting(),
                        session.isCollapseMode(),
                        session.getRescuedFlights(),
                        session.getErrorMessage(),
                        session.getStartEpoch(),
                        new ArrayList<>(activeRoutes),
                        algorithm
                ));
        }

        private boolean isHigherPriority(String newStatus, String currentStatus) {
                Map<String, Integer> p = Map.of("critical", 3, "rescued", 2, "cancelled", 1, "normal", 0);
                return p.getOrDefault(newStatus, 0) > p.getOrDefault(currentStatus, 0);
        }

        private long computeSleepPerCycleMs(int totalDays, int playbackMinutes, int cyclesPerDay) {
                int minutes = Math.max(1, Math.min(playbackMinutes, 90));
                long ms = (long) minutes * 60_000L / ((long) totalDays * cyclesPerDay);
                return Math.max(100L, ms);
        }

        private double computeFlightProgress(long currentEpochTime, long dep, long arr) {
                if (dep <= 0 || arr <= 0 || arr <= dep) return 0.0;
                double p = (currentEpochTime - dep) / (double) (arr - dep);
                return Math.max(0.0, Math.min(1.0, p));
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
