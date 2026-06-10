package com.tasfb2b.planificador.service;

import com.tasfb2b.planificador.service.SimulationProgressHolder.SimulationSessionState;
import com.tasfb2b.planificador.web.SimulationKpiSnapshotDTO;
import com.tasfb2b.planificador.web.SimulationMapRouteDTO;
import com.tasfb2b.planificador.web.SimulationMapSnapshotDTO;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * Publica periódicamente el estado de cada sesión via WebSocket (STOMP).
 *
 * <p>Desacopla la emisión WebSocket del ciclo de simulación para evitar
 * ráfagas desordenadas y cuellos de botella de I/O.
 *
 * <p>Topics:
 * <ul>
 *   <li>{@code /topic/sim/{sessionId}/snapshot} — rutas activas del mapa</li>
 *   <li>{@code /topic/sim/{sessionId}/kpi} — métricas en tiempo real</li>
 *   <li>{@code /topic/sim/{sessionId}/eventLog} — bitácora de eventos</li>
 * </ul>
 */
@Service
@RequiredArgsConstructor
public class SimulationWsPublisher {

    private static final int DEFAULT_ROUTE_LIMIT = 220;

    private final SimulationProgressHolder progressHolder;
    private final SimpMessagingTemplate messaging;

    @Value("${tasf.sim.stream.routeLimit:" + DEFAULT_ROUTE_LIMIT + "}")
    private int routeLimit;

    private final ConcurrentHashMap<String, Long> seqBySession = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Integer> lastEventIdxBySession = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Boolean> finalSentBySession = new ConcurrentHashMap<>();
    
    // -- DIAGNOSTIC STATE --
    private final ConcurrentHashMap<String, Set<String>> prevIdsBySession = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, List<String>> trackedBySession = new ConcurrentHashMap<>();

    @Scheduled(fixedDelayString = "${tasf.sim.stream.intervalMs:500}")
    public void publishAllSessions() {
        for (String sessionId : progressHolder.getAllSessionIds()) {
            SimulationSessionState session = progressHolder.get(sessionId);
            if (session == null) continue;

            boolean isRunning = session.getStatus() == SimulationProgressHolder.Status.RUNNING;
            if (isRunning) {
                pushImmediate(sessionId, session);
                continue;
            }

            // Publicar una última vez al terminar/fallar, y luego dejar de emitir
            if (finalSentBySession.putIfAbsent(sessionId, true) == null) {
                pushImmediate(sessionId, session);
                seqBySession.remove(sessionId);
                lastEventIdxBySession.remove(sessionId);
                prevIdsBySession.remove(sessionId);
                trackedBySession.remove(sessionId);
            }
        }
    }

    public void pushImmediate(String sessionId, SimulationSessionState session) {
        long seq = seqBySession.merge(sessionId, 1L, Long::sum);
        int safeLimit = sanitizeLimit(routeLimit);

        SimulationMapSnapshotDTO map = buildMapSnapshot(session, safeLimit);
        
        // --- DIAGNOSTIC INSTRUMENTATION ---
        instrumentSnapshot(sessionId, map);
        
        messaging.convertAndSend(topic(sessionId, "snapshot"), new WsEnvelope<>(seq, map));

        SimulationKpiSnapshotDTO kpi = buildKpiSnapshot(session);
        messaging.convertAndSend(topic(sessionId, "kpi"), new WsEnvelope<>(seq, kpi));

        // Enviar solo eventos nuevos (delta)
        int lastIdx = lastEventIdxBySession.getOrDefault(sessionId, 0);
        List<String> logSnapshot = new ArrayList<>(session.getEventLog());
        for (int i = lastIdx; i < logSnapshot.size(); i++) {
            messaging.convertAndSend(topic(sessionId, "eventLog"),
                    new WsEnvelope<>(seq, logSnapshot.get(i)));
        }
        lastEventIdxBySession.put(sessionId, logSnapshot.size());
    }

    private void instrumentSnapshot(String sessionId, SimulationMapSnapshotDTO map) {
        List<SimulationMapRouteDTO> routesRaw = map.getActiveRoutes();
        final List<SimulationMapRouteDTO> routes = (routesRaw == null) ? Collections.emptyList() : routesRaw;

        Set<String> currentIds = routes.stream().map(SimulationMapRouteDTO::getId).collect(Collectors.toSet());
        
        // 1. Backend - Continuidad de vuelos [SNAPSHOT_DIAG]
        System.out.printf("[SNAPSHOT_DIAG] Time=%s Flights=%d Ids=%s%n", 
            map.getSimulatedTime(), routes.size(), 
            routes.stream().limit(10).map(SimulationMapRouteDTO::getId).collect(Collectors.joining(",")));

        // 1. Backend - Continuidad de vuelos [TRACK_FLIGHT]
        List<String> tracked = trackedBySession.get(sessionId);
        if (tracked == null || tracked.isEmpty()) {
            tracked = routes.stream().limit(5).map(SimulationMapRouteDTO::getId).collect(Collectors.toList());
            if (!tracked.isEmpty()) {
                trackedBySession.put(sessionId, tracked);
            }
        }

        for (String flightId : tracked) {
            Optional<SimulationMapRouteDTO> r = routes.stream().filter(f -> f.getId().equals(flightId)).findFirst();
            if (r.isPresent()) {
                 System.out.printf("[TRACK_FLIGHT] Time=%s Flight=%s Present=true Origin=%s Destination=%s%n",
                    map.getSimulatedTime(), flightId, r.get().getFrom(), r.get().getTo());
            } else {
                 System.out.printf("[TRACK_FLIGHT] Time=%s Flight=%s Present=false%n",
                    map.getSimulatedTime(), flightId);
            }
        }

        // 2. Backend - Estabilidad de identidad [IDENTITY_DIAG]
        Set<String> prevIds = prevIdsBySession.getOrDefault(sessionId, Collections.emptySet());
        Set<String> added = new HashSet<>(currentIds);
        added.removeAll(prevIds);
        Set<String> removed = new HashSet<>(prevIds);
        removed.removeAll(currentIds);

        System.out.printf("[IDENTITY_DIAG] Time=%s Added=%d Removed=%d%n", 
            map.getSimulatedTime(), added.size(), removed.size());

        for (String id : added) {
            System.out.printf("[FLIGHT_CHANGE] Time=%s Type=ADDED Flight=%s%n", map.getSimulatedTime(), id);
        }
        for (String id : removed) {
            System.out.printf("[FLIGHT_CHANGE] Time=%s Type=REMOVED Flight=%s%n", map.getSimulatedTime(), id);
        }

        prevIdsBySession.put(sessionId, currentIds);
    }

    private String topic(String sessionId, String channel) {
        return "/topic/sim/" + sessionId + "/" + channel;
    }

    private SimulationMapSnapshotDTO buildMapSnapshot(SimulationSessionState session, int limit) {
        SimulationProgressHolder.MapSnapshot snap = session.getMapSnapshot();

        if (snap == null) {
            return SimulationMapSnapshotDTO.builder()
                    .sessionId(session.getSessionId())
                    .status(session.getStatus().name())
                    .simulatedTime(session.getSimulatedTime())
                    .currentEpochTime(session.getCurrentEpochTime())
                    .snapshotEpochTime(System.currentTimeMillis())
                    .activeRoutes(toRouteDtos(session.getActiveRoutes(), limit))
                    .build();
        }

        return SimulationMapSnapshotDTO.builder()
                .sessionId(session.getSessionId())
                .status(session.getStatus().name())
                .simulatedTime(snap.clock())
                .currentEpochTime(snap.epoch())
                .snapshotEpochTime(System.currentTimeMillis())
                .activeRoutes(toRouteDtos(snap.routes(), limit))
                .build();
    }

    private SimulationKpiSnapshotDTO buildKpiSnapshot(SimulationSessionState session) {
        double globalOccupancy = 0;
        if (session.getAirportLoads() != null && !session.getAirportLoads().isEmpty()) {
            globalOccupancy = session.getAirportLoads().values().stream()
                    .mapToInt(Integer::intValue)
                    .average()
                    .orElse(0);
        }
        return SimulationKpiSnapshotDTO.builder()
                .sessionId(session.getSessionId())
                .status(session.getStatus().name())
                .percent(session.getPercent())
                .currentDay(session.getCurrentDay())
                .totalDays(session.getTotalDays())
                .slaPercent(session.getSlaPercent())
                .globalOccupancy(globalOccupancy)
                .criticalNodes(session.getCriticalNodes())
                .airportLoads(session.getAirportLoads())
                .totalBagsWaiting(session.getTotalBagsWaiting())
                .simulatedTime(session.getSimulatedTime())
                .currentEpochTime(session.getCurrentEpochTime())
                .isCollapseMode(session.isCollapseMode())
                .rescuedFlights(session.getRescuedFlights())
                .errorMessage(session.getErrorMessage())
                .startEpoch(session.getStartEpoch())
                .algorithm(session.getAlgorithm())
                .build();
    }

    private List<SimulationMapRouteDTO> toRouteDtos(List<Map<String, Object>> rawRoutes, int limit) {
        if (rawRoutes == null || rawRoutes.isEmpty()) {
            return Collections.emptyList();
        }
        return new ArrayList<>(rawRoutes).stream()
                .limit(limit)
                .map(this::toRouteDto)
                .collect(Collectors.toList());
    }

    private SimulationMapRouteDTO toRouteDto(Map<String, Object> route) {
        return SimulationMapRouteDTO.builder()
                .id(asString(route.get("id")))
                .from(asString(route.get("from")))
                .to(asString(route.get("to")))
                .progress(asDouble(route.get("progress")))
                .status(asString(route.get("status")))
                .departureTime(asLong(route.get("departureTime")))
                .arrivalTime(asLong(route.get("arrivalTime")))
                .capacityPercent(asDouble(route.get("capacityPercent")))
                .ocupacionReal(asInteger(route.get("ocupacionReal")))
                .capacidadMax(asInteger(route.get("capacidadMax")))
                .build();
    }

    private int sanitizeLimit(int limit) {
        return limit <= 0 ? DEFAULT_ROUTE_LIMIT : Math.min(limit, 600);
    }

    private Long asLong(Object value) {
        return value instanceof Number n ? n.longValue() : null;
    }

    private Double asDouble(Object value) {
        return value instanceof Number n ? n.doubleValue() : null;
    }

    private Integer asInteger(Object value) {
        return value instanceof Number n ? n.intValue() : null;
    }

    private String asString(Object value) {
        return value != null ? String.valueOf(value) : null;
    }

    public record WsEnvelope<T>(long seq, T data) {}
}
