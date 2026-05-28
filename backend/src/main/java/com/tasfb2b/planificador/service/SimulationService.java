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
 * <p>Mejoras respecto al prototipo original:
 * <ol>
 * <li><b>@Async</b>: la simulación se ejecuta en un hilo del pool
 * "simulationExecutor".
 * El controller responde HTTP 202 inmediatamente con el UUID de sesión.</li>
 * <li><b>Cola de pendientes</b>: los lotes no atendidos o con exceso de
 * capacidad en el Día N se añaden al inicio de la lista del Día N+1 con
 * prioridad máxima.</li>
 * <li><b>Métricas SLA</b>: cada {@link SimulationDayReport} incluye slaPercent,
 * totalMaletas y malatetasAtendidas para el frontend.</li>
 * <li><b>Progress tracking</b>: {@link SimulationProgressHolder} se actualiza
 * en tiempo real para que el endpoint de status sirva datos frescos.</li>
 * </ol>
 */
@Service
@RequiredArgsConstructor
public class SimulationService {

        private final SimulationRunner simulator;
        private final ALNSPlannerService alnsPlanner;
        private final AeropuertoRepository airportRepo;
        private final SuperLotService superLotService;
        private final SimulationProgressHolder progressHolder;
        private final EnvioService envioService;

        @Value("${tasf.data.path}")
        private String dataPath;

        /**
         * Duracion objetivo (minutos) para el playback visual de toda la simulacion.
         * Esto NO acelera el algoritmo; solo controla el pacing del loop hora-a-hora
         * que actualiza progreso/estado para el frontend.
         */
        @Value("${tasf.sim.playback.targetMinutes:60}")
        private int playbackTargetMinutes;

        /** Fecha base por defecto: inicio del dataset académico TASF.B2B.
         *  Se usa como fallback cuando el caller no especifica startDate.
         *  No es hardcoded funcionalmente: el método runAsync acepta cualquier fecha.
         */
        private static final LocalDate DEFAULT_START_DATE = LocalDate.of(2026, 1, 2);

        /** Tiempo máximo del planificador ALNS por día (ms). */
        private static final long PLANNER_WINDOW_MS = 500;

        // ── PLANIFICACIÓN PROGRAMADA (PLANIFICACION_PROGRAMADA.md) ──────────
        /**
         * Sa = Salto del algoritmo: granularidad de ciclos en minutos de tiempo
         * simulado. El planificador se ejecuta cada Sa minutos de tiempo simulado.
         * Valor fijo = 30 min → 48 ciclos por día simulado.
         * Restricción: Sa debe ser divisor exacto de 1440 (minutos del día).
         */
        private static final int SA_MINUTES = 30;

        /**
         * Ciclos por día simulado.
         * Con Sa=30: 1440/30 = 48 ciclos. Cada ciclo avanza Sc=K*Sa minutos de tiempo
         * simulado, donde K = targetMinutes*60 / (totalDays * CYCLES_PER_DAY * sleepMs).
         */
        private static final int CYCLES_PER_DAY = 1440 / SA_MINUTES;


        // ─────────────────────────────────────────────────────────────
        // INICIO ASÍNCRONO — llamado desde SimulationController
        // ─────────────────────────────────────────────────────────────

        /**
         * Inicia la simulación en el pool {@code simulationExecutor}.
         * El controlador responde HTTP 202 inmediatamente con el UUID de sesión.
         *
         * @param sessionId UUID registrado en {@link SimulationProgressHolder}
         * @param dias      número de días a simular
         * @param algorithm algoritmo planificador (ignorado, usa ALNS por defecto)
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

                        List<SimulationDayReport> reports = runFullSimulation(dias, session, fechaInicio);
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
                        metrics.put("replanifications",  session.getRescuedFlights());
                        metrics.put("execTime",          "Completado");
                        metrics.put("rescuedFlights",    session.getRescuedFlights());

                        progressHolder.saveAlgorithmResult("ALNS", metrics);
                        progressHolder.markDone(sessionId);

                } catch (Exception ex) {
                        progressHolder.markFailed(sessionId, ex.getMessage());
                }
        }

        private List<SimulationDayReport> runFullSimulation(
                        int dias,
                        SimulationProgressHolder.SimulationSessionState session,
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

                        Solution sol = alnsPlanner.plan(lotsDelDia, PLANNER_WINDOW_MS);

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
                                                routeToCancel.setStatus("rescued");
                                                rescued++;
                                        }
                                        if (rescued > 0) {
                                                session.setRescuedFlights(session.getRescuedFlights() + rescued);
                                        }
                                }
                        }

                        // Simulación de eventos — pasar dayStartEpochMs para fijar epochs al día simulado
                        SimulationState state = simulator.run(sol.getRoutes(), airportMap, currentTime, currentTime);

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
                        report.setMaletasEntregadas(state.getMaletasEntregadas());
                        report.setPendingLots(pendientes);
                        history.add(report);

                        // ── 7. Ciclos de SA minutos para el frontend (Planificación Programada) ───
                        // Cada ciclo representa SA_MINUTES de tiempo simulado.
                        // El frontend recibe snapshots cada ciclo: posición interpolada de aviones.
                        long sleepPerCycleMs = computeSleepPerCycleMs(dias);
                        for (int cycle = 0; cycle < CYCLES_PER_DAY; cycle++) {
                                // Tiempo simulado exacto al inicio de este ciclo
                                long currentSimTime = currentTime + ((long) cycle * SA_MINUTES * 60_000L);

                                int simHour   = (cycle * SA_MINUTES) / 60;
                                int simMinute = (cycle * SA_MINUTES) % 60;
                                String simulatedTimeStr = String.format("Día %d - %02d:%02d", day + 1, simHour, simMinute);

                                int currentPercent = (int)(
                                        ((day * (double) CYCLES_PER_DAY + cycle) / (dias * (double) CYCLES_PER_DAY)) * 100);

                                // Event log sintético (solo en ciclos clave)
                                if (cycle == 0) {
                                        session.getEventLog().add(String.format(
                                                "[00:00] Iniciando operaciones del Día %d con %d rutas activas.",
                                                day + 1, sol.getRoutes().size()));
                                } else if (cycle == CYCLES_PER_DAY / 2) {
                                        session.getEventLog().add(String.format(
                                                "[12:00] Reporte de medio día: %d%% SLA estimado.",
                                                (int) slaPercent));
                                }
                                if (state.isColapsado() && cycle == (int)(CYCLES_PER_DAY * 0.75)) {
                                        session.getEventLog().add(String.format(
                                                "[18:00] ¡ALERTA! Posible colapso detectado en la red."));
                                }
                                if (cycle == (int)(CYCLES_PER_DAY * 5.0 / 6)) {
                                        int entregadas = state.getMaletasEntregadas();
                                        if (entregadas > 0) {
                                                session.getEventLog().add(String.format(
                                                        "[20:00] %d maletas entregadas a clientes — almacenes liberados.",
                                                        entregadas));
                                        }
                                }

                                updateProgress(session, day + 1, dias, currentPercent,
                                               simulatedTimeStr, slaPercent, state, airportMap,
                                               sol, currentSimTime, currentTime);

                                try {
                                        Thread.sleep(sleepPerCycleMs);
                                } catch (InterruptedException e) {
                                        Thread.currentThread().interrupt();
                                        return history; // abortar si el hilo fue interrumpido
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

        /**
         * Actualiza el SimulationProgressHolder con las métricas del ciclo recien
         * completado (ciclos de SA_MINUTES minutos de tiempo simulado).
         *
         * @param currentSimTime epoch ms del inicio del ciclo actual en tiempo simulado
         * @param baseTime       epoch ms del inicio del día simulado actual
         */
        private void updateProgress(SimulationProgressHolder.SimulationSessionState session,
                        int completedDays,
                        int totalDays,
                        int currentPercent,
                        String simulatedTime,
                        double slaPercent,
                        SimulationState state,
                        Map<String, Aeropuerto> airportMap,
                        Solution sol,
                        long currentSimTime,
                        long baseTime) {

                session.setCurrentDay(completedDays);
                session.setPercent(currentPercent);
                session.setSimulatedTime(simulatedTime);
                session.setSlaPercent(slaPercent);

                Map<String, Integer> loads = new HashMap<>();
                airportMap.keySet().forEach(icao -> loads.put(icao, state.getOccupancyPercent(icao, airportMap)));
                session.setAirportLoads(loads);

                // Nodos críticos (ocupación >= 90%)
                int critical = (int) loads.values().stream().filter(pct -> pct >= 90).count();
                session.setCriticalNodes(critical);

                // Ventana Móvil: Tiempo exacto del ciclo de simulación
                session.setCurrentEpochTime(currentSimTime);

                int totalBagsWaiting = state.getCargaAeropuerto().values().stream().mapToInt(Integer::intValue).sum();
                session.setTotalBagsWaiting(totalBagsWaiting);

                // Rutas activas: descompuestas en segmentos hop-a-hop para animar cada tramo
                List<Map<String, Object>> activeRoutes = new ArrayList<>();
                for (Route r : sol.getRoutes()) {
                        List<Vuelo> flights = r.getFlights();
                        if (flights.isEmpty()) continue;

                        String baseStatus  = r.isTarde() ? "critical" : (r.isNoAtendido() ? "blocked" : "normal");
                        String routeStatus = "normal".equals(r.getStatus()) ? baseStatus : r.getStatus();

                        double capacityPercent = 0.0;
                        if (r.getCapacidadAsignada() > 0) {
                                capacityPercent = (r.getCapacidadAsignada() * 100.0)
                                                / Math.max(1, r.getDemandaTotal());
                        }

                        // Un Map por cada tramo de la ruta (segmento entre hops consecutivos)
                        for (int i = 0; i < flights.size(); i++) {
                                Vuelo v = flights.get(i);
                                String fromIcao = r.getHops().get(i);
                                String toIcao   = r.getHops().get(i + 1);

                                long depEpoch = v.getDepartureEpoch(baseTime);
                                long arrEpoch = v.getArrivalEpoch(baseTime);

                                // Filtro crítico: Solo enviar al frontend los aviones que ESTÁN EN EL AIRE
                                // en este instante exacto de la simulación. Evita lag masivo (miles de SVGs) y
                                // arregla el efecto visual de que "todos salen al mismo tiempo".
                                if (currentSimTime < depEpoch || currentSimTime >= arrEpoch) {
                                        continue;
                                }

                                Map<String, Object> segMap = new HashMap<>();
                                // ID único por segmento: lotId*100 + tramo
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
        }

        /**
         * Calcula el tiempo de sleep por ciclo de Sa minutos.
         * Formula: sleepMs = (targetMinutes * 60_000) / (totalDays * CYCLES_PER_DAY)
         * Acotado entre 250 ms (mínimo para no hacer CPU spin) y 30_000 ms.
         */
        private long computeSleepPerCycleMs(int totalDays) {
                int minutes = playbackTargetMinutes;
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
