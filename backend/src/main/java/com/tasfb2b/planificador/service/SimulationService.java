package com.tasfb2b.planificador.service;

/*
 * Sistema TASF.B2B — Motor de Optimización Logística
 * Grupo 4D — Curso de Proyecto de Diseño de Software
 * Autores: Jim Navarrete, Diego Silvestre, Jose Avalos, Mathias Medina
 * Fecha: Mayo 2026
 */

import com.tasfb2b.aeropuerto.domain.Aeropuerto;
import com.tasfb2b.aeropuerto.repository.AeropuertoRepository;
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
import org.springframework.beans.factory.annotation.Value;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Servicio de simulación multi-día con ejecución asíncrona.
 *
 * <p>Ejecuta el ciclo diario de planificación y simulación de eventos para
 * un rango de fechas dado, propagando lotes pendientes entre días y reportando
 * métricas en tiempo real a través de {@link SimulationProgressHolder}.
 *
 * <p>Soporta modo colapso ({@code collapseMode=true}), que inyecta reducción
 * de infraestructura y cancelaciones aleatorias para validar la resiliencia del ALNS.
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
        private final SimpMessagingTemplate messagingTemplate;

        @Value("${tasf.data.path}")
        private String dataPath;

        @Value("${tasf.sim.playback.targetMinutes:60}")
        private int playbackTargetMinutes;

        private static final int SA_MINUTES = 30;
        private static final int CYCLES_PER_DAY = 1440 / SA_MINUTES;

        private static final LocalDate DEFAULT_START_DATE = LocalDate.of(2026, 1, 1);
        private static final long HGA_WINDOW_MS = 8_000L;

        public record WsEnvelope<T>(long seq, T data) {}

        /**
         * Inicia la simulación en el pool {@code simulationExecutor}.
         * El controlador responde HTTP 202 inmediatamente con el UUID de sesión.
         *
         * @param sessionId UUID registrado en {@link SimulationProgressHolder}
         * @param dias      número de días a simular
         * @param algorithm algoritmo planificador ("HGA" | "ALNS")
         * @param startDate fecha de inicio; si es null se usa {@code DEFAULT_START_DATE}
         */
        @Async("simulationExecutor")
        public void runAsync(String sessionId, int dias, String algorithm, LocalDate startDate, int playbackMinutes) {
                SimulationProgressHolder.SimulationSessionState session = progressHolder.get(sessionId);
                if (session == null) {
                        return;
                } LocalDate fechaInicio = (startDate != null) ? startDate : DEFAULT_START_DATE;

                try {
                        LocalDate fin = fechaInicio.plusDays(dias - 1);
                        envioService.cargarPorFecha(fechaInicio, fin, dataPath);

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

                        // Calcular longitud promedio de ruta real (vuelos por ruta)
                        double avgRouteLength = reports.stream()
                                .flatMap(r -> r.getRoutes().stream())
                                .filter(r -> !r.getFlights().isEmpty())
                                .mapToInt(r -> r.getFlights().size())
                                .average()
                                .orElse(0.0);

                        Map<String, Object> metrics = new HashMap<>();
                        metrics.put("deliveredOnTime",  totalAttended);
                        metrics.put("totalDeliveries",  totalDemand);
                        metrics.put("slaPercent",        slaFinal);
                        metrics.put("avgRouteLength",    Math.round(avgRouteLength * 10.0) / 10.0);
                        metrics.put("replanifications",  session.getRescuedFlights());
                        metrics.put("execTime",          "Completado");
                        metrics.put("rescuedFlights",    session.getRescuedFlights());

                        progressHolder.saveAlgorithmResult(algorithm != null ? algorithm : "HGA", metrics);
                        progressHolder.markDone(sessionId);
                        
                        // Enviar mensaje final de completado
                        messagingTemplate.convertAndSend(
                            "/topic/sim/" + sessionId + "/kpi", 
                            new WsEnvelope<>(System.currentTimeMillis(), session)
                        );

                } catch (Exception ex) {
                        progressHolder.markFailed(sessionId, ex.getMessage());
                        // Enviar mensaje final de error
                        messagingTemplate.convertAndSend(
                            "/topic/sim/" + sessionId + "/kpi", 
                            new WsEnvelope<>(System.currentTimeMillis(), session)
                        );
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

                List<SimulationDayReport> history = new ArrayList<>();
                long currentTime = fechaInicio.atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli();
                List<SuperLot> pendientes = new ArrayList<>();

                for (int day = 0; day < dias; day++) {

                        LocalDate fechaDia = fechaInicio.plusDays(day);
                        List<SuperLot> lotsDelDia = new ArrayList<>(pendientes);
                        lotsDelDia.addAll(superLotService.agruparEnviosPorFecha(fechaDia));

                        Solution sol;
                        if ("alns".equalsIgnoreCase(algorithm)) {
                                sol = alnsPlanner.plan(lotsDelDia, HGA_WINDOW_MS);
                        } else {
                                sol = planner.plan(lotsDelDia, null, HGA_WINDOW_MS);
                        }

                        if (session.isCollapseMode()) {
                                for (String hub : Arrays.asList("SKBO", "LEMD", "VIDP")) {
                                        Aeropuerto a = airportMap.get(hub);
                                        if (a != null) a.setStorageCapacity(a.getStorageCapacity() / 2);
                                }

                                List<Route> routes = sol.getRoutes();
                                if (!routes.isEmpty()) {
                                        double cancelFraction = session.getStressFactor() * 0.03; // ×1→3%, ×10→30%
                                        int cancelCount = (int) Math.max(1, routes.size() * cancelFraction);
                                        log.info("[Colapso] Estrés ×{} → cancelando {} rutas ({} %)",
                                                session.getStressFactor(), cancelCount,
                                                Math.round(cancelFraction * 100));
                                        List<Route> rutasModificables = new ArrayList<>(routes);
                                        Collections.shuffle(rutasModificables);

                                        int rescued = 0;
                                        for (int i = 0; i < cancelCount; i++) {
                                                Route routeToCancel = rutasModificables.get(i);
                                                routeToCancel.setStatus("cancelled");
                                                if ("alns".equalsIgnoreCase(algorithm)
                                                                && !routeToCancel.getFlights().isEmpty()) {
                                                        Long vueloId = routeToCancel.getFlights().get(0).getId();
                                                        try {
                                                                Solution replanned = alnsPlanner.replanificar(vueloId, 250L);
                                                                if (replanned != null && !replanned.getRoutes().isEmpty()) {
                                                                        routeToCancel.setStatus("rescued");
                                                                        rescued++;
                                                                } else {
                                                                        routeToCancel.setCapacidadAsignada(0);
                                                                }
                                                        } catch (Exception e) {
                                                                log.warn("Fallo en replanificación ALNS para vuelo {}: {}", vueloId, e.getMessage());
                                                                routeToCancel.setCapacidadAsignada(0);
                                                        }
                                                } else {
                                                        routeToCancel.setCapacidadAsignada(0);
                                                }
                                        }
                                        if (rescued > 0) {
                                                session.setRescuedFlights(session.getRescuedFlights() + rescued);
                                        }
                                }
                        }

                        SimulationState state = simulator.run(sol.getRoutes(), airportMap, currentTime);

                        int totalMaletas       = lotsDelDia.stream().mapToInt(SuperLot::getTotalMaletas).sum();
                        int malatetasAtendidas = sol.getRoutes().stream().mapToInt(Route::getCapacidadAsignada).sum();
                        double slaPercent      = totalMaletas == 0 ? 0 : (malatetasAtendidas * 100.0) / totalMaletas;

                        final long capturedTime = currentTime;
                        pendientes = sol.getRoutes().stream()
                                        .filter(r -> r.excedeCapacidad() || r.isNoAtendido())
                                        .map(r -> elevateToMaxPriority(r.getLot(), capturedTime))
                                        .collect(Collectors.toList());

                        SimulationDayReport report = new SimulationDayReport();
                        report.setDayIndex(day);
                        report.setStartTime(currentTime);
                        report.setEndTime(currentTime + 24L * 60 * 60 * 1000);
                        report.setRoutes(sol.getRoutes());
                        report.setColapsed(state.isColapsado());
                        report.setAirportSaturation(state.getSaturacionAeropuerto());
                        report.setCollapseTime(state.isColapsado() ? state.getCurrentTime() : -1L);
                        report.setSlaPercent(slaPercent);
                        report.setTotalMaletas(totalMaletas);
                        report.setMalatetasAtendidas(malatetasAtendidas);
                        report.setPendingLots(pendientes);
                        history.add(report);

                        long sleepPerCycleMs = computeSleepPerCycleMs(dias, playbackMinutes);
                        for (int cycle = 0; cycle < CYCLES_PER_DAY; cycle++) {
                                long currentSimTime = currentTime + ((long) cycle * SA_MINUTES * 60_000L);
                                int simHour   = (cycle * SA_MINUTES) / 60;
                                int simMinute = (cycle * SA_MINUTES) % 60;
                                String simulatedTimeStr = String.format("Día %d - %02d:%02d", day + 1, simHour, simMinute);

                                int currentPercent = (int) (((day * (double) CYCLES_PER_DAY + cycle) / (dias * (double) CYCLES_PER_DAY)) * 100);

                                if (cycle == 0) {
                                        String logMsg = String.format("[00:00] Iniciando operaciones del Día %d con %d rutas activas.", day + 1, sol.getRoutes().size());
                                        session.getEventLog().add(logMsg);
                                        messagingTemplate.convertAndSend("/topic/sim/" + session.getSessionId() + "/eventLog", new WsEnvelope<>(System.currentTimeMillis(), logMsg));
                                } else if (cycle == CYCLES_PER_DAY / 2) {
                                        String logMsg = String.format("[12:00] Reporte de medio día: %d%% SLA estimado.", (int) slaPercent);
                                        session.getEventLog().add(logMsg);
                                        messagingTemplate.convertAndSend("/topic/sim/" + session.getSessionId() + "/eventLog", new WsEnvelope<>(System.currentTimeMillis(), logMsg));
                                }
                                if (state.isColapsado() && cycle == (int)(CYCLES_PER_DAY * 0.75)) {
                                        String logMsg = "[18:00] ¡ALERTA! Posible colapso detectado en la red.";
                                        session.getEventLog().add(logMsg);
                                        messagingTemplate.convertAndSend("/topic/sim/" + session.getSessionId() + "/eventLog", new WsEnvelope<>(System.currentTimeMillis(), logMsg));
                                }

                                updateProgress(session, day + 1, dias, currentPercent, simulatedTimeStr, slaPercent, state, airportMap, sol, currentSimTime, currentTime);

                                try {
                                        Thread.sleep(sleepPerCycleMs);
                                } catch (InterruptedException e) {
                                        Thread.currentThread().interrupt();
                                        return history;
                                }
                        }

                        currentTime += 24L * 60 * 60 * 1000;
                }

                return history;
        }



        /**
         * Eleva un lote no atendido a prioridad máxima para el día siguiente,
         * conservando únicamente la demanda original sin re-planificar cargas ya despachadas.
         */
        private SuperLot elevateToMaxPriority(SuperLot lot, long currentTime) {
                return new SuperLot(
                        lot.getId(), lot.getOrigenIcao(), lot.getDestinoIcao(),
                        lot.getTotalMaletas(),
                        currentTime + 24L * 60 * 60 * 1000,
                        lot.getSla(), lot.isIntercontinental(),
                        Integer.MAX_VALUE);
        }

        private void updateProgress(SimulationProgressHolder.SimulationSessionState session,
                        int completedDays, int totalDays, int currentPercent,
                        String simulatedTime, double slaPercent,
                        SimulationState state, Map<String, Aeropuerto> airportMap,
                        Solution sol, long currentSimTime, long baseTime) {

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

                List<Map<String, Object>> activeRoutes = new ArrayList<>();
                for (Route r : sol.getRoutes()) {
                        List<Vuelo> flights = r.getFlights();
                        if (flights.isEmpty()) continue;

                        String baseStatus  = r.isTarde() ? "critical" : (r.isNoAtendido() ? "blocked" : "normal");
                        String routeStatus = "normal".equals(r.getStatus()) ? baseStatus : r.getStatus();

                        double capacityPercent = r.getCapacidadAsignada() > 0
                                ? (r.getCapacidadAsignada() * 100.0) / Math.max(1, r.getDemandaTotal())
                                : 0.0;

                        for (int i = 0; i < flights.size(); i++) {
                                Vuelo v = flights.get(i);
                                String fromIcao = r.getHops().get(i);
                                String toIcao   = r.getHops().get(i + 1);

                                long depEpoch = v.getDepartureEpoch(baseTime);
                                long arrEpoch = v.getArrivalEpoch(baseTime);

                                if (currentSimTime < depEpoch || currentSimTime >= arrEpoch) {
                                        continue;
                                }

                                Map<String, Object> segMap = new HashMap<>();
                                segMap.put("id",             r.getLot().getId() * 100L + i);
                                segMap.put("from",           fromIcao);
                                segMap.put("to",             toIcao);
                                segMap.put("progress",       computeFlightProgress(currentSimTime, depEpoch, arrEpoch));
                                segMap.put("status",         routeStatus);
                                segMap.put("departureTime",  depEpoch);
                                segMap.put("arrivalTime",    arrEpoch);
                                segMap.put("capacityPercent",capacityPercent);
                                activeRoutes.add(segMap);
                        }
                }
                session.setActiveRoutes(activeRoutes);
                
                // Broadcastear estado por WebSocket
                WsEnvelope<SimulationProgressHolder.SimulationSessionState> env = new WsEnvelope<>(System.currentTimeMillis(), session);
                messagingTemplate.convertAndSend("/topic/sim/" + session.getSessionId() + "/kpi", env);
                messagingTemplate.convertAndSend("/topic/sim/" + session.getSessionId() + "/snapshot", env);
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
                if (dep <= 0 || arr <= 0 || arr <= dep) {
                        return 0.0;
                }
                double p = (currentEpochTime - dep) / (double) (arr - dep);
                if (p < 0) return 0.0;
                if (p > 1) return 1.0;
                return p;
        }
}
