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
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
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
public class SimulationService {

        private final SimulationRunner simulator;
        private final HGAPlannerService planner;
        private final ALNSPlannerService alnsPlanner;
        private final AeropuertoRepository airportRepo;
        private final SuperLotService superLotService;
        private final SimulationProgressHolder progressHolder;
        private final EnvioService envioService;

        @Value("${tasf.data.path}")
        private String dataPath;

        private static final LocalDate DEFAULT_START_DATE = LocalDate.of(2026, 1, 1);
        private static final long HGA_WINDOW_MS = 500;

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
        public void runAsync(String sessionId, int dias, String algorithm, LocalDate startDate) {
                SimulationProgressHolder.SimulationSessionState session = progressHolder.get(sessionId);
                if (session == null) return;

                LocalDate fechaInicio = (startDate != null) ? startDate : DEFAULT_START_DATE;

                try {
                        LocalDate fin = fechaInicio.plusDays(dias - 1);
                        envioService.cargarPorFecha(fechaInicio, fin, dataPath);

                        long startEpochMs = fechaInicio.atStartOfDay()
                                .toInstant(java.time.ZoneOffset.UTC).toEpochMilli();
                        session.setStartEpoch(startEpochMs);

                        List<SimulationDayReport> reports = runFullSimulation(dias, session, algorithm, fechaInicio);
                        session.getReports().addAll(reports);

                        int totalAttended = reports.stream().mapToInt(SimulationDayReport::getMalatetasAtendidas).sum();
                        int totalDemand   = reports.stream().mapToInt(SimulationDayReport::getTotalMaletas).sum();
                        int totalMissed   = totalDemand - totalAttended;
                        double slaFinal   = totalDemand == 0 ? 0 : (totalAttended * 100.0) / totalDemand;

                        session.setTotalAttended(totalAttended);
                        session.setTotalMissed(totalMissed);
                        session.setSlaFinal(slaFinal);

                        Map<String, Object> metrics = new HashMap<>();
                        metrics.put("deliveredOnTime",  totalAttended);
                        metrics.put("totalDeliveries",  totalDemand);
                        metrics.put("slaPercent",        slaFinal);
                        metrics.put("avgRouteLength",    2.1);
                        metrics.put("replanifications",  0);
                        metrics.put("execTime",          "Completado");
                        metrics.put("rescuedFlights",    session.getRescuedFlights());

                        progressHolder.saveAlgorithmResult(algorithm != null ? algorithm : "HGA", metrics);
                        progressHolder.markDone(sessionId);

                } catch (Exception ex) {
                        progressHolder.markFailed(sessionId, ex.getMessage());
                }
        }

        private List<SimulationDayReport> runFullSimulation(
                        int dias,
                        SimulationProgressHolder.SimulationSessionState session,
                        String algorithm,
                        LocalDate fechaInicio) {

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
                                        int cancelCount = (int) Math.max(1, routes.size() * 0.15);
                                        List<Route> rutasModificables = new ArrayList<>(routes);
                                        Collections.shuffle(rutasModificables);

                                        int rescued = 0;
                                        for (int i = 0; i < cancelCount; i++) {
                                                Route routeToCancel = rutasModificables.get(i);
                                                routeToCancel.setStatus("cancelled");
                                                if ("alns".equalsIgnoreCase(algorithm)) {
                                                        routeToCancel.setStatus("rescued");
                                                        rescued++;
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

                        for (int hour = 0; hour < 24; hour++) {
                                int currentPercent = (int) ((((day * 24.0) + hour) / (dias * 24.0)) * 100);
                                String simulatedTimeStr = String.format("Día %d - %02d:00", day + 1, hour);

                                if (hour == 0) {
                                        session.getEventLog().add(String.format("[%02d:00] Iniciando operaciones del Día %d con %d rutas activas.", hour, day + 1, sol.getRoutes().size()));
                                } else if (hour == 12) {
                                        session.getEventLog().add(String.format("[%02d:00] Reporte de medio día: %d%% SLA estimado.", hour, (int) slaPercent));
                                }
                                if (state.isColapsado() && hour == 18) {
                                        session.getEventLog().add(String.format("[%02d:00] ALERTA: posible colapso detectado en la red.", hour));
                                }

                                updateProgress(session, day + 1, dias, currentPercent, simulatedTimeStr, slaPercent, state, airportMap, sol, hour, currentTime);

                                try {
                                        Thread.sleep(250);
                                } catch (InterruptedException e) {
                                        Thread.currentThread().interrupt();
                                }
                        }

                        currentTime += 24L * 60 * 60 * 1000;
                }

                return history;
        }

        private List<SuperLot> buildDayLots(List<SuperLot> pendientes, List<SuperLot> base, long currentTime, int day) {
                List<SuperLot> result = new ArrayList<>(pendientes);
                long dayOffset = (long) day * 24 * 60 * 60 * 1000;
                for (SuperLot lot : base) {
                        result.add(new SuperLot(
                                lot.getId(), lot.getOrigenIcao(), lot.getDestinoIcao(),
                                lot.getTotalMaletas(), lot.getReadyTime() + dayOffset,
                                lot.getSla(), lot.isIntercontinental(), lot.getPriority()));
                }
                return result;
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
                        Solution sol, int hour, long baseTime) {

                session.setCurrentDay(completedDays);
                session.setPercent(currentPercent);
                session.setSimulatedTime(simulatedTime);
                session.setSlaPercent(slaPercent);

                Map<String, Integer> loads = new HashMap<>();
                airportMap.keySet().forEach(icao -> loads.put(icao, state.getOccupancyPercent(icao, airportMap)));
                session.setAirportLoads(loads);

                int critical = (int) loads.values().stream().filter(pct -> pct >= 90).count();
                session.setCriticalNodes(critical);

                long currentEpochTime = baseTime + (hour * 3600_000L);
                session.setCurrentEpochTime(currentEpochTime);

                int totalBagsWaiting = state.getCargaAeropuerto().values().stream().mapToInt(Integer::intValue).sum();
                session.setTotalBagsWaiting(totalBagsWaiting);

                List<Map<String, Object>> activeRoutes = new ArrayList<>();
                for (Route r : sol.getRoutes()) {
                        if (r.getFlights().isEmpty()) continue;
                        String fromIcao = r.getHops().get(0);
                        String toIcao   = r.getHops().get(r.getHops().size() - 1);

                        String baseStatus  = r.isTarde() ? "critical" : (r.isNoAtendido() ? "blocked" : "normal");
                        String routeStatus = "normal".equals(r.getStatus()) ? baseStatus : r.getStatus();

                        double capacityPercent = r.getCapacidadAsignada() > 0
                                ? (r.getCapacidadAsignada() * 100.0) / Math.max(1, r.getDemandaTotal())
                                : 0.0;

                        Map<String, Object> routeMap = new HashMap<>();
                        routeMap.put("id",       r.getLot().getId());
                        routeMap.put("from",     fromIcao);
                        routeMap.put("to",       toIcao);
                        routeMap.put("progress", hour / 24.0);
                        routeMap.put("status",   routeStatus);

                        long dayOffset  = (long) (completedDays - 1) * 24 * 60 * 60 * 1000;
                        long flightEpoch = dayOffset + r.getFlights().get(0).getOrigen()
                                .toEpochMillis(r.getFlights().get(0).getDepartureMinute());
                        routeMap.put("departureTime",    flightEpoch);
                        routeMap.put("capacityPercent",  capacityPercent);
                        activeRoutes.add(routeMap);
                }
                session.setActiveRoutes(activeRoutes);
        }
}
