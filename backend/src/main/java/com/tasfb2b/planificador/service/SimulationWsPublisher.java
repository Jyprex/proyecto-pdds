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

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * Publica periodicamente el estado de cada sesion via WebSocket (STOMP).
 *
 * Topics:
 * - /topic/sim/{sessionId}/snapshot
 * - /topic/sim/{sessionId}/kpi
 * - /topic/sim/{sessionId}/eventLog
 */
@Service
@RequiredArgsConstructor
public class SimulationWsPublisher {

    private static final int DEFAULT_ROUTE_LIMIT = 220;

    private final SimulationProgressHolder progressHolder;
    private final SimpMessagingTemplate messaging;

    @Value("${tasf.sim.stream.routeLimit:" + DEFAULT_ROUTE_LIMIT + "}")
    private int routeLimit;

    // seq por sesion: ayuda a debugging y orden en el front
    private final ConcurrentHashMap<String, Long> seqBySession = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Integer> lastEventIdxBySession = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Boolean> finalSentBySession = new ConcurrentHashMap<>();

    @Scheduled(fixedDelayString = "${tasf.sim.stream.intervalMs:500}")
    public void publishAllSessions() {
        for (String sessionId : progressHolder.getAllSessionIds()) {
            SimulationSessionState session = progressHolder.get(sessionId);
            if (session == null) continue;

            boolean isRunning = session.getStatus() == SimulationProgressHolder.Status.RUNNING;
            if (isRunning) {
                // Seguimos permitiendo el polling de KPIs globales/logs
                pushImmediate(sessionId, session);
                continue;
            }

            if (finalSentBySession.putIfAbsent(sessionId, true) == null) {
                pushImmediate(sessionId, session);
                seqBySession.remove(sessionId);
                lastEventIdxBySession.remove(sessionId);
            }
        }
    }

    /** Publicación inmediata bajo demanda (Direct Push) */
    public void pushImmediate(String sessionId, SimulationSessionState session) {
        long tStart = System.currentTimeMillis();
        long seq = seqBySession.merge(sessionId, 1L, Long::sum);
        int safeLimit = sanitizeLimit(routeLimit);

        // Leer frame WS una sola vez para consistencia temporal entre snapshot y KPI.
        SimulationProgressHolder.WsFrame frame = session.getWsFrame();

        SimulationMapSnapshotDTO map = buildMapSnapshot(session, frame, safeLimit);
        messaging.convertAndSend(topic(sessionId, "snapshot"), new WsEnvelope<>(seq, map));

        SimulationKpiSnapshotDTO kpi = buildKpiSnapshot(session, frame);
        messaging.convertAndSend(topic(sessionId, "kpi"), new WsEnvelope<>(seq, kpi));

        int lastIdx = lastEventIdxBySession.getOrDefault(sessionId, 0);
        List<String> logSnapshot = new ArrayList<>(session.getEventLog());
        for (int i = lastIdx; i < logSnapshot.size(); i++) {
            messaging.convertAndSend(topic(sessionId, "eventLog"), new WsEnvelope<>(seq, logSnapshot.get(i)));
        }
        lastEventIdxBySession.put(sessionId, logSnapshot.size());

        long tEnd = System.currentTimeMillis();
        int routesCount = (map.getActiveRoutes() != null) ? map.getActiveRoutes().size() : 0;
        
        System.out.printf("[PUBLISH] snapshotTime: %s | generatedAt: %d | publishedAt: %d | publishDelayMs: %d | Routes: %d%n", 
                        map.getSimulatedTime(), tStart, tEnd, (tEnd - tStart), routesCount);
    }

    private String topic(String sessionId, String channel) {
        return "/topic/sim/" + sessionId + "/" + channel;
    }

    private SimulationMapSnapshotDTO buildMapSnapshot(SimulationSessionState session, SimulationProgressHolder.WsFrame frame, int limit) {
        if (frame != null) {
            return SimulationMapSnapshotDTO.builder()
                    .sessionId(frame.sessionId())
                    .status(frame.status())
                    .simulatedTime(frame.simulatedTime())
                    .currentEpochTime(frame.currentEpochTime())
                    .snapshotEpochTime(System.currentTimeMillis())
                    .activeRoutes(toRouteDtos(frame.activeRoutes(), limit))
                    .build();
        }

        // Fallback: Leemos la referencia VOLATILE una sola vez (Snapshot local consistente)
        SimulationProgressHolder.MapSnapshot snap = session.getMapSnapshot();
        if (snap == null) {
            // Fallback si aún no hay primer snapshot procesado
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

    private SimulationKpiSnapshotDTO buildKpiSnapshot(SimulationSessionState session, SimulationProgressHolder.WsFrame frame) {
        Map<String, Map<String, Object>> loads = (frame != null) ? frame.airportLoads() : session.getAirportLoads();

        double globalOccupancy = 0;
        if (loads != null && !loads.isEmpty()) {
            globalOccupancy = loads.values().stream()
                    .mapToInt(data -> (Integer) data.getOrDefault("occupancy", 0))
                    .average()
                    .orElse(0);
        }

        if (frame != null) {
            return SimulationKpiSnapshotDTO.builder()
                    .sessionId(frame.sessionId())
                    .status(frame.status())
                    .percent(frame.percent())
                    .currentDay(frame.currentDay())
                    .totalDays(frame.totalDays())
                    .slaPercent(frame.slaPercent())
                    .globalOccupancy(globalOccupancy)
                    .criticalNodes(frame.criticalNodes())
                    .airportLoads(loads)
                    .totalBagsWaiting(frame.totalBagsWaiting())
                    .simulatedTime(frame.simulatedTime())
                    .currentEpochTime(frame.currentEpochTime())
                    .isCollapseMode(frame.isCollapseMode())
                    .rescuedFlights(frame.rescuedFlights())
                    .errorMessage(frame.errorMessage())
                    .startEpoch(frame.startEpoch())
                    .build();
        }

        // Fallback legado
        return SimulationKpiSnapshotDTO.builder()
                .sessionId(session.getSessionId())
                .status(session.getStatus().name())
                .percent(session.getPercent())
                .currentDay(session.getCurrentDay())
                .totalDays(session.getTotalDays())
                .slaPercent(session.getSlaPercent())
                .globalOccupancy(globalOccupancy)
                .criticalNodes(session.getCriticalNodes())
                .airportLoads(loads)
                .totalBagsWaiting(session.getTotalBagsWaiting())
                .simulatedTime(session.getSimulatedTime())
                .currentEpochTime(session.getCurrentEpochTime())
                .isCollapseMode(session.isCollapseMode())
                .rescuedFlights(session.getRescuedFlights())
                .errorMessage(session.getErrorMessage())
                .startEpoch(session.getStartEpoch())
                .build();
    }

    private List<SimulationMapRouteDTO> toRouteDtos(List<Map<String, Object>> rawRoutes, int limit) {
        if (rawRoutes == null || rawRoutes.isEmpty()) {
            return Collections.emptyList();
        }

        List<Map<String, Object>> snapshot = new ArrayList<>(rawRoutes);
        return snapshot.stream()
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
                .build();
    }

    private int sanitizeLimit(int limit) {
        if (limit <= 0) {
            return DEFAULT_ROUTE_LIMIT;
        }
        return Math.min(limit, 600);
    }

    private Integer asInt(Object value) {
        if (value instanceof Number number) {
            return number.intValue();
        }
        return null;
    }

    private Long asLong(Object value) {
        if (value instanceof Number number) {
            return number.longValue();
        }
        return null;
    }

    private Double asDouble(Object value) {
        if (value instanceof Number number) {
            return number.doubleValue();
        }
        return null;
    }

    private String asString(Object value) {
        return value != null ? String.valueOf(value) : null;
    }

    public record WsEnvelope<T>(long seq, T data) {}
}
