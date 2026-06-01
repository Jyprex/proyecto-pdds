package com.tasfb2b.planificador.web;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * DTO de respuesta para el endpoint GET /api/v1/simulation/status/{sessionId}.
 *
 * <p>Contiene toda la información que el frontend necesita para:
 * <ul>
 *   <li>Actualizar la barra de progreso</li>
 *   <li>Mover los aviones en el WorldMap</li>
 *   <li>Actualizar los KPI strips</li>
 *   <li>Colorear los aeropuertos según ocupación real</li>
 * </ul>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SimulationStatusDTO {

    /** UUID de la sesión de simulación. */
    private String sessionId;

    /** Estado: RUNNING | DONE | FAILED */
    private String status;

    /** Porcentaje de avance 0–100. */
    private int percent;

    /** Día actual procesado (base 1). */
    private int currentDay;

    /** Total de días de la simulación. */
    private int totalDays;

    /** SLA acumulado hasta el día actual (0.0 – 100.0). */
    private double slaPercent;

    /** Ocupación global promedio de almacenes (0.0 – 100.0). */
    private double globalOccupancy;

    /** Número de aeropuertos en estado crítico (ocupación > 90%). */
    private int criticalNodes;

    /**
     * Rutas activas del día en curso para animar aviones en el mapa.
     * Cada elemento: { "id": int, "from": "ICAO", "to": "ICAO",
     *                  "progress": 0.5, "status": "normal|critical|blocked" }
     */
    private List<Map<String, Object>> activeRoutes;

    /**
     * Ocupación actual por aeropuerto ICAO.
     * { "SKBO": 72, "EHAM": 45, ... }
     * El frontend usa este mapa para colorear los marcadores del WorldMap.
     */
    private Map<String, Integer> airportLoads;

    /** Reloj simulado (ej. "Día 1 - 14:00") */
    private String simulatedTime;

    /** Tiempo real de la simulación en Epoch (milisegundos) para la Ventana Móvil. */
    private Long currentEpochTime;

    /** Cantidad total de maletas esperando en los almacenes en este instante. */
    private Integer totalBagsWaiting;

    /** Log de eventos textuales */
    private List<String> eventLog;

    /** Métricas finales del resumen */
    private Integer totalAttended;
    private Integer totalMissed;
    private Double slaFinal;

    /** Métricas de colapso */
    private Boolean isCollapseMode;
    private Integer rescuedFlights;
    private Double stressFactor;
    private Long startEpoch;
    private String algorithm;

    /** Condición de terminación del colapso (NONE | SLA_BELOW_THRESHOLD | ALL_AIRPORTS_CRITICAL). */
    private String endCondition;

    /** Día (1-based) en que se cumplió la condición de terminación, null si no terminó por condición. */
    private Integer collapseDayIndex;

    /** Razón humana de la terminación por condición. */
    private String collapseReason;

    /** Diccionario de resultados comparativos por algoritmo */
    private Map<String, Map<String, Object>> comparisonResults;

    /** Mensaje de error si status = FAILED. */
    private String errorMessage;

    /**
     * Demanda REAL por fecha (suma de cantidadMaletas de los archivos .txt).
     * Clave: "YYYYMMDD", Valor: total de maletas de todos los aeropuertos ese día.
     * Permite al frontend mostrar el análisis real vs. capacidad del sistema.
     */
    private Map<String, Long> dailyRealDemand;

    /**
     * Reportes diarios de la simulación (disponibles cuando status = DONE).
     * Cada elemento: { dayIndex, totalMaletas, malatetasAtendidas,
     *                  slaPercent, airportSaturation, colapsed }
     */
    private List<Map<String, Object>> reports;
}
