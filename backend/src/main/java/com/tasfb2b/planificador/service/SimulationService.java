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
import java.util.concurrent.Executor;
import java.util.stream.Collectors;

/**
 * Servicio de simulación multi-día con ejecución asíncrona.
 *
 * <p>Mejoras de la Versión 3.0:
 * <ul>
 * <li><b>Planificación State-Aware</b>: Inyecta capacidades de vuelos y carga de almacenes en tiempo real al ALNS
 * para evitar el double-booking entre ciclos de planificación.</li>
 * <li><b>Motor de Eventos Discretos</b>: Uso de PriorityQueue global para una simulación incremental eficiente.</li>
 * <li><b>Control de Drift</b>: Compensación activa de tiempo de procesamiento para mantener 60 FPS en playback.</li>
 * <li><b>Eficiencia de Memoria</b>: Cálculo incremental de KPIs para evitar el almacenamiento de millones de objetos Route.</li>
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
        private final com.tasfb2b.vuelo.repository.VueloRepository vueloRepo;
        private final SuperLotService superLotService;
        private final SimulationProgressHolder progressHolder;
        private final EnvioService envioService;
        private final SimulationWsPublisher wsPublisher;

        /** Pool dedicado para replans ALNS paralelos del modo colapso (ver PLAN_PERF_COLAPSO.md). */
        @Qualifier("replanExecutor")
        private final Executor replanExecutor;

        /** Ventana de ALNS para cada replan en modo colapso (ms). Bajo por design: best-effort. */
        private static final long REPLAN_WINDOW_MS = 500L;

        @Value("${tasf.data.path}")
        private String dataPath;

        /**
         * Duracion objetivo (minutos) para el playback visual de toda la simulacion.
         */
        @Value("${tasf.sim.playback.targetMinutes:60}")
        private int playbackTargetMinutes;

        /** Umbral de SLA (0-100) para la condición SLA_BELOW_THRESHOLD del modo colapso. */
        @Value("${tasf.sim.collapse.slaThreshold:30.0}")
        private double collapseSlaThreshold;

        /** Días consecutivos bajo el umbral para terminar en modo colapso con SLA_BELOW_THRESHOLD. */
        @Value("${tasf.sim.collapse.consecutiveDays:2}")
        private int collapseConsecutiveDays;

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
        public void runAsync(String sessionId, int dias, String algorithm, LocalDate startDate, int playbackMinutes) {
                SimulationProgressHolder.SimulationSessionState session = progressHolder.get(sessionId);
                if (session == null) return;
                
                LocalDate fechaInicio = (startDate != null) ? startDate : DEFAULT_START_DATE;

                try {
                        long startEpochMs = fechaInicio.atStartOfDay()
                                .toInstant(java.time.ZoneOffset.UTC).toEpochMilli();
                        session.setStartEpoch(startEpochMs);

                        List<SimulationDayReport> reports = runFullSimulation(dias, session, algorithm, fechaInicio, playbackMinutes);
                        session.getReports().addAll(reports);

                        int totalAttended = reports.stream().mapToInt(SimulationDayReport::getMalatetasAtendidas).sum();
                        int totalDemand   = reports.stream().mapToInt(SimulationDayReport::getTotalMaletas).sum();
                        int totalMissed   = totalDemand - totalAttended;
                        double slaFinal   = totalDemand == 0 ? 0 : (totalAttended * 100.0) / totalDemand;

                        session.setTotalAttended(totalAttended);
                        session.setTotalMissed(totalMissed);
                        session.setSlaFinal(slaFinal);

                        double avgRouteLength = session.getAvgRouteLength();

                        Map<String, Object> metrics = new HashMap<>();
                        metrics.put("deliveredOnTime",  totalAttended);
                        metrics.put("totalDeliveries",  totalDemand);
                        metrics.put("slaPercent",        slaFinal);
                        metrics.put("avgRouteLength",    Math.round(avgRouteLength * 10.0) / 10.0);
                        metrics.put("replanifications",  session.getRescuedFlights());
                        metrics.put("execTime",          "Completado");
                        metrics.put("rescuedFlights",    session.getRescuedFlights());

                        progressHolder.saveAlgorithmResult("ALNS", metrics);
                        session.setSlaPercent(slaFinal);

                        progressHolder.markDone(sessionId);
                        wsPublisher.pushImmediate(sessionId, session);

                } catch (Exception ex) {
                        log.error("Simulation failed", ex);
                        progressHolder.markFailed(sessionId, ex.getMessage());
                        wsPublisher.pushImmediate(sessionId, session);
                }
        }

        private List<SimulationDayReport> runFullSimulation(
                        int dias,
                        SimulationProgressHolder.SimulationSessionState session,
                        String algorithm,
                        LocalDate fechaInicio,
                        int playbackMinutes) {

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
                        startTime
                );
                
                PriorityQueue<com.tasfb2b.planificador.domain.Event> globalEventQueue = 
                        new PriorityQueue<>(Comparator.comparingLong(com.tasfb2b.planificador.domain.Event::getTime));

                long totalFlightLegs = 0;
                long totalRoutesWithFlights = 0;

                int cyclesPerDay = 1440 / saMinutes;

                for (int day = 0; day < dias; day++) {

                        LocalDate fechaDia = fechaInicio.plusDays(day);
                        long dayStartEpochMs = fechaDia.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli();

                        envioService.cargarPorDia(fechaDia, dataPath);
                        if (day >= 3) envioService.purgarAntesDe(fechaInicio.plusDays(day - 2));

                        List<SuperLot> lotsDelDia = new ArrayList<>(pendientes);
                        lotsDelDia.addAll(superLotService.agruparEnviosPorFecha(fechaDia));
                        
                        // ── CONSOLIDACIÓN DE CARGA (Eficiencia) ──
                        // Fusionamos lotes con mismo origen/destino para reducir N y evitar OOM
                        lotsDelDia = superLotService.mergeLots(lotsDelDia);
                        pendientes.clear();

                        long sleepPerCycleMs = computeSleepPerCycleMs(dias, playbackMinutes, cyclesPerDay);
                        
                        int malatetasAtendidasDia = 0;
                        int totalMaletasDia = 0;
                        int maletasEntregadasAlEmpezarDia = globalState.getMaletasEntregadas();
                        
                        for (int cycle = 0; cycle < cyclesPerDay; cycle++) {
                                long currentSimTime = currentTime + ((long) cycle * saMinutes * 60_000L);
                                long nextSimTime = currentSimTime + (saMinutes * 60_000L);

                                int simHour   = (cycle * saMinutes) / 60;
                                int simMinute = (cycle * saMinutes) % 60;
                                String simulatedTimeStr = String.format("Día %d - %02d:%02d", day + 1, simHour, simMinute);

                                int currentPercent = (int)(
                                        ((day * (double) cyclesPerDay + cycle) / (dias * (double) cyclesPerDay)) * 100);

                                List<SuperLot> lotesVentana = lotsDelDia.stream()
                                    .filter(l -> l.getReadyTime() < nextSimTime)
                                    .collect(Collectors.toList());
                                lotsDelDia.removeAll(lotesVentana);

                                long tCycleStart = System.nanoTime();
                                
                                // ── ALNS STATE-AWARE: Inyectamos el estado actual de la red ──
                                long tPlannerStart = System.nanoTime();
                                Solution sol = alnsPlanner.plan(lotesVentana, PLANNER_WINDOW_MS, 
                                        globalState.getCapacidadVuelo(), globalState.getCargaAeropuerto());
                                
                                totalMaletasDia += lotesVentana.stream().mapToInt(SuperLot::getTotalMaletas).sum();
                                malatetasAtendidasDia += sol.getRoutes().stream().mapToInt(Route::getCapacidadAsignada).sum();

                                if (session.isCollapseMode()) {
                                        applyCollapseInjections(session, sol.getRoutes(), algorithm);
                                }

                                // ── TRADUCCIÓN A EVENTOS FUTUROS ──
                                List<com.tasfb2b.planificador.domain.Event> newEvents = eventEngine.buildEvents(sol.getRoutes(), dayStartEpochMs);
                                globalEventQueue.addAll(newEvents);
                                
                                // ── MICRO-STEPPING: AVANCE DEL MOTOR (CONSUMO DE COLA) ──
                                int microSteps = saMinutes; // 1 step = 1 minuto simulado
                                long stepDurationMs = 60_000L;
                                long sleepPerMicroStep = sleepPerCycleMs / microSteps;

                                // Gestión de visualización (vuelos en tránsito)
                                inTransitRoutes.addAll(sol.getRoutes().stream()
                                        .filter(r -> r.getCapacidadAsignada() > 0)
                                        .collect(Collectors.toList()));
                                inTransitRoutes = inTransitRoutes.stream()
                                        .collect(Collectors.toMap(r -> r.getLot().getId(), r -> r, (a, b) -> b))
                                        .values()
                                        .stream()
                                        .filter(r -> r.getArrivalTime() > currentSimTime) // Usar currentSimTime para evitar borrar vuelos prematuramente
                                        .collect(Collectors.toList());

                                // Métricas incrementales de rutas
                                for (Route rt : sol.getRoutes()) {
                                        if (rt.getFlights() != null && !rt.getFlights().isEmpty()) {
                                                totalFlightLegs += rt.getFlights().size();
                                                totalRoutesWithFlights++;
                                        }
                                }

                                for (int step = 0; step < microSteps; step++) {
                                        long tMicroStart = System.nanoTime();
                                        long microEnd = currentSimTime + ((step + 1) * stepDurationMs);

                                        while (!globalEventQueue.isEmpty() && globalEventQueue.peek().getTime() <= microEnd) {
                                                globalState.apply(globalEventQueue.poll(), airportMap);
                                        }

                                        int mHour = (int) (((microEnd - startTime) % (24 * 60 * 60_000L)) / 3600_000L);
                                        int mMin = (int) (((microEnd - startTime) % 3600_000L) / 60_000L);
                                        String mTimeStr = String.format("Día %d - %02d:%02d", day + 1, mHour, mMin);

                                        double totalMicroSteps = dias * cyclesPerDay * microSteps;
                                        int mPercent = (int) ((((day * cyclesPerDay * microSteps) + (cycle * microSteps) + step) / totalMicroSteps) * 100);

                                        updateProgress(session, day + 1, dias, mPercent,
                                                       mTimeStr, 100.0, globalState, airportMap,
                                                       inTransitRoutes, microEnd, currentTime);

                                        wsPublisher.pushImmediate(session.getSessionId(), session);

                                        long tMicroEnd = System.nanoTime();
                                        long workTimeMs = (tMicroEnd - tMicroStart) / 1_000_000;
                                        long adjustedSleep = Math.max(0, sleepPerMicroStep - workTimeMs);

                                        try {
                                                if (adjustedSleep > 0) Thread.sleep(adjustedSleep);
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
                        report.setRoutes(List.of()); // Mantener heap limpio
                        report.setColapsed(globalState.isColapsado());
                        report.setAirportSaturation(globalState.getSaturacionAeropuerto());
                        report.setCollapseTime(globalState.isColapsado() ? globalState.getCurrentTime() : -1L);
                        report.setSlaPercent(slaPercent);
                        report.setTotalMaletas(totalMaletasDia);
                        report.setMalatetasAtendidas(malatetasAtendidasDia);
                        report.setMaletasEntregadas(globalState.getMaletasEntregadas() - maletasEntregadasAlEmpezarDia);
                        
                        // Los lotes que no pudieron salir hoy pasan como pendientes al siguiente día
                        pendientes.addAll(lotsDelDia); 

                        history.add(report);

                        if (session.isCollapseMode() && session.getEndCondition() != CollapseEndCondition.NONE) {
                                CollapseCheckResult check = checkEndCondition(
                                                session, report, globalState, airportMap,
                                                collapseSlaThreshold, collapseConsecutiveDays);
                                if (check.terminated()) {
                                        session.setCollapseDayIndex(day + 1);
                                        session.setCollapseReason(check.reason());
                                        session.getEventLog().add(String.format("[Fin] Colapso efectivo: %s (día %d)", check.reason(), day + 1));
                                        break;
                                }
                        }

                        currentTime += 24L * 60 * 60 * 1000;
                }

                session.setAvgRouteLength(totalRoutesWithFlights == 0 ? 0.0 : (double) totalFlightLegs / totalRoutesWithFlights);
                return history;
        }

        private void updateProgress(SimulationProgressHolder.SimulationSessionState session,
                        int completedDays, int totalDays, int currentPercent, String simulatedTime,
                        double slaPercent, SimulationState state, Map<String, Aeropuerto> airportMap,
                        List<Route> activeRoutesList, long currentSimTime, long baseTime) {

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
                                long depEpoch = v.calcularSiguienteSalida(routeTime);
                                long arrEpoch = depEpoch + v.getDuracionMs();
                                routeTime = arrEpoch;

                                if (currentSimTime < depEpoch || currentSimTime >= arrEpoch) continue;

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
                for (Map<String, Object> avion : vuelosFisicos.values()) {
                        int ocupacion = (int) avion.get("ocupacionReal");
                        int max = (int) avion.get("capacidadMax");
                        avion.put("capacityPercent", Math.min(100.0, (ocupacion * 100.0) / Math.max(1, max)));
                        avion.remove("ocupacionReal");
                        avion.remove("capacidadMax");
                        activeRoutes.add(avion);
                }

                session.setActiveRoutes(activeRoutes);
                session.setMapSnapshot(new SimulationProgressHolder.MapSnapshot(currentSimTime, simulatedTime, new ArrayList<>(activeRoutes)));
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

        int applyCollapseInjections(SimulationProgressHolder.SimulationSessionState session, List<Route> routes, String algorithm) {
                if (routes == null || routes.isEmpty()) return 0;
                double cancelFraction = session.getStressFactor() * 0.03;
                int cancelCount = (int) Math.max(1, routes.size() * cancelFraction);
                List<Route> rutasModificables = new ArrayList<>(routes);
                Collections.shuffle(rutasModificables);

                Set<Long> uniqueVueloIds = new LinkedHashSet<>();
                for (int i = 0; i < cancelCount && i < rutasModificables.size(); i++) {
                        if (!rutasModificables.get(i).getFlights().isEmpty()) {
                                uniqueVueloIds.add(rutasModificables.get(i).getFlights().get(0).getId());
                        }
                }

                if (!"alns".equalsIgnoreCase(algorithm) || uniqueVueloIds.isEmpty()) {
                        markCancelled(rutasModificables, cancelCount, Collections.emptySet());
                        return 0;
                }

                Solution tempSol = new Solution();
                tempSol.setRoutes(routes);

                List<CompletableFuture<Set<Long>>> futures = uniqueVueloIds.stream().map(vId -> 
                        CompletableFuture.supplyAsync(() -> alnsPlanner.doReplan(tempSol, vId, REPLAN_WINDOW_MS), replanExecutor)
                        .handle((sol, ex) -> (ex == null && sol != null && !sol.getRoutes().isEmpty()) ? Set.of(vId) : Collections.<Long>emptySet())
                ).collect(Collectors.toList());

                Set<Long> rescuedVueloIds = futures.stream().flatMap(f -> f.join().stream()).collect(Collectors.toSet());
                markCancelled(rutasModificables, cancelCount, rescuedVueloIds);
                return (int) rutasModificables.stream().limit(cancelCount).filter(r -> "rescued".equals(r.getStatus())).count();
        }

        private void markCancelled(List<Route> routes, int count, Set<Long> rescued) {
                for (int i = 0; i < count && i < routes.size(); i++) {
                        Route r = routes.get(i);
                        if (!r.getFlights().isEmpty() && rescued.contains(r.getFlights().get(0).getId())) {
                                r.setStatus("rescued");
                        } else {
                                r.setStatus("cancelled");
                                r.setCapacidadAsignada(0);
                        }
                }
        }

        static CollapseCheckResult checkEndCondition(SimulationProgressHolder.SimulationSessionState session, SimulationDayReport report, SimulationState state, Map<String, Aeropuerto> airportMap, double threshold, int consecutive) {
                return switch (session.getEndCondition()) {
                        case SLA_BELOW_THRESHOLD -> {
                                int streak = report.getSlaPercent() < threshold ? session.getSlaStreak() + 1 : 0;
                                session.setSlaStreak(streak);
                                yield new CollapseCheckResult(streak >= consecutive, String.format("SLA < %.1f%% por %d días", threshold, consecutive));
                        }
                        case ALL_AIRPORTS_CRITICAL -> {
                                long crit = airportMap.keySet().stream().filter(icao -> state.getOccupancyPercent(icao, airportMap) >= 90).count();
                                yield new CollapseCheckResult(crit >= airportMap.size(), "Todos los aeropuertos críticos");
                        }
                        default -> new CollapseCheckResult(false, "NONE");
                };
        }

        record CollapseCheckResult(boolean terminated, String reason) {}
}
