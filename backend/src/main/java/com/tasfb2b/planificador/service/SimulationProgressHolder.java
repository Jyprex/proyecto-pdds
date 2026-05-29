package com.tasfb2b.planificador.service;

import com.tasfb2b.planificador.domain.SimulationDayReport;
import lombok.Data;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Almacena el progreso en tiempo real de las simulaciones asíncronas.
 *
 * <p>Indexado por UUID de sesión (String). Acceso thread-safe via
 * {@link ConcurrentHashMap}. El estado de cada sesión es mutable
 * y actualizado por {@link SimulationService} durante la ejecución.
 *
 * <p>Ciclo de vida de una sesión:
 * <ol>
 *   <li>POST /api/v1/simulation/run → se crea con status RUNNING</li>
 *   <li>SimulationService actualiza percent/currentDay en cada iteración</li>
 *   <li>Al finalizar → status = DONE; al fallar → status = FAILED</li>
 *   <li>GET /api/v1/simulation/status/{id} lee el estado en cualquier momento</li>
 * </ol>
 */
@Component
public class SimulationProgressHolder {

    public enum Status { RUNNING, DONE, FAILED }

    /**
     * Estado completo de una sesión de simulación.
     * Los campos son actualizados directamente por SimulationService.
     */
    @Data
    public static class SimulationSessionState {
        private String sessionId;
        private Status status = Status.RUNNING;

        private int percent = 0;
        private int currentDay = 0;
        private int totalDays;

        /** Reporte acumulado de todos los días completados. */
        private final List<SimulationDayReport> reports = new ArrayList<>();

        /** Snapshot de ocupación por aeropuerto ICAO → porcentaje 0-100. */
        private Map<String, Integer> airportLoads;

        /** SLA acumulado hasta el día actual. */
        private double slaPercent = 0.0;

        /** Número de aeropuertos en estado crítico (>90% ocupación). */
        private int criticalNodes = 0;

        /**
         * Rutas activas del día en curso para visualización en el mapa.
         * Cada elemento: { "id", "from", "to", "progress", "status" }
         */
        private List<Map<String, Object>> activeRoutes = new ArrayList<>();

        /** Reloj simulado (ej. "Día 1 - 14:00") */
        private String simulatedTime;

        /** Tiempo real en milisegundos para la Ventana Móvil */
        private Long currentEpochTime;

        /** Cantidad de maletas esperando en todos los almacenes */
        private Integer totalBagsWaiting;

        /** Log de eventos textuales */
        private final List<String> eventLog = new ArrayList<>();

        /** Métricas finales del resumen */
        private int totalAttended;
        private int totalMissed;
        private double slaFinal;

        /** Métricas de colapso */
        private boolean isCollapseMode;
        private int rescuedFlights;
        /** Factor de estrés operativo (1–10). Determina el % de rutas canceladas: stress × 3%. */
        private int stressFactor = 5;

        /** Diccionario general de resultados por algortimo */
        private Map<String, Map<String, Object>> comparisonResults;

        /** Mensaje de error si status = FAILED. */
        private String errorMessage;

        /** Algoritmo utilizado (ALNS) */
        private String algorithm = "ALNS";
        
        /** Epoch ms del primer día simulado — para el Excel export. */
        private Long startEpoch;
    }

    private final ConcurrentHashMap<String, SimulationSessionState> sessions =
            new ConcurrentHashMap<>();

    /** Diccionario global para persistir métricas por algoritmo (ALNS) */
    private final ConcurrentHashMap<String, Map<String, Object>> comparisonResults =
            new ConcurrentHashMap<>();

    /** Registra una nueva sesión con el UUID dado y totalDays. */
    public SimulationSessionState create(String sessionId, int totalDays) {
        SimulationSessionState state = new SimulationSessionState();
        state.setSessionId(sessionId);
        state.setTotalDays(totalDays);
        sessions.put(sessionId, state);
        return state;
    }

    /** Retorna el estado de una sesión, o null si no existe. */
    public SimulationSessionState get(String sessionId) {
        return sessions.get(sessionId);
    }

    /** Snapshot de ids activos (thread-safe) para broadcasting/monitoreo. */
    public List<String> getAllSessionIds() {
        return new ArrayList<>(sessions.keySet());
    }

    /** Retorna el diccionario global de comparativa de algoritmos. */
    public Map<String, Map<String, Object>> getComparisonResults() {
        return comparisonResults;
    }

    /** Guarda las métricas finales de un algoritmo. */
    public void saveAlgorithmResult(String algorithm, Map<String, Object> metrics) {
        comparisonResults.put(algorithm, metrics);
    }

    /** Marca una sesión como completada. */
    public void markDone(String sessionId) {
        SimulationSessionState state = sessions.get(sessionId);
        if (state != null) {
            state.setStatus(Status.DONE);
            state.setPercent(100);
        }
    }

    /** Marca una sesión como fallida con el mensaje de error. */
    public void markFailed(String sessionId, String errorMessage) {
        SimulationSessionState state = sessions.get(sessionId);
        if (state != null) {
            state.setStatus(Status.FAILED);
            state.setErrorMessage(errorMessage);
        }
    }

    /** Limpia sesiones antiguas (opcional — para gestión de memoria). */
    public void remove(String sessionId) {
        sessions.remove(sessionId);
    }
}
