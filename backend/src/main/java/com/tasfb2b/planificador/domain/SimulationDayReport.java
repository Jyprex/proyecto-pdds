package com.tasfb2b.planificador.domain;

import com.tasfb2b.superlote.domain.SuperLot;
import lombok.Data;
import lombok.Getter;

import java.util.ArrayList;
import java.util.List;

@Data
@Getter
public class SimulationDayReport {

    private int dayIndex;
    private long startTime;
    private long endTime;

    private List<Route> routes;

    private boolean colapsed;
    private int airportSaturation;
    private int flightSaturation;
    private long collapseTime;

    // ── Métricas de negocio ──────────────────────────────
    /** Porcentaje de maletas entregadas a tiempo (SLA cumplido). */
    private double slaPercent;

    /** Total de maletas que el planificador intentó mover en este día. */
    private int totalMaletas;

    /** Maletas efectivamente asignadas a vuelos (capacidadAsignada total). */
    private int malatetasAtendidas;

    /** Maletas entregadas al cliente final (recogidas del almacén destino). */
    private int maletasEntregadas;

    /**
     * Lotes no atendidos o con exceso de capacidad que no pudieron ser
     * procesados completamente en este día. Se pasan al día N+1 con prioridad máxima.
     */
    private List<SuperLot> pendingLots = new ArrayList<>();
}

