package com.tasfb2b.planificador.service;
import com.tasfb2b.tracking.service.ShipmentTracker;
import com.tasfb2b.tracking.service.ShipmentTrackerRegistry;
/*
 * Sistema TASF.B2B — Motor de Optimización Logística
 * Grupo 4D — Curso de Proyecto de Diseño de Software
 * Autores: Jim Navarrete, Diego Silvestre, Jose Avalos, Mathias Medina
 * Fecha: Mayo 2026
 */
import com.tasfb2b.planificador.domain.Event;
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
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import com.tasfb2b.planificador.simulation.EventEngine;
import com.tasfb2b.planificador.domain.EventType;
import com.tasfb2b.tracking.domain.ShipmentStatus;

import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;
import java.time.Instant;
import java.time.LocalTime;
/**
 * Servicio de simulación multi-día con ejecución asíncrona y micro-batching.
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
        private final ShipmentTrackerRegistry trackerRegistry; //Trazabilidad

        @Value("${tasf.data.path}")
        private String dataPath;

        @Value("${tasf.sim.playback.targetMinutes:60}")
        private int playbackTargetMinutes;

        private static final LocalDate DEFAULT_START_DATE = LocalDate.of(2026, 1, 2);

        @Async("simulationExecutor")
        public void runAsync(String sessionId, int dias, String algorithm, LocalDate startDate, int playbackMinutes, String preCancelledFlightIds, String startTime, int saMinutes, int planningHorizon, boolean isRealTime) {
                SimulationProgressHolder.SimulationSessionState session = progressHolder.get(sessionId);
                if (session == null) return;
                
                LocalDate fechaInicio = (startDate != null) ? startDate : DEFAULT_START_DATE;

                try {
                        long startEpochMs = fechaInicio.atStartOfDay()
                                .toInstant(ZoneOffset.UTC).toEpochMilli();
                        session.setStartEpoch(startEpochMs);

                        List<SimulationDayReport> reports = runFullSimulation(
                                dias, session, algorithm, fechaInicio, playbackMinutes, preCancelledFlightIds, startTime, saMinutes, planningHorizon, isRealTime);
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

                        // El productor terminó de generar días, pero el consumidor puede seguir
                        // mostrando frames acolados. markDone() lo dispara el consumidor cuando
                        // la cola quede vacía — así "DONE" coincide con lo que el usuario VE, no con
                        // lo que el backend ya terminó de calcular.
                        if (session.getFrameQueue() != null) {
                                session.setProducerFinished(true);
                        } else {
                                // isRealTime: sin cola, comportamiento original
                                progressHolder.markDone(sessionId);
                                wsPublisher.pushImmediate(sessionId, session);
                        }

                } catch (Exception ex) {
                        log.error("Simulation failed", ex);
                        progressHolder.markFailed(sessionId, ex.getMessage());
                        wsPublisher.pushImmediate(sessionId, session);
                }
        }

        public record PreCancellation(Long flightId, Integer day) {}

        private List<SimulationDayReport> runFullSimulation(
                        int dias,
                        SimulationProgressHolder.SimulationSessionState session,
                        String algorithm,
                        LocalDate fechaInicio,
                        int playbackMinutes,
                        String preCancelledFlightIds,
                        String startTimeStr,
                        int saMinutes,
                        int planningHorizon,
                        boolean isRealTime) {
                ShipmentTracker shipmentTracker = trackerRegistry.getOrCreate(session.getSessionId());
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

                restaurarVuelosEnBD();

                Map<String, Aeropuerto> airportMap = airportRepo.findAll().stream()
                                .collect(Collectors.toMap(Aeropuerto::getIcaoCode, a -> a));

                int initHour = 0;
                int initMin = 0;
                if (startTimeStr != null && startTimeStr.contains(":")) {
                    try {
                        String[] parts = startTimeStr.split(":");
                        initHour = Integer.parseInt(parts[0].trim());
                        initMin = Integer.parseInt(parts[1].trim());
                    } catch (Exception ignored) {}
                }
                long startTime = fechaInicio.atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli();
                long initialDisplayTime = startTime + (initHour * 3600_000L) + (initMin * 60_000L);

                // ── Productor-Consumidor: cola acotada, solo para modo no-realtime ──────
                if (!isRealTime) {
                        long msPerFrameCalc = computeSleepPerCycleMs(dias, playbackMinutes, 1440 / saMinutes, false, saMinutes) / saMinutes;
                        msPerFrameCalc = Math.max(1L, msPerFrameCalc);

                        // Capacidad = 22.5s de colchón / ms por frame. Para 5d (500ms/frame) da exactamente 45.
                        long capacidadCalc = Math.round(22_500.0 / msPerFrameCalc);
                        int capacidad = (int) Math.max(10, Math.min(capacidadCalc, 600)); // clamp de seguridad

                        session.initFrameQueue(capacidad, msPerFrameCalc);
                        log.info("[PRODUCTOR-CONSUMIDOR] msPerFrame={} capacidadCola={} (buffer≈{}s)",
                                msPerFrameCalc, capacidad, (capacidad * msPerFrameCalc) / 1000.0);
                }

                if (startTimeStr != null && !startTimeStr.isBlank()) {
                        session.setStatus(SimulationProgressHolder.Status.RECONSTRUCTING);
                }

                List<Vuelo> todosLosVuelos = vueloRepo.findAllWithAirports();
                updateProgress(session, 1, dias, 0, "Inicializando...", 100.0,
                        new SimulationState(new ArrayList<>(airportMap.values()), new ArrayList<>(), initialDisplayTime, bloqueoService),
                        airportMap, new ArrayList<>(), initialDisplayTime, startTime, algorithm, null, new ArrayList<>(), todosLosVuelos, null, false);

                wsPublisher.pushImmediate(session.getSessionId(), session);

                List<SimulationDayReport> history = new ArrayList<>();
                List<Route> inTransitRoutes = new ArrayList<>();
                Map<Integer, SuperLot> planifiablePool = new ConcurrentHashMap<>();

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
                Set<Long> processedCancelledFlightIds = new HashSet<>();
                // Maletas cuyo vuelo asignado YA despegó (currentSimTime cruzó su departureTime).
//              A partir de ahí son físicamente irreversibles. Antes de despegar, su asignación
//              es provisional y ALNS puede reasignarlas libremente cada ciclo.
                Set<String> bagIdsComprometidos = new HashSet<>();
                Set<String> bagIdsConLotArrivalEmitido = new HashSet<>();
                Map<String, Long> bagDeadlines = new HashMap<>();
                Set<String> bagIdsViolatedSla = new HashSet<>();

                int day = 0;
                while (day < dias) {
                        LocalDate fechaDia = fechaInicio.plusDays(day);
                        long dayStartEpochMs = fechaDia.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli();

                        if (day > 0) {
                                restaurarVuelosEnBD();
                                processedCancelledFlightIds.clear();
                                // aplicar cancelaciones diferidas por la regla de 1h
                                if (!session.getPendingNextDayCancellations().isEmpty()) {
                                        List<Long> aAplicar = new ArrayList<>(session.getPendingNextDayCancellations());
                                        session.getPendingNextDayCancellations().clear();
                                        List<Vuelo> aCancelar = vueloRepo.findAllByIdWithAirports(aAplicar);
                                        aCancelar.forEach(v -> v.setCancelled(true));
                                        vueloRepo.saveAll(aCancelar);
                                        networkAdapter.invalidateGraph();
                                }
                        }

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
                        }

                        if(!isRealTime) {
                                envioService.cargarPorDia(fechaDia, dataPath);
                        }

                        int malatetasAtendidasDia = 0;
                        int totalMaletasDia = planifiablePool.values().stream().mapToInt(SuperLot::getTotalMaletas).sum();
                        Set<String> countedArrivalLotKeysToday = new HashSet<>();
                        Set<String> countedAssignedLotKeysToday = new HashSet<>();
                        int maletasEntregadasAlEmpezarDia = globalState.getMaletasEntregadas();
                        
                        long targetEpoch = dayStartEpochMs;
                        if (day == 0 && startTimeStr != null && startTimeStr.contains(":")) {
                                try {
                                        String[] parts = startTimeStr.split(":");
                                        int h = Integer.parseInt(parts[0].trim());
                                        int m = Integer.parseInt(parts[1].trim());
                                        targetEpoch = dayStartEpochMs + (h * 3600_000L) + (m * 60_000L);
                                } catch (Exception ignored) {}
                        }
                        log.info("Hora JVM local={}", LocalTime.now());
                        log.info("Hora UTC={}", LocalTime.now(ZoneOffset.UTC));
                        log.info("startTimeStr={}", startTimeStr);
                        log.info("targetInstantUTC={}", Instant.ofEpochMilli(targetEpoch));
                        int currentSimMinuteOfDay = 0;
                        List<Route> masterPlan = new ArrayList<>();

                        while (currentSimMinuteOfDay < 1440) {
                                while (!vuelosInyectadosEnVivo.isEmpty()) {
                                        Vuelo nuevo = vuelosInyectadosEnVivo.poll();
                                        todosLosVuelos.add(nuevo);
                                        globalState.registerFlights(List.of(nuevo));
                                        networkAdapter.invalidateGraph();
                                }
                                long currentSimTime = dayStartEpochMs + ((long) currentSimMinuteOfDay * 60_000L);
                                boolean isCatchingUp = isRealTime && currentSimTime < targetEpoch;
                                
                                int currentSa = isRealTime ? (isCatchingUp ? Math.min(30, planningHorizon) : 1) : saMinutes;
                                if (currentSimMinuteOfDay + currentSa > 1440) currentSa = 1440 - currentSimMinuteOfDay;
                                session.setCurrentSaMinutes(currentSa);

                                java.time.ZonedDateTime zdt = java.time.Instant.ofEpochMilli(currentSimTime).atZone(ZoneOffset.UTC);
                                String simulatedTimeStr = String.format("Día %d - %02d:%02d", day + 1, zdt.getHour(), zdt.getMinute());

                                // Cancelaciones manuales
                                List<Vuelo> canceladosDb = vueloRepo.findByCancelledTrue();
                                for (Vuelo vf : canceladosDb) {
                                        if (processedCancelledFlightIds.add(vf.getId())) {
                                                List<Route> afectadas = inTransitRoutes.stream()
                                                        .filter(r -> r.getArrivalTime() > currentSimTime && !"cancelled".equals(r.getStatus()))
                                                        .filter(r -> r.getFlights().stream().anyMatch(f -> f.getId().equals(vf.getId())))
                                                        .toList();
                                                for (Route r : afectadas) {
                                                        r.setStatus("cancelled");
                                                        SuperLot replanLot = elevateToMaxPriority(r, currentSimTime);
                                                        replanLot.setTotalMaletas(r.getCapacidadAsignada());

                                                        Set<String> bagIdsAfectados = new HashSet<>(replanLot.getBagIds());
                                                        bagIdsAfectados.forEach(bagIdsComprometidos::remove); // se liberan para replanificar

                                                        globalEventQueue.removeIf(e ->
                                                                e.getTime() > currentSimTime
                                                                        && e.getBagIds() != null
                                                                        && e.getBagIds().stream().anyMatch(bagIdsAfectados::contains)
                                                        );
                                                        r.setCapacidadAsignada(0);
                                                        planifiablePool.put(replanLot.getId(), replanLot);
                                                }
                                        }
                                }

                                List<SuperLot> nuevosEnHorizonte = superLotService.agruparEnviosPorVentana(currentSimTime, currentSimTime + ((long)planningHorizon * 60_000L));

                                // Snapshot de TODOS los bagIds que el pool ya conoce, para no reinsertar duplicados
                                // que la ventana deslizante de agruparEnviosPorVentana vuelve a traer cada ciclo.
                                Set<String> bagIdsYaEnPool = planifiablePool.values().stream()
                                        .flatMap(l -> l.getBagIds().stream())
                                        .collect(Collectors.toSet());

                                for (SuperLot lot : nuevosEnHorizonte) {
                                    // se filtra SOLO nuevos se descartan los que ya están y comprometidos
                                    // ÚNICAMNETE PARA DEBUGGEAR EN SPIM
                                    boolean esSpim = "SPIM".equalsIgnoreCase(lot.getOrigenIcao());

                                    if (esSpim) {
                                      log.info("[DEBUG SPIM] ── Ventana detecta lote ID: {} hacia {} con {} maletas originales.",
                                                        lot.getId(), lot.getDestinoIcao(), lot.getBagIds().size());
                                      log.info("[DEBUG SPIM] Muestra de IDs originales en este lote: {}",
                                                        lot.getBagIds().stream().limit(3).toList());
                                    }
                                    //
                                    List<String> bagIdsRealmenteNuevos = lot.getBagIds().stream()
                                                .filter(b -> !bagIdsYaEnPool.contains(b))
                                                .filter(b -> !bagIdsComprometidos.contains(b))
                                                .toList();
                                    if (esSpim) {
                                        int descartadasPool = (int) lot.getBagIds().stream().filter(bagIdsYaEnPool::contains).count();
                                        int descartadasComprometidas = (int) lot.getBagIds().stream().filter(bagIdsComprometidos::contains).count();

                                        log.warn("[DEBUG SPIM] Resultado del filtro -> Conservadas: {} | Descartadas por Pool: {} | Descartadas por Comprometidas: {}",
                                                bagIdsRealmenteNuevos.size(), descartadasPool, descartadasComprometidas);
                                    }
                                    if (bagIdsRealmenteNuevos.isEmpty()) {
                                            if (esSpim) {
                                                    log.error("[DEBUG SPIM] ❌ Lote de SPIM COMPLETAMENTE DESCARTADO (SKIP). No pasa al planificador.");
                                            }
                                            continue; //NO hay nuevos SKIP
                                    }

                                    SuperLot lotFiltrado = (bagIdsRealmenteNuevos.size() == lot.getBagIds().size())
                                                ? lot
                                                : new SuperLot(lot.getId(), lot.getOrigenIcao(), lot.getDestinoIcao(),
                                                bagIdsRealmenteNuevos.size(), lot.getReadyTime(), lot.getSla(),
                                                lot.isIntercontinental(), lot.getPriority(), bagIdsRealmenteNuevos);

                                    planifiablePool.put(lotFiltrado.getId(), lotFiltrado);
                                        // Deadline REAL de cada maleta nueva (readyTime+sla del envío original).
                                        // El merge de ALNS puede acortar deadlines para fines de ruteo, pero el
                                        // compromiso de negocio es el del envío original, no el del lote fusionado.
                                    for (String bagId : lotFiltrado.getBagIds()) {
                                         bagDeadlines.putIfAbsent(bagId, lotFiltrado.getDeadline());
                                    }
                                    if (countedArrivalLotKeysToday.add(lot.getKey())) totalMaletasDia += lotFiltrado.getTotalMaletas();

                                    //Tracking la maleta ya esperá en almacén de origen, independiente de si ALNS asignó ruta
                                    List<String> bagsNuevosParaTracking = new ArrayList<>();
                                    for (String bagId : lotFiltrado.getBagIds()) {
                                         if (bagIdsConLotArrivalEmitido.add(bagId)) bagsNuevosParaTracking.add(bagId);
                                    }
                                    if (!bagsNuevosParaTracking.isEmpty()) {
                                        globalEventQueue.addAll(eventEngine.buildLotArrivalEvents(lotFiltrado, bagsNuevosParaTracking));
                                    }
                                }

                                long tPlanStart = System.currentTimeMillis();
                                Solution sol = alnsPlanner.plan(superLotService.mergeLots(new ArrayList<>(planifiablePool.values())), 5000L,
                                                globalState.getCapacidadVuelo(), globalState.getCargaAeropuerto(), currentSimTime);
                                session.setLastTaMs(System.currentTimeMillis() - tPlanStart);
                                masterPlan = sol.getRoutes();
                                session.setCurrentPlanId(sol.getPlanId());

                                // solo se comprometen maletas cuyo vuelo YA despegó en este instante simulado
                                for (Route r : sol.getRoutes()) {
                                        if (r.isAtendido() && countedAssignedLotKeysToday.add(r.getLot().getKey())) {
                                                malatetasAtendidasDia += r.getCapacidadAsignada();
                                        }
                                }


                                inTransitRoutes.addAll(sol.getRoutes().stream().filter(r -> r.getCapacidadAsignada() > 0).collect(Collectors.toList()));
                                inTransitRoutes = inTransitRoutes.stream().collect(Collectors.toMap(r -> r.getLot().getId(), r -> r, (a, b) -> b)).values()
                                                .stream().filter(r -> r.getArrivalTime() > currentSimTime).collect(Collectors.toList());

                                double slaPercent = totalMaletasDia == 0 ? 0 : (malatetasAtendidasDia * 100.0) / totalMaletasDia;

                                int microSteps = isRealTime ? currentSa * 60 : currentSa; 
                                long stepDurationMs = isRealTime ? 1000L : 60_000L;
                                long sleepPerCycleMsDynamic = computeSleepPerCycleMs(dias, playbackMinutes, 1440 / currentSa, isRealTime, currentSa);
                                long sleepPerMicroStep = (sleepPerCycleMsDynamic / microSteps) ;

                                for (int step = 0; step < microSteps; step++) {
                                        long tMicroStart = System.nanoTime();
                                        long microEnd = currentSimTime + ((step + 1) * stepDurationMs);

                                        for (Route r : sol.getRoutes()) {

                                                if (!r.isAtendido() || r.getFlights() == null || r.getFlights().isEmpty()) continue;
                                                if (r.getDepartureTime() < 0 || r.getDepartureTime() > microEnd) continue; // todavía no despega

                                                List<String> bagIds = r.getBagIds();
                                                if (bagIds == null || bagIds.isEmpty()) continue;

                                                List<String> nuevasComprometidas = new ArrayList<>();
                                                for (String bagId : bagIds) {
                                                        if (bagIdsComprometidos.add(bagId)) nuevasComprometidas.add(bagId);
                                                }
                                                if (!nuevasComprometidas.isEmpty()) {
                                                        if (r.getFlights().stream().anyMatch(v -> v.getId() == EventEngine.DEBUG_VUELO_ID)) {
                                                                System.out.println(String.format(
                                                                        "[COMMIT] microEnd=%d lotId=%d depTime=%d nuevasComprometidas=%d totalBagsRuta=%d",
                                                                        microEnd, r.getLot().getId(), r.getDepartureTime(),
                                                                        nuevasComprometidas.size(), bagIds.size()
                                                                ));
                                                        }
                                                        shipmentTracker.registerPlannedHops(nuevasComprometidas, r); //registramos los hops
                                                        globalEventQueue.addAll(eventEngine.buildEventsForRoute(r, nuevasComprometidas, dayStartEpochMs));
                                                }
                                        }

                                        //Gestión de pool: Ahora vamos a iterar sobre las keys del pool
                                        List<Integer> keysSnapshot = new ArrayList<>(planifiablePool.keySet());
                                        for (Integer key : keysSnapshot){
                                                SuperLot original = planifiablePool.get(key);
                                                if (original == null) continue; //en caso de ser removida por otro hilo

                                                List<String> pendientes = original.getBagIds().stream()
                                                        .filter(b -> !bagIdsComprometidos.contains(b))
                                                        .toList();
                                                if (pendientes.isEmpty()) {
                                                        planifiablePool.remove(key);
                                                }else if (pendientes.size() != original.getBagIds().size()){
                                                        SuperLot actualizado = new SuperLot(
                                                                original.getId(), original.getOrigenIcao(), original.getDestinoIcao(),
                                                                pendientes.size(), original.getReadyTime(), original.getSla(),
                                                                original.isIntercontinental(), original.getPriority(), pendientes
                                                        );
                                                        planifiablePool.put(key, actualizado);
                                                }
                                        }

                                        while (!globalEventQueue.isEmpty() && globalEventQueue.peek().getTime() <= microEnd) {
                                                Event event = globalEventQueue.poll();
                                                globalState.apply(event, airportMap);
                                                shipmentTracker.observe(event);

                                                // violación real solo si la recogida ocurrió DESPUÉS del deadline
                                                if (event.getType() == EventType.BAGGAGE_PICKUP && event.getBagIds() != null) {
                                                        for (String bagId : event.getBagIds()) {
                                                                Long deadline = bagDeadlines.get(bagId);
                                                                if (deadline != null && event.getTime() > deadline) {
                                                                        bagIdsViolatedSla.add(bagId);
                                                                }
                                                        }
                                                }
                                        }

                                        if (globalState.isColapsado()) {
                                                log.warn("[COLAPSO INMEDIATO] Almacén excedido en microEnd={}", microEnd);
                                                break; // salir del loop de microsteps para ir directo al check de día
                                        }

                                        int mPercent = (int) ((((day * 1440.0) + currentSimMinuteOfDay + step) / (dias * 1440.0)) * 100);

                                        if (isRealTime) {
                                                //  Modo día a día: SIN CAMBIOS, comportamiento original
                                                if (microEnd >= targetEpoch || (isCatchingUp && step == microSteps - 1)) {
                                                        updateProgress(session, day + 1, dias, mPercent, simulatedTimeStr, slaPercent, globalState, airportMap, inTransitRoutes, microEnd, startTime, algorithm, session.getCurrentPlanId(), masterPlan, todosLosVuelos, planifiablePool, isRealTime);
                                                }
                                                long workTimeMs = (System.nanoTime() - tMicroStart) / 1_000_000;
                                                long adjustedSleep = Math.max(0, sleepPerMicroStep - workTimeMs);
                                                if (microEnd >= targetEpoch && adjustedSleep > 0) try { Thread.sleep(adjustedSleep); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
                                        } else {
                                                // ── Productor: construye el frame y lo ENCOLA (bloqueante).
                                                // Sin Thread.sleep aquí — el backpressure de la cola es el único ritmo.
                                                // Cuando la cola esté llena (45 frames en 5d), put() bloquea hasta que
                                                // el consumidor libere espacio, garantizando que el backend nunca se
                                                // adelante más de "capacidad" minutos simulados al frontend.
                                                SimulationProgressHolder.WsFrame frame = buildFrame(session.getSessionId(), day + 1, dias,
                                                        mPercent, simulatedTimeStr, slaPercent, globalState, airportMap, inTransitRoutes,
                                                        microEnd, startTime, algorithm, session.getCurrentPlanId(), todosLosVuelos,
                                                        session.isCollapseMode(), session.getRescuedFlights(), session.getErrorMessage(),
                                                        session.getLastTaMs(), session.getCurrentSaMinutes());
                                                try {
                                                        session.getFrameQueue().put(frame);
                                                } catch (InterruptedException e) {
                                                        Thread.currentThread().interrupt();
                                                }
                                        }
                                }
                                currentSimMinuteOfDay += currentSa;
                        }
                        long finDeDia = dayStartEpochMs + 1440L * 60_000L;
                        for (Map.Entry<String, Long> e : bagDeadlines.entrySet()) {
                                String bagId = e.getKey();
                                long deadline = e.getValue();
                                if (deadline > finDeDia) continue;                    // aún no vence
                                if (bagIdsViolatedSla.contains(bagId)) continue;       // ya contada (recogida tarde)

                                var estado = shipmentTracker.getBag(bagId);
                                if (estado == null || estado.getEstado() != ShipmentStatus.ENTREGADO) {
                                        bagIdsViolatedSla.add(bagId);
                                }
                        }

                        //Chequea si llegó al colaspo
                        SimulationDayReport reportProvisional = new SimulationDayReport();
                        reportProvisional.setDayIndex(day);
                        reportProvisional.setSlaPercent(totalMaletasDia == 0 ? 100.0
                                : (malatetasAtendidasDia * 100.0) / totalMaletasDia);
                        reportProvisional.setTotalMaletas(totalMaletasDia);
                        reportProvisional.setMalatetasAtendidas(malatetasAtendidasDia);

                        CollapseHelper.CollapseCheckResult collapseCheck = collapseHelper.checkEndCondition(
                                session, reportProvisional, globalState, airportMap,bagIdsViolatedSla.size());

                        if (collapseCheck.terminated()) {
                                log.warn("[COLAPSO] Día {} — {}", day + 1, collapseCheck.reason());
                                session.setCollapseReason(collapseCheck.reason());
                                session.setCollapseDayIndex(day + 1);
                                if (masterPlan != null && !masterPlan.isEmpty()) {
                                        session.setFinalMasterPlan(buildFinalPlanSnapshot(masterPlan, dayStartEpochMs));
                                }
                                // Guardar el reporte del día del colapso y salir
                                SimulationDayReport collapseReport = new SimulationDayReport();
                                collapseReport.setDayIndex(day);
                                collapseReport.setSlaPercent(reportProvisional.getSlaPercent());
                                collapseReport.setTotalMaletas(totalMaletasDia);
                                collapseReport.setMalatetasAtendidas(malatetasAtendidasDia);
                                history.add(collapseReport);
                                break; //  Detiene el loop de días en AMBOS modos
                        }
                        //
                        if (masterPlan != null && !masterPlan.isEmpty()) {
                                session.setFinalMasterPlan(buildFinalPlanSnapshot(masterPlan, dayStartEpochMs));
                        }

                        SimulationDayReport report = new SimulationDayReport();
                        report.setDayIndex(day);
                        report.setSlaPercent(totalMaletasDia == 0 ? 0 : (malatetasAtendidasDia * 100.0) / totalMaletasDia);
                        report.setTotalMaletas(totalMaletasDia);
                        report.setMalatetasAtendidas(malatetasAtendidasDia);
                        report.setMaletasEntregadas(globalState.getMaletasEntregadas() - maletasEntregadasAlEmpezarDia);
                        history.add(report);
                        day++;
                }
                return history;
        }

        private SuperLot elevateToMaxPriority(Route r, long currentTime) {
                SuperLot lot = r.getLot();
                List<String> bagIds = r.getBagIds() != null ? r.getBagIds() : List.of();
                return new SuperLot(lot.getId(), lot.getOrigenIcao(), lot.getDestinoIcao(),
                        bagIds.size(), currentTime + 86400000L, lot.getSla(),
                        lot.isIntercontinental(), Integer.MAX_VALUE, bagIds);
        }

        private final java.util.Queue<Vuelo> vuelosInyectadosEnVivo = new java.util.concurrent.ConcurrentLinkedQueue<>();

        public void inyectarVueloEnVivo(Vuelo vuelo) {
                vuelosInyectadosEnVivo.offer(vuelo);
        }

        private void updateProgress(SimulationProgressHolder.SimulationSessionState session, int completedDays, int totalDays, int currentPercent, String simulatedTime, double slaPercent, SimulationState state, Map<String, Aeropuerto> airportMap, List<Route> activeRoutesList, long currentSimTime, long baseTime, String algorithm, String planId, List<Route> masterPlan, List<Vuelo> todosLosVuelos, Map<Integer, SuperLot> planifiablePool, boolean isRealTime) {
                session.setCurrentDay(completedDays);
                session.setPercent(currentPercent);
                session.setSimulatedTime(simulatedTime);
                session.setSlaPercent(slaPercent);
                session.setCurrentEpochTime(currentSimTime);

                SimulationProgressHolder.WsFrame frame = buildFrame(session.getSessionId(), completedDays, totalDays,
                        currentPercent, simulatedTime, slaPercent, state, airportMap, activeRoutesList, currentSimTime,
                        session.getStartEpoch(), algorithm, planId, todosLosVuelos, session.isCollapseMode(),
                        session.getRescuedFlights(), session.getErrorMessage(), session.getLastTaMs(), session.getCurrentSaMinutes());

                session.setAirportLoads(frame.airportLoads());
                session.setActiveRoutes(frame.activeRoutes());
                session.setWsFrame(frame);
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

        private boolean isHigherPriority(String n, String c) {
                Map<String, Integer> p = Map.of("critical", 3, "rescued", 2, "cancelled", 1, "normal", 0);
                return p.getOrDefault(n, 0) > p.getOrDefault(c, 0);
        }

        private long computeSleepPerCycleMs(int d, int p, int c, boolean r, int s) {
                return r ? s * 60000L : Math.max(100L, (long) p * 60000L / ((long) d * c));
        }

        private double computeFlightProgress(long c, long d, long a) {
                return (d <= 0 || a <= 0 || a <= d) ? 0.0 : Math.max(0.0, Math.min(1.0, (c - d) / (double) (a - d)));
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

                        // Solo rutas donde algún tramo LLEGA después del inicio del último día
                        // Esto incluye: vuelos del día 5 que aterrizan el 5 o el 6 (cross-day)
                        // Excluye: vuelos que completaron antes del día 5
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

                                // También filtrar tramos individuales: solo mostrar hops del último día en adelante
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

        /**
         * Construye un WsFrame inmutable con el estado del instante dado, SIN mutar session.
         * Usado por el productor en modo no-realtime para encolar frames de forma desacoplada.
         */
        private SimulationProgressHolder.WsFrame buildFrame(
                String sessionId, int completedDays, int totalDays, int currentPercent,
                String simulatedTime, double slaPercent, SimulationState state,
                Map<String, Aeropuerto> airportMap, List<Route> activeRoutesList,
                long currentSimTime, long startEpoch, String algorithm, String planId,
                List<Vuelo> todosLosVuelos, boolean isCollapseMode, int rescuedFlights, String errorMessage,
                Long lastTaMs, Integer currentSaMinutes) {

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

                Map<String, Map<String, Object>> vuelosFisicos = new HashMap<>();
                long currentDayStartEpoch = startEpoch + ((long) (completedDays - 1) * 86400000L);

                for (Vuelo v : todosLosVuelos) {
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

                for (Route r : activeRoutesList) {
                        if (r.getFlights() == null) continue;
                        List<Long> legDeps = r.getLegDepartures();
                        List<Long> legArrs = r.getLegArrivals();
                        if (legDeps == null || legArrs == null || legDeps.size() != r.getFlights().size()) continue;

                        for (int i = 0; i < r.getFlights().size(); i++) {
                                Vuelo v = r.getFlights().get(i);
                                long d = legDeps.get(i);
                                long a = legArrs.get(i);
                                if (currentSimTime < d || currentSimTime >= a) continue;

                                String key = v.getId() + "-" + d;
                                Map<String, Object> existing = vuelosFisicos.get(key);
                                if (existing == null) {
                                        existing = createAvionMap(v, d, a, currentSimTime, r.getStatus());
                                        vuelosFisicos.put(key, existing);
                                }
                                existing.put("ocupacionReal", (int) existing.get("ocupacionReal") + r.getCapacidadAsignada());
                                if (isHigherPriority(r.getStatus(), (String) existing.get("status"))) {
                                        existing.put("status", r.getStatus());
                                }
                        }
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
                                if (ocA != ocB) return Integer.compare(ocB, ocA);
                                return ((String) a.get("status")).compareTo((String) b.get("status"));
                        })
                        .collect(Collectors.toList());

                double fleetOcc = totalCap == 0 ? 0 : (totalCarga * 100.0) / totalCap;
                int criticalNodes = (int) loads.values().stream().filter(d -> (double) d.get("occupancy") >= 90).count();

                return new SimulationProgressHolder.WsFrame(sessionId, "RUNNING", currentSimTime, simulatedTime,
                        currentPercent, completedDays, totalDays, slaPercent, criticalNodes, loads, totalWaitingBags,
                        isCollapseMode, rescuedFlights, errorMessage, startEpoch, active, algorithm, lastTaMs,
                        currentSaMinutes, planId, new ArrayList<>(), fleetOcc);
        }

}
