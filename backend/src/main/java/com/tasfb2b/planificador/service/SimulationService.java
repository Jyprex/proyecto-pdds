package com.tasfb2b.planificador.service;

import com.tasfb2b.tracking.service.ShipmentTracker;
import com.tasfb2b.tracking.service.ShipmentTrackerRegistry;
import com.tasfb2b.planificador.domain.Event;
import com.tasfb2b.planificador.domain.EventType;
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
import com.tasfb2b.vuelo.repository.VueloRepository;
import com.tasfb2b.planificador.strategy.NetworkAdapter;
import com.tasfb2b.bloqueo.service.BloqueoService;
import com.tasfb2b.planificador.simulation.EventEngine;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executor;
import java.util.stream.Collectors;
import java.util.stream.Stream;

@Service
@RequiredArgsConstructor
@Slf4j
public class SimulationService {

        private final SimulationRunner simulator; // usado solo por ALNSPlannerService
        private final EventEngine eventEngine;
        private final ALNSPlannerService alnsPlanner;
        private final AeropuertoRepository airportRepo;
        private final VueloRepository vueloRepo;
        private final SuperLotService superLotService;
        private final SimulationProgressHolder progressHolder;
        private final EnvioService envioService;
        private final SimulationWsPublisher wsPublisher;
        private final NetworkAdapter networkAdapter;
        private final BloqueoService bloqueoService;
        private final ShipmentTrackerRegistry trackerRegistry;

        @Qualifier("blockComputeExecutor")
        private final Executor blockComputeExecutor;

        @Value("${tasf.data.path}")
        private String dataPath;

        private static final LocalDate DEFAULT_START_DATE = LocalDate.of(2026, 1, 2);

        private static final long ALNS_WINDOW_MS = 5000L;

        /** ← NUEVO: ventana ALNS reducida SOLO durante catch-up síncrono.
         *  El estado que produce se supera casi de inmediato con el primer
         *  ciclo real de streaming (ALNS_WINDOW_MS completo), así que no
         *  vale la pena pagar 5s por ciclo en un tramo que el usuario no ve. */
        private static final long CATCHUP_ALNS_WINDOW_MS = 2000L;

        private static final long SA_SECONDS = 60L;
        private static final long SC_MINUTES_REALTIME = 1L;

        // ← CAMBIO: 60 → 120. Con sa=60s y sc=120min: 7200 min (5 días) / 120 min-por-bloque
        // = 60 bloques × 60s = 3600s = 60 minutos totales, exactamente lo pedido.
        private static final long SC_MINUTES_PERIODO = 30L;
        private static final long SA_SECONDS_PERIODO = 15L; //para mantener 60 min
        private static final long SC_MINUTES_COLAPSO = 480L;

        private static final long TARGET_FRAME_INTERVAL_MS = 500L;

        @Async("simulationExecutor")
        public void runAsync(String sessionId, int dias, String algorithm, LocalDate startDate, int playbackMinutes,
                             String preCancelledFlightIds, String startTime, int saMinutes, int planningHorizon,
                             boolean isRealTime) {
                SimulationProgressHolder.SimulationSessionState session = progressHolder.get(sessionId);
                if (session == null) return;

                LocalDate fechaInicio = (startDate != null) ? startDate : DEFAULT_START_DATE;

                try {
                        long startEpochMs = fechaInicio.atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli();
                        session.setStartEpoch(startEpochMs);

                        List<SimulationDayReport> reports = runFullSimulation(
                                dias, session, algorithm, fechaInicio, startTime, saMinutes, planningHorizon, isRealTime);
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
                        metrics.put("deliveredOnTime", totalAttended);
                        metrics.put("totalDeliveries", totalDemand);
                        metrics.put("slaPercent", slaFinal);
                        metrics.put("avgRouteLength", Math.round(session.getAvgRouteLength() * 10.0) / 10.0);
                        metrics.put("replanifications", session.getRescuedFlights());
                        metrics.put("execTime", "Completado");
                        metrics.put("rescuedFlights", session.getRescuedFlights());
                        progressHolder.saveAlgorithmResult("ALNS", metrics);

                        progressHolder.markDone(sessionId);
                        wsPublisher.pushImmediate(sessionId, session);

                } catch (Exception ex) {
                        log.error("Simulation failed", ex);
                        progressHolder.markFailed(sessionId, ex.getMessage());
                        wsPublisher.pushImmediate(sessionId, session);
                }
        }

        public record PreCancellation(Long flightId, Integer day) {}

        private List<SimulationDayReport> runFullSimulation(
                int dias, SimulationProgressHolder.SimulationSessionState session, String algorithm,
                LocalDate fechaInicio, String startTimeStr, int saMinutes, int planningHorizon, boolean isRealTime) {

                ShipmentTracker shipmentTracker = trackerRegistry.getOrCreate(session.getSessionId());

                restaurarVuelosEnBD();

                Map<String, Aeropuerto> airportMap = airportRepo.findAll().stream()
                        .collect(Collectors.toMap(Aeropuerto::getIcaoCode, a -> a));

                int initHour = 0, initMin = 0;
                if (startTimeStr != null && startTimeStr.contains(":")) {
                        try {
                                String[] parts = startTimeStr.split(":");
                                initHour = Integer.parseInt(parts[0].trim());
                                initMin = Integer.parseInt(parts[1].trim());
                        } catch (Exception ignored) {}
                }
                long startTime = fechaInicio.atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli();
                long initialDisplayTime = startTime + (initHour * 3600_000L) + (initMin * 60_000L);

                if (startTimeStr != null && !startTimeStr.isBlank()) {
                        session.setStatus(SimulationProgressHolder.Status.RECONSTRUCTING);
                }

                List<Vuelo> todosLosVuelos = new CopyOnWriteArrayList<>(vueloRepo.findAllWithAirports());

                updateProgress(session, 1, dias, 0, "Inicializando...", 100.0,
                        new SimulationState(new ArrayList<>(airportMap.values()), List.of(), initialDisplayTime, bloqueoService),
                        airportMap, List.of(), initialDisplayTime, startTime, algorithm, null, todosLosVuelos,
                        session.isCollapseMode(), 0, null, 0L, 0, Set.of());
                wsPublisher.pushImmediate(session.getSessionId(), session);

                boolean colapso = session.isCollapseMode();
                long scMinutes;
                long saSecondsForBlock;
                if (isRealTime) {
                        scMinutes = SC_MINUTES_REALTIME;
                        saSecondsForBlock = SA_SECONDS;
                } else if (colapso) {
                        scMinutes = SC_MINUTES_COLAPSO;
                        saSecondsForBlock = SA_SECONDS;
                } else {
                        scMinutes = SC_MINUTES_PERIODO;
                        saSecondsForBlock = SA_SECONDS_PERIODO;
                }
                long saRealMs = saSecondsForBlock * 1000L;
                log.info("[DOBLE-BUFFER] isRealTime={} colapso={} sa={}s sc={} min/bloque (lookahead máx≈{}min)",
                        isRealTime, colapso, saSecondsForBlock, scMinutes, scMinutes * 2);

                // El % de avance y el fin real de la simulación deben medirse desde la
                // hora EXACTA elegida por el usuario (initialDisplayTime), no desde
                // medianoche — arrancar a las 12:00 no debe "contar" medio día gratis.
                session.setActualStartEpoch(initialDisplayTime);
                long targetEndEpoch = initialDisplayTime + ((long) dias * 1440L * 60_000L);

                SimContext ctx = new SimContext(fechaInicio, dias, isRealTime, saMinutes, planningHorizon, dataPath,
                        new SimulationState(new ArrayList<>(airportMap.values()), todosLosVuelos, startTime, bloqueoService),
                        todosLosVuelos, airportMap, targetEndEpoch);

                List<SimulationDayReport> history = new ArrayList<>();

                long targetEpoch = startTime;
                if (startTimeStr != null && startTimeStr.contains(":")) {
                        targetEpoch = startTime + (initHour * 3600_000L) + (initMin * 60_000L);
                }
                Map<String, ActiveFlight> activeOverlay = new HashMap<>();
                if (targetEpoch > ctx.currentGlobalSimTime()) {
                        long catchUpMinutes = (targetEpoch - ctx.currentGlobalSimTime()) / 60_000L;
                        long tCatchUpStart = System.currentTimeMillis();
                        // ← isCatchUp=true: ver computeBlock, usa ciclos ALNS grandes+rápidos
                        SimBlock catchUpBlock = computeBlock(ctx, session, shipmentTracker, ctx.currentGlobalSimTime(), catchUpMinutes, true);
                        log.info("[CATCH-UP] {} minutos simulados calculados en {} ms reales",
                                catchUpMinutes, System.currentTimeMillis() - tCatchUpStart);
                        publishMasterPlanSnapshot(session, catchUpBlock);
                        replayBlock(catchUpBlock, session, shipmentTracker, airportMap, todosLosVuelos, algorithm, dias, 0L, activeOverlay);
                        history.addAll(catchUpBlock.closedDayReports());
                        if (catchUpBlock.collapsed()) {
                                finalizeCollapse(session, ctx, catchUpBlock);
                                return history;
                        }
                }

                SimBlock current = computeBlock(ctx, session, shipmentTracker, ctx.currentGlobalSimTime(), scMinutes, false);
                publishMasterPlanSnapshot(session, current);

                while (true) {
                        boolean esTerminal = current.collapsed() || ctx.isPastTarget();

                        CompletableFuture<SimBlock> futuro = null;
                        if (!esTerminal) {
                                long siguienteInicio = current.endSimTimeActual();
                                futuro = CompletableFuture.supplyAsync(() ->
                                        computeBlock(ctx, session, shipmentTracker,siguienteInicio, scMinutes, false), blockComputeExecutor);
                        }

                        replayBlock(current, session, shipmentTracker, airportMap, todosLosVuelos, algorithm, dias, saRealMs, activeOverlay);
                        history.addAll(current.closedDayReports());

                        if (current.collapsed()) {
                                finalizeCollapse(session, ctx, current);
                                break;
                        }
                        if (esTerminal) {
                                finalizeNormalCompletion(session, ctx, current);
                                break;
                        }

                        current = futuro.join();
                        publishMasterPlanSnapshot(session, current);
                }

                return history;
        }

        private void finalizeCollapse(SimulationProgressHolder.SimulationSessionState session, SimContext ctx, SimBlock block) {
                session.setCollapseReason(block.collapseReason());
                session.setCollapseDayIndex(block.dayAtEnd() + 1);
                if (block.lastMasterPlanRoutes() != null && !block.lastMasterPlanRoutes().isEmpty()) {
                        session.setFinalMasterPlan(buildFinalPlanSnapshot(block.lastMasterPlanRoutes(), ctx.dayStartEpochMs()));
                }
                log.warn("[COLAPSO] {}", block.collapseReason());
        }

        private void finalizeNormalCompletion(SimulationProgressHolder.SimulationSessionState session, SimContext ctx, SimBlock block) {
                if (block.lastMasterPlanRoutes() != null && !block.lastMasterPlanRoutes().isEmpty()) {
                        session.setFinalMasterPlan(buildFinalPlanSnapshot(block.lastMasterPlanRoutes(), ctx.dayStartEpochMs()));
                }
                log.info("[COMPLETADO] Simulación terminó normalmente en día {}. Plan final con {} vuelos.",
                        block.dayAtEnd() + 1, session.getFinalMasterPlan().size());
        }

        private void publishMasterPlanSnapshot(SimulationProgressHolder.SimulationSessionState session, SimBlock block) {
                session.setCurrentMasterPlanSnapshot(buildFinalPlanSnapshot(block.lastMasterPlanRoutes(), block.startSimTime()));
        }

        private static class SimContext {
                final LocalDate fechaInicio;
                final int dias;
                final boolean isRealTime;
                final int saMinutes;
                final int planningHorizon;
                final String dataPath;
                final long targetEndEpoch;

                int day = 0;
                int currentSimMinuteOfDay = 0;

                final Map<Integer, SuperLot> planifiablePool = new ConcurrentHashMap<>();
                final Set<String> bagIdsComprometidos = new HashSet<>();
                final Set<String> bagIdsConLotArrivalEmitido = new HashSet<>();
                final Map<String, Long> bagDeadlines = new HashMap<>();
                final Set<String> bagIdsViolatedSla = new HashSet<>();
                final Set<String> bagIdsDelivered = new HashSet<>();
                final Set<Long> processedCancelledFlightIds = new HashSet<>();
                final PriorityQueue<Event> globalEventQueue = new PriorityQueue<>(Comparator.comparingLong(Event::getTime));

                List<Route> inTransitRoutes = new ArrayList<>();
                SimulationState logicalState;
                List<Vuelo> todosLosVuelos;
                Map<String, Aeropuerto> airportMap;

                int totalMaletasDia = 0;
                int malatetasAtendidasDia = 0;
                int maletasEntregadasAlEmpezarDia = 0;
                Set<String> countedArrivalLotKeysToday = new HashSet<>();
                Set<String> countedAssignedLotKeysToday = new HashSet<>();

                List<Route> lastMasterPlanRoutes = new ArrayList<>();
                Long lastTaMs = 0L;
                String lastPlanId;
                int lastCurrentSa = 1;

                SimContext(LocalDate fechaInicio, int dias, boolean isRealTime, int saMinutes, int planningHorizon,
                           String dataPath, SimulationState logicalState, List<Vuelo> todosLosVuelos,
                           Map<String, Aeropuerto> airportMap, long targetEndEpoch) {
                        this.fechaInicio = fechaInicio;
                        this.dias = dias;
                        this.isRealTime = isRealTime;
                        this.saMinutes = saMinutes;
                        this.planningHorizon = planningHorizon;
                        this.dataPath = dataPath;
                        this.logicalState = logicalState;
                        this.todosLosVuelos = todosLosVuelos;
                        this.airportMap = airportMap;
                        this.targetEndEpoch = targetEndEpoch;
                }

                long dayStartEpochMs() { return fechaInicio.plusDays(day).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli(); }
                long currentGlobalSimTime() { return dayStartEpochMs() + currentSimMinuteOfDay * 60_000L; }
                boolean isPastTarget() { return currentGlobalSimTime() >= targetEndEpoch; }
        }

        private record SimBlock(
                long startSimTime, long endSimTimeActual, List<Event> events, SimulationState visualStartSnapshot,
                boolean collapsed, String collapseReason, Long collapseTime, List<SimulationDayReport> closedDayReports,
                boolean isFullyDone, double slaPercentAtEnd, List<Route> lastMasterPlanRoutes, Long lastTaMs,
                String lastPlanId, int dayAtEnd, int lastCurrentSa, Set<Long> cancelledFlightIds) {}

        /**
         * @param isCatchUp true SOLO durante el arranque síncrono en frío (día 0 con
         *   startTime tardío). Cuando es true: (a) currentSa deja de limitarse a
         *   ctx.saMinutes — usa el máximo posible por ciclo (todo el resto del
         *   bloque o hasta medianoche), reduciendo drásticamente el número de
         *   ciclos ALNS necesarios; (b) el ALNS usa una ventana más corta
         *   (CATCHUP_ALNS_WINDOW_MS) porque este estado se descarta/mejora en el
         *   primer ciclo real de streaming que viene justo después.
         */
        private SimBlock computeBlock(SimContext ctx, SimulationProgressHolder.SimulationSessionState session,ShipmentTracker shipmentTracker,
                                      long blockStart, long blockSizeMinutes, boolean isCatchUp) {

                long blockEndTarget = blockStart + blockSizeMinutes * 60_000L;
                SimulationState visualStartSnapshot = ctx.logicalState.copy();
                List<Event> blockEvents = new ArrayList<>();
                List<SimulationDayReport> closedDayReports = new ArrayList<>();
                boolean collapsed = false;
                String collapseReason = null;
                Long collapseTime = null;
                long alnsWindowForThisBlock = isCatchUp ? CATCHUP_ALNS_WINDOW_MS : ALNS_WINDOW_MS;

                while (!ctx.isPastTarget() && ctx.currentGlobalSimTime() < blockEndTarget) {

                        if (ctx.currentSimMinuteOfDay == 0) {
                                if (ctx.day > 0) {
                                        restaurarVuelosEnBD();
                                        ctx.processedCancelledFlightIds.clear();
                                        if (!session.getPendingNextDayCancellations().isEmpty()) {
                                                List<Long> aAplicar = new ArrayList<>(session.getPendingNextDayCancellations());
                                                session.getPendingNextDayCancellations().clear();
                                                List<Vuelo> aCancelar = vueloRepo.findAllByIdWithAirports(aAplicar);
                                                aCancelar.forEach(v -> v.setCancelled(true));
                                                vueloRepo.saveAll(aCancelar);
                                                networkAdapter.invalidateGraph();
                                        }
                                }

                                if (!ctx.isRealTime) envioService.cargarPorDia(ctx.fechaInicio.plusDays(ctx.day), ctx.dataPath);

                                ctx.totalMaletasDia = ctx.planifiablePool.values().stream().mapToInt(SuperLot::getTotalMaletas).sum();
                                ctx.malatetasAtendidasDia = 0;
                                ctx.countedArrivalLotKeysToday = new HashSet<>();
                                ctx.countedAssignedLotKeysToday = new HashSet<>();
                                ctx.maletasEntregadasAlEmpezarDia = ctx.logicalState.getMaletasEntregadas();
                        }

                        // Integrar vuelos inyectados en vivo en el siguiente bloque ALNS
                        if (!session.getPendingLiveFlights().isEmpty()) {
                                List<Vuelo> vivos = new ArrayList<>(session.getPendingLiveFlights());
                                session.getPendingLiveFlights().clear();
                                for (Vuelo v : vivos) {
                                        ctx.todosLosVuelos.add(v);
                                        ctx.logicalState.getCapacidadVuelo().put(v.getId(), v.getCapacidadTotal());
                                        log.info("[VIVO] Vuelo {} incorporado al estado lógico de la simulación", v.getId());
                                }
                                networkAdapter.invalidateGraph();
                        }

                        long currentSimTime = ctx.currentGlobalSimTime();
                        long minutesLeftInBlock = Math.max(1, (blockEndTarget - currentSimTime) / 60_000L);

                        int currentSa;
                        if (isCatchUp) {
                                int maxCatchUpCycle = 120;
                                currentSa = (int) Math.min(maxCatchUpCycle, Math.min(1440 - ctx.currentSimMinuteOfDay, minutesLeftInBlock));
                        } else {
                                currentSa = Math.min(ctx.saMinutes, 1440 - ctx.currentSimMinuteOfDay);
                                currentSa = (int) Math.min(currentSa, minutesLeftInBlock);
                        }
                        // Precisión de fin: no dejar que un ciclo se pase de largo del final real elegido.
                        long minutesLeftUntilTarget = Math.max(1, (ctx.targetEndEpoch - currentSimTime) / 60_000L);
                        currentSa = (int) Math.min(currentSa, minutesLeftUntilTarget);
                        ctx.lastCurrentSa = currentSa;
                        long cycleEnd = currentSimTime + currentSa * 60_000L;

                        List<Vuelo> canceladosDb = vueloRepo.findByCancelledTrue();
                        for (Vuelo vf : canceladosDb) {
                                if (ctx.processedCancelledFlightIds.add(vf.getId())) {
                                        List<Route> afectadas = ctx.inTransitRoutes.stream()
                                                .filter(r -> r.getArrivalTime() > currentSimTime && !"cancelled".equals(r.getStatus()))
                                                .filter(r -> r.getFlights().stream().anyMatch(f -> f.getId().equals(vf.getId())))
                                                .toList();
                                        for (Route r : afectadas) {
                                                r.setStatus("cancelled");
                                                SuperLot replanLot = elevateToMaxPriority(r, currentSimTime);
                                                replanLot.setTotalMaletas(r.getCapacidadAsignada());
                                                Set<String> bagIdsAfectados = new HashSet<>(replanLot.getBagIds());
                                                bagIdsAfectados.forEach(ctx.bagIdsComprometidos::remove);
                                                ctx.globalEventQueue.removeIf(e -> e.getTime() > currentSimTime
                                                        && e.getBagIds() != null && e.getBagIds().stream().anyMatch(bagIdsAfectados::contains));
                                                r.setCapacidadAsignada(0);
                                                ctx.planifiablePool.put(replanLot.getId(), replanLot);
                                                log.info("[CANCELACION] vuelo={} rescatando {} maletas", vf.getId(), bagIdsAfectados.size());
                                        }
                                }
                        }

                        List<SuperLot> nuevosEnHorizonte = superLotService.agruparEnviosPorVentana(
                                currentSimTime, currentSimTime + ((long) ctx.planningHorizon * 60_000L));
                        Set<String> bagIdsYaEnPool = ctx.planifiablePool.values().stream()
                                .flatMap(l -> l.getBagIds().stream()).collect(Collectors.toSet());
                        log.info("[VENTANA] t={} lotesEnVentana={} poolTotal={}",
                                Instant.ofEpochMilli(currentSimTime), nuevosEnHorizonte.size(), ctx.planifiablePool.size());
                        for (SuperLot lot : nuevosEnHorizonte) {
                                List<String> nuevos = lot.getBagIds().stream()
                                        .filter(b -> !bagIdsYaEnPool.contains(b))
                                        .filter(b -> !ctx.bagIdsComprometidos.contains(b))
                                        .toList();
                                if (nuevos.isEmpty()) continue;

                                SuperLot lotFiltrado = (nuevos.size() == lot.getBagIds().size()) ? lot
                                        : new SuperLot(lot.getId(), lot.getOrigenIcao(), lot.getDestinoIcao(), nuevos.size(),
                                        lot.getReadyTime(), lot.getSla(), lot.isIntercontinental(), lot.getPriority(), nuevos,
                                        filterDeadlines(lot.getBagDeadlines(), nuevos));
                                if (lotFiltrado != lot) {
                                        lotFiltrado.setBagReadyTimes(filterDeadlines(lot.getBagReadyTimes(), nuevos));
                                }
                                ctx.planifiablePool.put(lotFiltrado.getId(), lotFiltrado);
                                for (String bagId : lotFiltrado.getBagIds()) {
                                        Long d = lotFiltrado.getBagDeadlines().get(bagId);
                                        if (d != null) ctx.bagDeadlines.putIfAbsent(bagId, d);
                                }
                                if (ctx.countedArrivalLotKeysToday.add(lot.getKey())) ctx.totalMaletasDia += lotFiltrado.getTotalMaletas();

                                // ← LOG DE DIAGNÓSTICO: útil para confirmar que un registro manual
                                // (día a día) fue detectado por la ventana de planificación.
                                // Bórralo o coméntalo cuando ya no lo necesites.
                                log.info("[NUEVO-ENVIO] origen={} destino={} bagsNuevos={} readyTime={} (currentSimTime={})",
                                        lot.getOrigenIcao(), lot.getDestinoIcao(), nuevos.size(),
                                        Instant.ofEpochMilli(lot.getReadyTime()), Instant.ofEpochMilli(currentSimTime));

                                List<String> bagsParaTracking = new ArrayList<>();
                                for (String bagId : lotFiltrado.getBagIds()) {
                                        if (ctx.bagIdsConLotArrivalEmitido.add(bagId)) bagsParaTracking.add(bagId);
                                }
                                if (!bagsParaTracking.isEmpty()) {
                                        ctx.globalEventQueue.addAll(eventEngine.buildLotArrivalEvents(lotFiltrado, bagsParaTracking));
                                }
                        }

                        long tPlanStart = System.currentTimeMillis();
                        Solution sol = alnsPlanner.plan(superLotService.mergeLots(new ArrayList<>(ctx.planifiablePool.values())),
                                alnsWindowForThisBlock, ctx.logicalState.getCapacidadVuelo(), ctx.logicalState.getCargaAeropuerto(), currentSimTime);
                        ctx.lastTaMs = System.currentTimeMillis() - tPlanStart;
                        ctx.lastPlanId = sol.getPlanId();
                        ctx.lastMasterPlanRoutes = sol.getRoutes();

                        for (Route r : sol.getRoutes()) {
                                if (r.isAtendido() && ctx.countedAssignedLotKeysToday.add(r.getLot().getKey())) {
                                        ctx.malatetasAtendidasDia += r.getCapacidadAsignada();
                                }
                        }

                        ctx.inTransitRoutes = Stream.concat(ctx.inTransitRoutes.stream(),
                                        sol.getRoutes().stream().filter(r -> r.getCapacidadAsignada() > 0))
                                .collect(Collectors.toMap(r -> r.getLot().getId(), r -> r, (a, b) -> b)).values().stream()
                                .filter(r -> r.getArrivalTime() > currentSimTime).collect(Collectors.toList());

                        for (Route r : sol.getRoutes()) {
                                if (!r.isAtendido() || r.getFlights() == null || r.getFlights().isEmpty()) continue;
                                if (r.getDepartureTime() < 0 || r.getDepartureTime() > cycleEnd) continue;

                                List<String> bagIds = r.getBagIds();
                                if (bagIds == null || bagIds.isEmpty()) continue;

                                List<String> nuevasComprometidas = new ArrayList<>();
                                for (String bagId : bagIds) {
                                        if (ctx.bagIdsComprometidos.add(bagId)) nuevasComprometidas.add(bagId);
                                }
                                if (!nuevasComprometidas.isEmpty()) {
                                        // ← RESTAURADO: se había perdido en la reescritura anterior.
                                        // Sin esto, las rutas nunca guardaban sus hops -> "no me sale la ruta".
                                        shipmentTracker.registerPlannedHops(nuevasComprometidas, r);
                                        ctx.globalEventQueue.addAll(eventEngine.buildEventsForRoute(r, nuevasComprometidas, ctx.dayStartEpochMs()));
                                }
                        }

                        List<Integer> keysSnapshot = new ArrayList<>(ctx.planifiablePool.keySet());
                        for (Integer key : keysSnapshot) {
                                SuperLot original = ctx.planifiablePool.get(key);
                                if (original == null) continue;
                                List<String> pendientes = original.getBagIds().stream()
                                        .filter(b -> !ctx.bagIdsComprometidos.contains(b)).toList();
                                if (pendientes.isEmpty()) {
                                        ctx.planifiablePool.remove(key);
                                } else if (pendientes.size() != original.getBagIds().size()) {
                                        SuperLot actualizado = new SuperLot(original.getId(), original.getOrigenIcao(),
                                                original.getDestinoIcao(), pendientes.size(), original.getReadyTime(), original.getSla(),
                                                original.isIntercontinental(), original.getPriority(), pendientes,
                                                filterDeadlines(original.getBagDeadlines(), pendientes));
                                        actualizado.setBagReadyTimes(filterDeadlines(original.getBagReadyTimes(), pendientes));
                                        ctx.planifiablePool.put(key, actualizado);
                                }
                        }

                        while (!ctx.globalEventQueue.isEmpty() && ctx.globalEventQueue.peek().getTime() <= cycleEnd) {
                                Event event = ctx.globalEventQueue.poll();
                                ctx.logicalState.apply(event, ctx.airportMap);
                                blockEvents.add(event);

                                if (event.getType() == EventType.BAGGAGE_PICKUP && event.getBagIds() != null) {
                                        for (String bagId : event.getBagIds()) {
                                                ctx.bagIdsDelivered.add(bagId);
                                                Long deadline = ctx.bagDeadlines.get(bagId);
                                                if (deadline != null && event.getTime() > deadline && ctx.bagIdsViolatedSla.add(bagId)) {
                                                        collapsed = true;
                                                        long retrasoMin = (event.getTime() - deadline) / 60_000L;
                                                        collapseReason = String.format(
                                                                "SLA_INCUMPLIDO: la maleta %s fue recogida tarde (retraso=%dmin).", bagId, retrasoMin);
                                                        collapseTime = event.getTime();
                                                        log.warn("[SLA-VIOLATION-PICKUP-TARDIO] bagId={} retrasoMin={}", bagId, retrasoMin);
                                                }
                                        }
                                }

                                if (!collapsed && ctx.logicalState.isColapsado()) {
                                        collapsed = true;
                                        collapseReason = ctx.logicalState.getCollapseReason();
                                        collapseTime = ctx.logicalState.getCollapseTime();
                                        log.warn("[COLAPSO-FISICO] {}", collapseReason);
                                }

                                if (collapsed) break;
                        }

                        if (!collapsed) {
                                List<String> nuevasViolaciones = new ArrayList<>();
                                for (Map.Entry<String, Long> e : ctx.bagDeadlines.entrySet()) {
                                        String bagId = e.getKey();
                                        if (ctx.bagIdsViolatedSla.contains(bagId)) continue;
                                        long deadline = e.getValue();
                                        if (deadline > cycleEnd) continue;
                                        if (ctx.bagIdsDelivered.contains(bagId)) continue;
                                        ctx.bagIdsViolatedSla.add(bagId);
                                        nuevasViolaciones.add(bagId);
                                }
                                if (!nuevasViolaciones.isEmpty()) {
                                        collapsed = true;
                                        collapseTime = cycleEnd;
                                        String ejemplo = nuevasViolaciones.get(0);
                                        boolean teniaRuta = ctx.bagIdsComprometidos.contains(ejemplo);
                                        collapseReason = String.format(
                                                "SLA_INCUMPLIDO: %d maleta(s) superaron su deadline sin ser recogidas. Ejemplo: %s (%s).",
                                                nuevasViolaciones.size(), ejemplo, teniaRuta ? "tenía ruta asignada" : "nunca tuvo ruta asignada");
                                        for (String bagId : nuevasViolaciones) {
                                                log.warn("[SLA-VIOLATION-NUNCA-RECOGIDA] bagId={} deadline={} cycleEnd={}",
                                                        bagId, Instant.ofEpochMilli(ctx.bagDeadlines.get(bagId)), Instant.ofEpochMilli(cycleEnd));
                                        }
                                }
                        }

                        if (collapsed) {
                                closedDayReports.add(buildDayReport(ctx));
                                break;
                        }

                        ctx.currentSimMinuteOfDay += currentSa;
                        if (ctx.currentSimMinuteOfDay >= 1440) {
                                closedDayReports.add(buildDayReport(ctx));
                                log.info("[DIA-CERRADO] día={} slaPercent={} totalMaletas={} atendidas={}",
                                        ctx.day + 1, computeRealSlaPercent(ctx.bagDeadlines, ctx.bagIdsViolatedSla),
                                        ctx.totalMaletasDia, ctx.malatetasAtendidasDia);
                                ctx.day++;
                                ctx.currentSimMinuteOfDay = 0;
                        }
                }

                long endSimTimeActual = collapsed ? collapseTime : ctx.currentGlobalSimTime();
                double slaPercentAtEnd = computeRealSlaPercent(ctx.bagDeadlines, ctx.bagIdsViolatedSla);

                return new SimBlock(blockStart, endSimTimeActual, blockEvents, visualStartSnapshot, collapsed,
                        collapseReason, collapseTime, closedDayReports, ctx.isPastTarget(), slaPercentAtEnd,
                        ctx.lastMasterPlanRoutes, ctx.lastTaMs, ctx.lastPlanId, ctx.day, ctx.lastCurrentSa,
                        new HashSet<>(ctx.processedCancelledFlightIds));
        }

        private SimulationDayReport buildDayReport(SimContext ctx) {
                SimulationDayReport r = new SimulationDayReport();
                r.setDayIndex(ctx.day);
                r.setSlaPercent(computeRealSlaPercent(ctx.bagDeadlines, ctx.bagIdsViolatedSla));
                r.setTotalMaletas(ctx.totalMaletasDia);
                r.setMalatetasAtendidas(ctx.malatetasAtendidasDia);
                r.setMaletasEntregadas(ctx.logicalState.getMaletasEntregadas() - ctx.maletasEntregadasAlEmpezarDia);
                return r;
        }

        private void replayBlock(SimBlock block, SimulationProgressHolder.SimulationSessionState session,
                                 ShipmentTracker tracker, Map<String, Aeropuerto> airportMap,
                                 List<Vuelo> todosLosVuelos, String algorithm, int dias, long paceRealMs,
                                 Map<String, ActiveFlight> activeOverlay) {

                session.setCurrentSaMinutes(block.lastCurrentSa());
                session.setLastTaMs(block.lastTaMs());
                session.setCurrentPlanId(block.lastPlanId());

                SimulationState replayState = block.visualStartSnapshot().copy();
                List<Event> events = block.events();

                Map<String, Long> arrivalByInstance = new HashMap<>();
                for (Event e : events) {
                        if (e.getType() == EventType.FLIGHT_ARRIVAL) arrivalByInstance.put(e.getFlightInstanceKey(), e.getTime());
                }

                long spanMs = Math.max(1, block.endSimTimeActual() - block.startSimTime());

                int ticks;
                if (paceRealMs <= 0) {
                        ticks = 1;
                } else {
                        long rawTicks = paceRealMs / TARGET_FRAME_INTERVAL_MS;
                        ticks = (int) Math.max(4L, Math.min(240L, rawTicks));
                }
                long sleepPerTick = ticks == 0 ? 0 : paceRealMs / ticks;

                int idx = 0;
                long startEpoch = session.getStartEpoch();

                for (int t = 1; t <= ticks; t++) {
                        long tickTarget = block.startSimTime() + (spanMs * t) / ticks;
                        long tickRealStart = System.currentTimeMillis();

                        idx = applyEventsUpTo(events, idx, tickTarget, replayState, tracker, airportMap, activeOverlay, arrivalByInstance);

                        publishTick(session, block, tickTarget, startEpoch, dias, replayState, airportMap, todosLosVuelos,
                                algorithm, activeOverlay.values(), block.cancelledFlightIds());

                        if (paceRealMs > 0) {
                                long worked = System.currentTimeMillis() - tickRealStart;
                                long remaining = sleepPerTick - worked;
                                if (remaining > 0) {
                                        try { Thread.sleep(remaining); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
                                }
                        }
                }
                idx = applyEventsUpTo(events, idx, block.endSimTimeActual(), replayState, tracker, airportMap, activeOverlay, arrivalByInstance);
                publishTick(session, block, block.endSimTimeActual(), startEpoch, dias, replayState, airportMap,
                        todosLosVuelos, algorithm, activeOverlay.values(), block.cancelledFlightIds());
        }

        private record ActiveFlight(Vuelo vuelo, long dep, long arr, int load, String status) {}

        private int applyEventsUpTo(List<Event> events, int fromIdx, long targetTime, SimulationState replayState,
                                    ShipmentTracker tracker, Map<String, Aeropuerto> airportMap,
                                    Map<String, ActiveFlight> activeOverlay, Map<String, Long> arrivalByInstance) {
                int idx = fromIdx;
                int n = events.size();
                while (idx < n && events.get(idx).getTime() <= targetTime) {
                        Event ev = events.get(idx++);
                        replayState.apply(ev, airportMap);
                        tracker.observe(ev);

                        if (ev.getType() == EventType.FLIGHT_DEPARTURE) {
                                String key = ev.getFlightInstanceKey();
                                Vuelo v = ev.getVuelo();
                                long arr = arrivalByInstance.getOrDefault(key, ev.getTime() + v.getDuracionMs());
                                activeOverlay.merge(key, new ActiveFlight(v, ev.getTime(), arr, ev.getLoad(), "normal"),
                                        (old, neu) -> new ActiveFlight(old.vuelo(), old.dep(), old.arr(), old.load() + neu.load(), old.status()));
                        } else if (ev.getType() == EventType.FLIGHT_ARRIVAL) {
                                activeOverlay.remove(ev.getFlightInstanceKey());
                        }
                }
                return idx;
        }

        private void publishTick(SimulationProgressHolder.SimulationSessionState session, SimBlock block,
                                 long tickTarget, long startEpoch, int dias, SimulationState replayState,
                                 Map<String, Aeropuerto> airportMap, List<Vuelo> todosLosVuelos, String algorithm,
                                 Collection<ActiveFlight> activeFlights, Set<Long> cancelledFlightIds) {

                long daysSinceStart = (tickTarget - startEpoch) / 86_400_000L;
                long minuteOfDay = ((tickTarget - startEpoch) % 86_400_000L) / 60_000L;
                int completedDaysDisplay = (int) daysSinceStart + 1;

                long actualStart = session.getActualStartEpoch() != null ? session.getActualStartEpoch() : startEpoch;
                long totalTargetMs = (long) dias * 1440L * 60_000L;
                int mPercent = (int) Math.max(0, Math.min(100, ((tickTarget - actualStart) * 100.0) / totalTargetMs));

                java.time.ZonedDateTime zdt = Instant.ofEpochMilli(tickTarget).atZone(ZoneOffset.UTC);
                String simulatedTimeStr = String.format("Día %d - %02d:%02d", completedDaysDisplay, zdt.getHour(), zdt.getMinute());

                updateProgress(session, completedDaysDisplay, dias, mPercent, simulatedTimeStr, block.slaPercentAtEnd(),
                        replayState, airportMap, activeFlights, tickTarget, startEpoch, algorithm, block.lastPlanId(),
                        todosLosVuelos, session.isCollapseMode(), session.getRescuedFlights(), session.getErrorMessage(),
                        block.lastTaMs(), block.lastCurrentSa(),cancelledFlightIds);
        }

        private void updateProgress(SimulationProgressHolder.SimulationSessionState session, int completedDays,
                                    int totalDays, int currentPercent, String simulatedTime, double slaPercent, SimulationState state,
                                    Map<String, Aeropuerto> airportMap, Collection<ActiveFlight> activeFlights, long currentSimTime,
                                    long startEpoch, String algorithm, String planId, List<Vuelo> todosLosVuelos, boolean isCollapseMode,
                                    int rescuedFlights, String errorMessage, Long lastTaMs, Integer currentSaMinutes,
                                    Set<Long> cancelledFlightIds) {

                session.setCurrentDay(completedDays);
                session.setPercent(currentPercent);
                session.setSimulatedTime(simulatedTime);
                session.setSlaPercent(slaPercent);
                session.setCurrentEpochTime(currentSimTime);

                Map<String, Map<String, Object>> loads = new HashMap<>();
                int totalWaitingBags = 0;
                for (String icao : airportMap.keySet()) {
                        Map<String, Object> data = new HashMap<>();
                        int bags = state.getLoadAt(icao);
                        totalWaitingBags += bags;
                        Aeropuerto ap = airportMap.get(icao);
                        double occ = ap.getStorageCapacity() > 0 ? (bags * 100.0) / ap.getStorageCapacity() : 0;
                        data.put("bags", bags);
                        data.put("occupancy", occ);
                        loads.put(icao, data);
                }
                session.setAirportLoads(loads);

                Map<String, Map<String, Object>> vuelosFisicos = new HashMap<>();
                long currentDayStartEpoch = startEpoch + ((long) (completedDays - 1) * 86400000L);

                for (Vuelo v : todosLosVuelos) {
                        if (cancelledFlightIds.contains(v.getId())) continue; //no se dibuja los cancelados hoy
                        long dep = v.getDepartureEpoch(currentDayStartEpoch);
                        long arr = v.getArrivalEpoch(currentDayStartEpoch);
                        if (currentSimTime >= dep && currentSimTime < arr) {
                                vuelosFisicos.put(v.getId() + "-" + dep, createAvionMap(v, dep, arr, currentSimTime, "normal"));
                        }
                        long prevDep = v.getDepartureEpoch(currentDayStartEpoch - 86400000L);
                        long prevArr = v.getArrivalEpoch(currentDayStartEpoch - 86400000L);
                        if (currentSimTime >= prevDep && currentSimTime < prevArr) {
                                vuelosFisicos.put(v.getId() + "-" + prevDep, createAvionMap(v, prevDep, prevArr, currentSimTime, "normal"));
                        }
                }

                for (ActiveFlight af : activeFlights) {
                        String key = af.vuelo().getId() + "-" + af.dep();
                        Map<String, Object> existing = vuelosFisicos.get(key);
                        if (existing == null) {
                                existing = createAvionMap(af.vuelo(), af.dep(), af.arr(), currentSimTime, af.status());
                                vuelosFisicos.put(key, existing);
                        }
                        existing.put("ocupacionReal", af.load());
                }

                long totalCap = 0, totalCarga = 0;
                for (Map<String, Object> a : vuelosFisicos.values()) {
                        int oc = (int) a.get("ocupacionReal"), mx = (int) a.get("capacidadMax");
                        totalCarga += oc; totalCap += mx;
                        a.put("capacityPercent", (oc * 100.0) / Math.max(1, mx));
                }

                List<Map<String, Object>> active = vuelosFisicos.values().stream()
                        .sorted((a, b) -> {
                                int ocA = (int) a.get("ocupacionReal");
                                int ocB = (int) b.get("ocupacionReal");
                                return Integer.compare(ocB, ocA);
                        }).collect(Collectors.toList());

                double fleetOcc = totalCap == 0 ? 0 : (totalCarga * 100.0) / totalCap;
                int criticalNodes = (int) loads.values().stream().filter(d -> (double) d.get("occupancy") >= 90).count();

                SimulationProgressHolder.WsFrame frame = new SimulationProgressHolder.WsFrame(
                        session.getSessionId(), "RUNNING", currentSimTime, simulatedTime, currentPercent, completedDays,
                        totalDays, slaPercent, criticalNodes, loads, totalWaitingBags, isCollapseMode, rescuedFlights,
                        errorMessage, startEpoch, active, algorithm, lastTaMs, currentSaMinutes, planId, new ArrayList<>(), fleetOcc);

                session.setAirportLoads(frame.airportLoads());
                session.setActiveRoutes(frame.activeRoutes());
                session.setWsFrame(frame);
                wsPublisher.pushImmediate(session.getSessionId(), session);
        }

        private static Map<String, Long> filterDeadlines(Map<String, Long> source, List<String> bagIds) {
                Map<String, Long> result = new HashMap<>();
                for (String id : bagIds) {
                        Long d = source.get(id);
                        if (d != null) result.put(id, d);
                }
                return result;
        }

        private SuperLot elevateToMaxPriority(Route r, long currentTime) {
                SuperLot lot = r.getLot();
                List<String> bagIds = r.getBagIds() != null ? r.getBagIds() : List.of();
                Map<String, Long> filteredDeadlines = filterDeadlines(lot.getBagDeadlines(), bagIds);
                SuperLot elevated = new SuperLot(lot.getId(), lot.getOrigenIcao(), lot.getDestinoIcao(), bagIds.size(),
                        currentTime + 86400000L, lot.getSla(), lot.isIntercontinental(), Integer.MAX_VALUE, bagIds, filteredDeadlines);
                elevated.setBagReadyTimes(filterDeadlines(lot.getBagReadyTimes(), bagIds));
                return elevated;
        }

        public void inyectarVueloEnVivo(Vuelo vuelo) {
                log.info("Vuelo inyectado en vivo (se incorporará en el próximo bloque ALNS): {}", vuelo.getId());
                for (String sid : progressHolder.getAllSessionIds()) {
                        SimulationProgressHolder.SimulationSessionState s = progressHolder.get(sid);
                        if (s != null && s.getStatus() == SimulationProgressHolder.Status.RUNNING) {
                                s.getPendingLiveFlights().add(vuelo);
                        }
                }
        }

        private Map<String, Object> createAvionMap(Vuelo v, long dep, long arr, long now, String status) {
                Map<String, Object> m = new HashMap<>();
                m.put("id", "vuelo-" + v.getId() + "-" + dep);
                m.put("from", v.getOrigen().getIcaoCode());
                m.put("to", v.getDestino().getIcaoCode());
                m.put("progress", computeFlightProgress(now, dep, arr));
                m.put("status", status);
                m.put("departureTime", dep);
                m.put("arrivalTime", arr);
                m.put("ocupacionReal", 0);
                m.put("capacidadMax", v.getCapacidadTotal());
                return m;
        }

        private double computeFlightProgress(long c, long d, long a) {
                return (d <= 0 || a <= 0 || a <= d) ? 0.0 : Math.max(0.0, Math.min(1.0, (c - d) / (double) (a - d)));
        }

        private double computeRealSlaPercent(Map<String, Long> bagDeadlines, Set<String> bagIdsViolatedSla) {
                if (bagDeadlines.isEmpty()) return 100.0;
                return (1.0 - (bagIdsViolatedSla.size() / (double) bagDeadlines.size())) * 100.0;
        }

        private void restaurarVuelosEnBD() {
                try {
                        List<Vuelo> c = vueloRepo.findByCancelledTrue();
                        if (!c.isEmpty()) { c.forEach(v -> v.setCancelled(false)); vueloRepo.saveAll(c); networkAdapter.invalidateGraph(); }
                } catch (Exception e) { log.warn("Error restaurando vuelos: {}", e.getMessage()); }
        }

        private List<Map<String, Object>> buildFinalPlanSnapshot(List<Route> plan, long fromEpoch) {
                if (plan == null) return List.of();
                Map<String, Map<String, Object>> byFlight = new LinkedHashMap<>();
                for (Route r : plan) {
                        if (r.getFlights() == null || r.getLegDepartures() == null || r.getLegDepartures().isEmpty()) continue;
                        boolean esRelevante = false;
                        for (int i = 0; i < r.getLegArrivals().size(); i++) {
                                if (r.getLegArrivals().get(i) > fromEpoch) { esRelevante = true; break; }
                        }
                        if (!esRelevante) continue;

                        List<String> bagIds = r.getBagIds() != null ? r.getBagIds() : List.of();
                        for (int i = 0; i < r.getFlights().size(); i++) {
                                Vuelo v = r.getFlights().get(i);
                                long dep = r.getLegDepartures().get(i);
                                long arr = r.getLegArrivals().get(i);
                                if (arr <= fromEpoch) continue;

                                String key = v.getId() + "-" + dep;
                                Map<String, Object> entry = byFlight.computeIfAbsent(key, k -> {
                                        Map<String, Object> m = new LinkedHashMap<>();
                                        m.put("vueloId", v.getId());
                                        m.put("from", v.getOrigen().getIcaoCode());
                                        m.put("to", v.getDestino().getIcaoCode());
                                        m.put("departureTime", dep);
                                        m.put("arrivalTime", arr);
                                        m.put("totalBags", 0);
                                        m.put("bagIds", new ArrayList<String>());
                                        return m;
                                });
                                entry.put("totalBags", (int) entry.get("totalBags") + r.getCapacidadAsignada());
                                @SuppressWarnings("unchecked")
                                List<String> bags = (List<String>) entry.get("bagIds");
                                bags.addAll(bagIds);
                        }
                }
                return new ArrayList<>(byFlight.values());
        }
}