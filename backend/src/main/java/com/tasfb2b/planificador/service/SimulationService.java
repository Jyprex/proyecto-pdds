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
@Slf4j
public class SimulationService {

        private final SimulationRunner simulator;
        private final ALNSPlannerService alnsPlanner;
        private final AeropuertoRepository airportRepo;
        private final SuperLotService superLotService;
        private final SimulationProgressHolder progressHolder;
        private final EnvioService envioService;
        private final SimpMessagingTemplate messagingTemplate;

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

        public record WsEnvelope<T>(long seq, T data) {}

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

                        progressHolder.saveAlgorithmResult("ALNS", metrics);
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
                List<Route> inTransitRoutes = new ArrayList<>();

                for (int day = 0; day < dias; day++) {

                        LocalDate fechaDia = fechaInicio.plusDays(day);
                        List<SuperLot> lotsDelDia = new ArrayList<>(pendientes);
                        lotsDelDia.addAll(superLotService.agruparEnviosPorFecha(fechaDia));

                        long sleepPerCycleMs = computeSleepPerCycleMs(dias, playbackMinutes);
                        Solution ultimaSolucionDelDia = new Solution(); // Acumulador
                        ultimaSolucionDelDia.setRoutes(new ArrayList<>());
                        
                        for (int cycle = 0; cycle < CYCLES_PER_DAY; cycle++) {
                                // Tiempo simulado exacto al inicio de este ciclo
                                long currentSimTime = currentTime + ((long) cycle * SA_MINUTES * 60_000L);
                                long nextSimTime = currentSimTime + (SA_MINUTES * 60_000L);

                                int simHour   = (cycle * SA_MINUTES) / 60;
                                int simMinute = (cycle * SA_MINUTES) % 60;
                                String simulatedTimeStr = String.format("Día %d - %02d:%02d", day + 1, simHour, simMinute);

                                int currentPercent = (int)(
                                        ((day * (double) CYCLES_PER_DAY + cycle) / (dias * (double) CYCLES_PER_DAY)) * 100);

                                // -- Micro-batching: Extraer lotes de esta ventana + pendientes
                                List<SuperLot> lotesVentana = lotsDelDia.stream()
                                    .filter(l -> l.getReadyTime() < nextSimTime)
                                    .collect(Collectors.toList());

                                lotsDelDia.removeAll(lotesVentana);

                                // Ejecutar ALNS solo sobre los lotes de esta ventana
                                Solution sol = alnsPlanner.plan(lotesVentana, PLANNER_WINDOW_MS);

                                if (sol.esColapsada()) {
                                        session.setStatus(SimulationProgressHolder.Status.FAILED);
                                        session.setErrorMessage("Colapso: SLA incumplido en la planificación.");
                                        progressHolder.markFailed(session.getSessionId(), session.getErrorMessage());
                                        return history;
                                }

                                if (session.isCollapseMode()) {
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
                                                                        Solution replanned = alnsPlanner.replanificar(vueloId, 6_500L);
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

                                // Simulación de eventos — la simulación avanza estado globalmente, los eventos deben anclarse correctamente.
                                // Usamos el engine de eventos para avanzar el state.
                                SimulationState state = simulator.run(sol.getRoutes(), airportMap, currentSimTime, currentTime);
                                
                                ultimaSolucionDelDia.getRoutes().addAll(sol.getRoutes());
                                
                                // Añadir a en tránsito SOLO las rutas que tengan capacidad asignada (>0)
                                // para no animar vuelos fantasmas bloqueados.
                                inTransitRoutes.addAll(sol.getRoutes().stream()
                                        .filter(r -> r.getCapacidadAsignada() > 0)
                                        .collect(Collectors.toList()));
                                inTransitRoutes = inTransitRoutes.stream()
                                        .collect(Collectors.toMap(r -> r.getLot().getId(), r -> r, (a, b) -> b))
                                        .values()
                                        .stream()
                                        .collect(Collectors.toList());
                                
                                // Limpiar rutas que ya terminaron de volar hace más de un ciclo
                                inTransitRoutes.removeIf(r -> r.getArrivalTime() <= currentSimTime - (SA_MINUTES * 60_000L));

                                // Event log sintético (solo en ciclos clave)
                                if (cycle == 0) {
                                        session.getEventLog().add(String.format(
                                                "[00:00] Iniciando operaciones del Día %d con %d maletas en primer batch.",
                                                day + 1, lotesVentana.size()));
                                } else if (cycle == CYCLES_PER_DAY / 2) {
                                        session.getEventLog().add(String.format(
                                                "[12:00] Reporte de medio día."));
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

                                // Lotes que no pudieron ser enrutados completamente se devuelven para el siguiente ciclo.
                                // Si llegamos al final del día, los pasamos a `pendientes` para el día siguiente.
                                List<SuperLot> remanentes = sol.getRoutes().stream()
                                    .filter(r -> r.excedeCapacidad() || r.isNoAtendido())
                                    .map(r -> {
                                        SuperLot nextLot = elevateToMaxPriority(r.getLot(), currentSimTime);
                                        nextLot.setTotalMaletas(r.getDemandaNoAtendida());
                                        return nextLot;
                                    })
                                    .collect(Collectors.toList());
                                    
                                if (cycle < CYCLES_PER_DAY - 1) {
                                    lotsDelDia.addAll(remanentes); // Reintentar en siguiente batch hoy
                                } else {
                                    // Fin del día. Estos pasan a ser la semilla de pendientes de mañana.
                                    pendientes = remanentes;
                                }

                                // Metrics for frontend update (Snapshot)
                                // En este momento del ciclo reportaremos el progreso
                                double slaPercent = 100; // placeholder until day ends
                                updateProgress(session, day + 1, dias, currentPercent,
                                               simulatedTimeStr, slaPercent, state, airportMap,
                                               inTransitRoutes, currentSimTime, currentTime);

                                try {
                                        Thread.sleep(sleepPerCycleMs);
                                } catch (InterruptedException e) {
                                        Thread.currentThread().interrupt();
                                        return history; // abortar si el hilo fue interrumpido
                                }
                        }
                        
                        // --- AL FINAL DEL DIA CONSOLIDAR METRICAS ---
                        // Re-simular o simplemente consolidar el día para el histórico:
                        SimulationState endOfDayState = simulator.run(ultimaSolucionDelDia.getRoutes(), airportMap, currentTime, currentTime);
                        
                        // Total demand of the day was the original loaded
                        int totalMaletas       = ultimaSolucionDelDia.getRoutes().stream().mapToInt(r -> r.getLot().getTotalMaletas()).sum(); // Acumula todo lo visto
                        int malatetasAtendidas = ultimaSolucionDelDia.getRoutes().stream().mapToInt(Route::getCapacidadAsignada).sum();
                        double slaPercent      = totalMaletas == 0 ? 0 : (malatetasAtendidas * 100.0) / totalMaletas;

                        SimulationDayReport report = new SimulationDayReport();
                        report.setDayIndex(day);
                        report.setStartTime(currentTime);
                        report.setEndTime(currentTime + 24L * 60 * 60 * 1000);
                        report.setRoutes(ultimaSolucionDelDia.getRoutes());
                        report.setColapsed(endOfDayState.isColapsado());
                        report.setAirportSaturation(endOfDayState.getSaturacionAeropuerto());
                        report.setCollapseTime(endOfDayState.isColapsado() ? endOfDayState.getCurrentTime() : -1L);
                        report.setSlaPercent(slaPercent);
                        report.setTotalMaletas(totalMaletas);
                        report.setMalatetasAtendidas(malatetasAtendidas);
                        report.setMaletasEntregadas(endOfDayState.getMaletasEntregadas());
                        report.setPendingLots(pendientes); // Pasa al siguiente dia
                        history.add(report);

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
                        List<Route> activeRoutesList,
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

                session.setCurrentEpochTime(currentSimTime);

                int totalBagsWaiting = state.getCargaAeropuerto().values().stream().mapToInt(Integer::intValue).sum();
                session.setTotalBagsWaiting(totalBagsWaiting);

                // Rutas activas: descompuestas en segmentos hop-a-hop para animar cada tramo
                // Rutas activas: agrupadas por VUELO FÍSICO para no colapsar el frontend
                // La llave del mapa será "vueloId-depEpoch" para asegurar unicidad exacta por despegue
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

                                if (currentSimTime < depEpoch) {
                                        continue;
                                }
                                // No mantener segmentos tras aterrizar para evitar solapamiento visual.
                                if (currentSimTime >= arrEpoch) {
                                        continue;
                                }

                                String mapKey = v.getId() + "-" + depEpoch;

                                if (!vuelosFisicos.containsKey(mapKey)) {
                                        Map<String, Object> segMap = new HashMap<>();
                                        segMap.put("id", "vuelo-" + mapKey);
                                        segMap.put("from",           fromIcao);
                                        segMap.put("to",             toIcao);
                                        segMap.put("progress",       computeFlightProgress(currentSimTime, depEpoch, arrEpoch));
                                        segMap.put("status",         routeStatus);
                                        segMap.put("departureTime",  depEpoch);
                                        segMap.put("arrivalTime",    arrEpoch);
                                        
                                        segMap.put("ocupacionReal", r.getCapacidadAsignada());
                                        segMap.put("capacidadMax", v.getCapacidadTotal());
                                        vuelosFisicos.put(mapKey, segMap);
                                } else {
                                        Map<String, Object> existing = vuelosFisicos.get(mapKey);
                                        int ocupacionActual = (int) existing.get("ocupacionReal");
                                        existing.put("ocupacionReal", ocupacionActual + r.getCapacidadAsignada());
                                        
                                        // Priorizamos mostrar estados de alerta si algún paquete lo requiere
                                        String existingStatus = (String) existing.get("status");
                                        if ("critical".equals(routeStatus) || "rescued".equals(routeStatus)) {
                                                existing.put("status", routeStatus);
                                        } else if ("cancelled".equals(routeStatus) && !"rescued".equals(existingStatus)) {
                                                existing.put("status", routeStatus);
                                        }
                                }
                        }
                }

                // Generar lista final y calcular % de ocupación del avión físico
                List<Map<String, Object>> activeRoutes = new ArrayList<>();
                for (Map<String, Object> avion : vuelosFisicos.values()) {
                        int ocupacion = (int) avion.get("ocupacionReal");
                        int max = (int) avion.get("capacidadMax");
                        double capacityPercent = (ocupacion * 100.0) / Math.max(1, max);
                        avion.put("capacityPercent", Math.min(100.0, capacityPercent)); // Tope en 100% visual
                        
                        avion.remove("ocupacionReal");
                        avion.remove("capacidadMax");
                        activeRoutes.add(avion);
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
