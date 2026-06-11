package com.tasfb2b.planificador.web;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * DTO tipado para cada segmento de ruta activa en el mapa.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SimulationMapRouteDTO {

    private String id;
    private String from;
    private String to;
    private Double progress;
    private String status;
    private Long departureTime;
    private Long arrivalTime;
    private Double capacityPercent;
    private Integer ocupacionReal;
    private Integer capacidadMax;
}
