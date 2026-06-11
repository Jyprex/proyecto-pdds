package com.tasfb2b.planificador.service;

import com.tasfb2b.aeropuerto.domain.Aeropuerto;
import com.tasfb2b.aeropuerto.domain.Continente;
import com.tasfb2b.planificador.domain.CollapseEndCondition;
import com.tasfb2b.planificador.domain.SimulationDayReport;
import com.tasfb2b.planificador.simulation.SimulationState;
import com.tasfb2b.vuelo.domain.Vuelo;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Tests unitarios de la lógica de terminación por condición de colapso
 * (PLANES/PLAN_COLAPSO_INFORMATIVO.md).
 *
 * <p>No requieren Spring context: invocan directamente
 * {@link SimulationService#checkEndCondition} con fixtures construidos a mano.
 */
class SimulationCollapseEndConditionTest {

    private final CollapseHelper collapseHelper = new CollapseHelper(null, null);

    private static final double SLA_THRESHOLD = 30.0;
    private static final int CONSECUTIVE_DAYS = 2;

    public SimulationCollapseEndConditionTest() {
        org.springframework.test.util.ReflectionTestUtils.setField(collapseHelper, "collapseSlaThreshold", 30.0);
        org.springframework.test.util.ReflectionTestUtils.setField(collapseHelper, "collapseConsecutiveDays", 2);
    }

    private static Aeropuerto aeropuerto(String icao, int storageCapacity) {
        return Aeropuerto.builder()
                .icaoCode(icao)
                .city("Test-" + icao)
                .country("Test")
                .continent(Continente.AMERICA)
                .storageCapacity(storageCapacity)
                .gmtOffset(0)
                .build();
    }

    private static SimulationState stateConCarga(Map<String, Integer> cargaPorIcao,
                                                 Map<String, Aeropuerto> airportMap) {
        List<Aeropuerto> airports = List.copyOf(airportMap.values());
        SimulationState state = new SimulationState(airports, List.<Vuelo>of(), 0L, null);
        cargaPorIcao.forEach((icao, carga) -> state.getCargaAeropuerto().put(icao, carga));
        return state;
    }

    private static SimulationProgressHolder.SimulationSessionState sesion(CollapseEndCondition cond) {
        SimulationProgressHolder.SimulationSessionState s =
                new SimulationProgressHolder.SimulationSessionState();
        s.setEndCondition(cond);
        return s;
    }

    // ── SLA_BELOW_THRESHOLD ─────────────────────────────────────────

    @Test
    void sla_bajo_un_dia_no_termina() {
        SimulationProgressHolder.SimulationSessionState s = sesion(CollapseEndCondition.SLA_BELOW_THRESHOLD);
        SimulationDayReport report = new SimulationDayReport();
        report.setSlaPercent(25.0); // bajo el umbral

        Map<String, Aeropuerto> airportMap = new HashMap<>();
        airportMap.put("SKBO", aeropuerto("SKBO", 100));
        SimulationState state = stateConCarga(Map.of("SKBO", 50), airportMap);

        CollapseHelper.CollapseCheckResult r = collapseHelper.checkEndCondition(
                s, report, state, airportMap);

        assertThat(r.terminated()).isFalse();
        assertThat(s.getSlaStreak()).isEqualTo(1);
    }

    @Test
    void sla_bajo_dos_dias_consecutivos_termina() {
        SimulationProgressHolder.SimulationSessionState s = sesion(CollapseEndCondition.SLA_BELOW_THRESHOLD);
        s.setSlaStreak(1); // día anterior ya cumplió

        SimulationDayReport report = new SimulationDayReport();
        report.setSlaPercent(20.0);

        Map<String, Aeropuerto> airportMap = new HashMap<>();
        airportMap.put("SKBO", aeropuerto("SKBO", 100));
        SimulationState state = stateConCarga(Map.of("SKBO", 50), airportMap);

        CollapseHelper.CollapseCheckResult r = collapseHelper.checkEndCondition(
                s, report, state, airportMap);

        assertThat(r.terminated()).isTrue();
        assertThat(s.getSlaStreak()).isEqualTo(2);
        assertThat(r.reason()).contains("SLA < 30.0%").contains("2 días");
    }

    @Test
    void sla_alto_resetea_streak() {
        SimulationProgressHolder.SimulationSessionState s = sesion(CollapseEndCondition.SLA_BELOW_THRESHOLD);
        s.setSlaStreak(5); // streak acumulado

        SimulationDayReport report = new SimulationDayReport();
        report.setSlaPercent(80.0); // SLA alto hoy

        Map<String, Aeropuerto> airportMap = new HashMap<>();
        airportMap.put("SKBO", aeropuerto("SKBO", 100));
        SimulationState state = stateConCarga(Map.of("SKBO", 50), airportMap);

        CollapseHelper.CollapseCheckResult r = collapseHelper.checkEndCondition(
                s, report, state, airportMap);

        assertThat(r.terminated()).isFalse();
        assertThat(s.getSlaStreak()).isEqualTo(0);
    }

    // ── ALL_AIRPORTS_CRITICAL ───────────────────────────────────────

    @Test
    void todos_los_aeropuertos_criticos_termina() {
        SimulationProgressHolder.SimulationSessionState s = sesion(CollapseEndCondition.ALL_AIRPORTS_CRITICAL);

        SimulationDayReport report = new SimulationDayReport();
        report.setSlaPercent(50.0);

        Map<String, Aeropuerto> airportMap = new HashMap<>();
        airportMap.put("SKBO", aeropuerto("SKBO", 100));
        airportMap.put("SEQM", aeropuerto("SEQM", 100));
        airportMap.put("SVMI", aeropuerto("SVMI", 100));

        // 95% de capacidad en los 3 = todos críticos
        SimulationState state = stateConCarga(
                Map.of("SKBO", 95, "SEQM", 95, "SVMI", 95), airportMap);

        CollapseHelper.CollapseCheckResult r = collapseHelper.checkEndCondition(
                s, report, state, airportMap);

        assertThat(r.terminated()).isTrue();
        assertThat(r.reason()).contains("3/3");
    }

    @Test
    void un_aeropuerto_no_critico_no_termina() {
        SimulationProgressHolder.SimulationSessionState s = sesion(CollapseEndCondition.ALL_AIRPORTS_CRITICAL);

        SimulationDayReport report = new SimulationDayReport();
        report.setSlaPercent(50.0);

        Map<String, Aeropuerto> airportMap = new HashMap<>();
        airportMap.put("SKBO", aeropuerto("SKBO", 100));
        airportMap.put("SEQM", aeropuerto("SEQM", 100));

        // SKBO crítico, SEQM no
        SimulationState state = stateConCarga(
                Map.of("SKBO", 95, "SEQM", 50), airportMap);

        CollapseHelper.CollapseCheckResult r = collapseHelper.checkEndCondition(
                s, report, state, airportMap);

        assertThat(r.terminated()).isFalse();
    }

    // ── NONE ────────────────────────────────────────────────────────

    @Test
    void none_nunca_termina_por_condicion() {
        SimulationProgressHolder.SimulationSessionState s = sesion(CollapseEndCondition.NONE);

        SimulationDayReport report = new SimulationDayReport();
        report.setSlaPercent(0.0); // peor caso

        Map<String, Aeropuerto> airportMap = new HashMap<>();
        airportMap.put("SKBO", aeropuerto("SKBO", 100));
        SimulationState state = stateConCarga(Map.of("SKBO", 100), airportMap);

        CollapseHelper.CollapseCheckResult r = collapseHelper.checkEndCondition(
                s, report, state, airportMap);

        assertThat(r.terminated()).isFalse();
        assertThat(s.getSlaStreak()).isEqualTo(0); // NONE no toca el streak
    }

    // ── Estado por defecto ──────────────────────────────────────────

    @Test
    void sesion_nueva_tiene_end_condition_none_y_streak_cero() {
        SimulationProgressHolder.SimulationSessionState s =
                new SimulationProgressHolder.SimulationSessionState();

        assertThat(s.getEndCondition()).isEqualTo(CollapseEndCondition.NONE);
        assertThat(s.getSlaStreak()).isZero();
        assertThat(s.getCollapseDayIndex()).isNull();
        assertThat(s.getCollapseReason()).isNull();
    }
}
