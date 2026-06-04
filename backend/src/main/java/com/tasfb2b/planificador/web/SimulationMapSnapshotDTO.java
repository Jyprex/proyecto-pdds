package com.tasfb2b.planificador.web;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * DTO tipado para el snapshot del mapa enviado por WebSocket.
 * Contiene las rutas activas visibles en el frontend.
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
    private List<SimulationMapRouteDTO> activeRoutes;
}
