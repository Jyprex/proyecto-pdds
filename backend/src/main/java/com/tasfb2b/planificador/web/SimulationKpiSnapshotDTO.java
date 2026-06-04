package com.tasfb2b.planificador.web;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SimulationKpiSnapshotDTO {

    private String sessionId;
    private String status;
    private Integer percent;
    private Integer currentDay;
    private Integer totalDays;
    private Double slaPercent;
    private Double globalOccupancy;
    private Integer criticalNodes;
    private Map<String, Map<String, Object>> airportLoads;
    private Integer totalBagsWaiting;
    private String simulatedTime;
    private Long currentEpochTime;
    private Boolean isCollapseMode;
    private Integer rescuedFlights;
    private String errorMessage;
    private Long startEpoch;
}
