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
        // Nota: el holder no expone el map; se publica solo sesiones activas via una lista snapshot.
        // Para mantener cambios minimos, se usa reflection-free: se agrego getAllSessionIds() en holder.
        for (String sessionId : progressHolder.getAllSessionIds()) {
            SimulationSessionState session = progressHolder.get(sessionId);
            if (session == null) {
                continue;
            }

            boolean isRunning = session.getStatus() == SimulationProgressHolder.Status.RUNNING;
            if (isRunning) {
                publishOne(sessionId, session);
                continue;
            }

            // Publicar una ultima vez al terminar/fallar, y luego dejar de spamear.
            if (finalSentBySession.putIfAbsent(sessionId, true) == null) {
                publishOne(sessionId, session);
                seqBySession.remove(sessionId);
                lastEventIdxBySession.remove(sessionId);
            }
        }
    }

    private void publishOne(String sessionId, SimulationSessionState session) {
        long seq = seqBySession.merge(sessionId, 1L, Long::sum);
        int safeLimit = sanitizeLimit(routeLimit);

        SimulationMapSnapshotDTO map = buildMapSnapshot(session, safeLimit);
        // Añadimos seq a headers via payload wrapper minimo
        messaging.convertAndSend(topic(sessionId, "snapshot"), new WsEnvelope<>(seq, map));

        SimulationKpiSnapshotDTO kpi = buildKpiSnapshot(session);
        messaging.convertAndSend(topic(sessionId, "kpi"), new WsEnvelope<>(seq, kpi));

        int lastIdx = lastEventIdxBySession.getOrDefault(sessionId, 0);
        List<String> logSnapshot = new ArrayList<>(session.getEventLog());
        for (int i = lastIdx; i < logSnapshot.size(); i++) {
            messaging.convertAndSend(topic(sessionId, "eventLog"), new WsEnvelope<>(seq, logSnapshot.get(i)));
        }
        lastEventIdxBySession.put(sessionId, logSnapshot.size());

        // La limpieza por sesion se maneja en publishAllSessions() al detectar fin.
    }

    private String topic(String sessionId, String channel) {
        return "/topic/sim/" + sessionId + "/" + channel;
    }

    private SimulationMapSnapshotDTO buildMapSnapshot(SimulationSessionState session, int limit) {
        List<SimulationMapRouteDTO> routes = toRouteDtos(session.getActiveRoutes(), limit);

        return SimulationMapSnapshotDTO.builder()
                .sessionId(session.getSessionId())
                .status(session.getStatus().name())
                .simulatedTime(session.getSimulatedTime())
                .currentEpochTime(session.getCurrentEpochTime())
                .snapshotEpochTime(System.currentTimeMillis())
                .activeRoutes(routes)
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
                .id(asInt(route.get("id")))
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
