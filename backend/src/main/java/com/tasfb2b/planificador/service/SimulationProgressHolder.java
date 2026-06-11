package com.tasfb2b.planificador.service;

import com.tasfb2b.planificador.domain.CollapseEndCondition;
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
 */
@Component
public class SimulationProgressHolder {

    public enum Status { RUNNING, DONE, FAILED }

    /** Snapshot inmutable de los datos del mapa para evitar condiciones de carrera con el WebSocket publisher. */
    public record MapSnapshot(Long epoch, String clock, List<Map<String, Object>> routes) {}

    /**
     * Frame WS atómico para el visualizador: unifica reloj + rutas + KPIs/inventarios.
     */
    public record WsFrame(
            String sessionId,
            String status,
            Long currentEpochTime,
            String simulatedTime,
            Integer percent,
            Integer currentDay,
            Integer totalDays,
            Double slaPercent,
            Integer criticalNodes,
            Map<String, Map<String, Object>> airportLoads,
            Integer totalBagsWaiting,
            Boolean isCollapseMode,
            Integer rescuedFlights,
            String errorMessage,
            Long startEpoch,
            List<Map<String, Object>> activeRoutes,
            String algorithm
    ) {}

    /**
     * Estado completo de una sesión de simulación.
     */
    @Data
    public static class SimulationSessionState {
        private String sessionId;
        private Status status = Status.RUNNING;

        /** Contenedor inmutable para sincronización con el WebSocket Publisher */
        private volatile MapSnapshot mapSnapshot;

        /** Último frame atómico para WS (rutas + KPIs + reloj). */
        private volatile WsFrame wsFrame;

        private int percent = 0;
        private int currentDay = 0;
        private int totalDays;

        /** Reporte acumulado de todos los días completados. */
        private final List<SimulationDayReport> reports = new ArrayList<>();

        /** 
         * Snapshot de ocupación por aeropuerto ICAO.
         */
        private Map<String, Map<String, Object>> airportLoads;

        /** SLA acumulado hasta el día actual. */
        private double slaPercent = 0.0;

        /** Número de aeropuertos en estado crítico (>90% ocupación). */
        private int criticalNodes = 0;

        /**
         * Rutas activas del día en curso para visualización en el mapa.
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
        /** Factor de estrés operativo (1–10). Determina el % de rutas canceladas. */
        private double stressFactor = 5.0;

        /** Condición de terminación explícita del modo colapso. Default: NONE. */
        private CollapseEndCondition endCondition = CollapseEndCondition.NONE;

        /** Contador de días consecutivos con SLA por debajo del umbral. */
        private int slaStreak = 0;

        /** Día (1-based) en que se cumplió la condición de terminación. */
        private Integer collapseDayIndex;

        /** Razón humana de la terminación por condición. */
        private String collapseReason;

        /** Mensaje de error si status = FAILED. */
        private String errorMessage;

        /** Algoritmo utilizado (ALNS) */
        private String algorithm = "ALNS";

        /** Longitud promedio de ruta. */
        private double avgRouteLength = 0.0;
        
        /** Epoch ms del primer día simulado. */
        private Long startEpoch;
    }

    private final ConcurrentHashMap<String, SimulationSessionState> sessions =
            new ConcurrentHashMap<>();

    /** Diccionario global para persistir métricas por algoritmo. */
    private final ConcurrentHashMap<String, Map<String, Object>> comparisonResults =
            new ConcurrentHashMap<>();

    public SimulationSessionState create(String sessionId, int totalDays) {
        SimulationSessionState state = new SimulationSessionState();
        state.setSessionId(sessionId);
        state.setTotalDays(totalDays);
        sessions.put(sessionId, state);
        return state;
    }

    public SimulationSessionState get(String sessionId) {
        return sessions.get(sessionId);
    }

    public List<String> getAllSessionIds() {
        return new ArrayList<>(sessions.keySet());
    }

    public Map<String, Map<String, Object>> getComparisonResults() {
        return comparisonResults;
    }

    public void saveAlgorithmResult(String algorithm, Map<String, Object> metrics) {
        comparisonResults.put(algorithm, metrics);
    }

    public void markDone(String sessionId) {
        SimulationSessionState state = sessions.get(sessionId);
        if (state != null) {
            state.setStatus(Status.DONE);
            state.setPercent(100);
        }
    }

    public void markFailed(String sessionId, String errorMessage) {
        SimulationSessionState state = sessions.get(sessionId);
        if (state != null) {
            state.setStatus(Status.FAILED);
            state.setErrorMessage(errorMessage);
        }
    }

    public void remove(String sessionId) {
        sessions.remove(sessionId);
    }
}
