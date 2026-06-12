package com.tasfb2b.planificador.web;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;
import com.tasfb2b.planificador.web.SimulationMapRouteDTO;
/**
 * DTO tipado para el snapshot del mapa enviado por WebSocket.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SimulationMapSnapshotDTO {

    private String sessionId;
    private String status;
    private String simulatedTime;
    private Long currentEpochTime;
    private Long snapshotEpochTime;
    private String planId;
    private List<SimulationMapRouteDTO> activeRoutes;
    private List<Map<String, Object>> masterPlan;
}
