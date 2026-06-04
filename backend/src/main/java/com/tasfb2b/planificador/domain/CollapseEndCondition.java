package com.tasfb2b.planificador.domain;

/**
 * Condición de terminación explícita para el escenario de simulación de colapso.
 *
 * <p>La simulación termina solo cuando se cumple la condición elegida
 * por el operador al lanzar {@code POST /run-collapse/{dias}}.
 */
public enum CollapseEndCondition {

    /**
     * Terminar cuando el SLA diario cae por debajo de un umbral
     * por N días consecutivos (configurable vía properties).
     */
    SLA_BELOW_THRESHOLD,

    /**
     * Terminar cuando todos los aeropuertos están en estado crítico
     * (ocupación >= 90%) en el fin de día.
     */
    ALL_AIRPORTS_CRITICAL,

    /**
     * Nunca terminar por condición. La simulación corre los N días completos
     * configurados, útil para medir la degradación completa sin corte.
     */
    NONE
}
