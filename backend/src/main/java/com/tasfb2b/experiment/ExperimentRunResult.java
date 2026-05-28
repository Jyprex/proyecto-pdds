package com.tasfb2b.experiment;

import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class ExperimentRunResult {

    private int levelIndex;          // 0-4 (orden del nivel)
    private String levelName;        // "Caso Mínimo de Envíos", etc.
    private String levelTag;         // "MIN", "MID_LOW", "AVG", "MID_HIGH", "MAX"
    private String fecha;            // Fecha histórica de referencia del nivel DOE
    private long targetSuitcases;    // Cap DOE aplicado (maletas usadas para este nivel)
    private String status;           // "PENDING", "RUNNING", "COMPLETED", "FAILED"

    // ── KPIs Logísticos ──────────────────────────────────────────────────────
    private double occupancyRate;       // Tasa de Ocupación Efectiva (%)
    private double leadTimeAvg;         // Lead Time Promedio (horas)
    private double complianceRate;      // Tasa de Cumplimiento de Demanda (%)
    private double fitnessScore;        // Score = 10A - 0.005Ecap - 2Dh - 12Saero

    // ── Resumen de Carga ─────────────────────────────────────────────────────
    private long totalProcessed;     // Total maletas del nivel (cap aplicado)
    private long totalAttended;      // Maletas atendidas
    private long totalEcap;          // Maletas no atendidas / exceso

    // ── Estadísticas de Rutas y Vuelos ────────────────────────────────────────
    private int totalRoutes;         // Total de rutas en la solución
    private int routesServed;        // Rutas efectivamente atendidas
    private int routesUnserved;      // Rutas no atendidas (sin capacidad)
    private long maxRouteCapacity;   // Máxima capacidad asignada en una sola ruta
    private double avgRouteCapacity; // Promedio de maletas por ruta atendida

    // ── Desglose de Tiempos (Fases) ──────────────────────────────────────────
    private long loadingTimeMs;      // Fase 1: Filtrado de SuperLots con cap
    private long planningTimeMs;     // Fase 2: Tiempo del algoritmo (ALNS)
    private long simulationTimeMs;   // Fase 3: Tiempo de SimulationRunner
    private long executionTimeMs;    // Total (suma de las 3 fases)

    // ── Desempeño Computacional ──────────────────────────────────────────────
    private double memoryUsedMb;         // Memoria RAM usada (MB)
    private double cpuUsagePercent;      // CPU promedio durante el cálculo (%)
    private double avgAirportSaturation; // Saturación aeroportuaria promedio (%)

    // ── Colapso Computacional (Ta >= Sa) ─────────────────────────────────────
    /** Ventana de tiempo asignada al algoritmo para este nivel (ms). */
    private long algorithmWindowMs;
    /**
     * true si el tiempo real de planificación (Ta = planningTimeMs) superó el
     * umbral operativo máximo (Sa = 15 000 ms). Indica que el software habría
     * dejado partir el vuelo sin una solución óptima → Colapso Computacional.
     */
    private boolean colapsoComputacional;
}
