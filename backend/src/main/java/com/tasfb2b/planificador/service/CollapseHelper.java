package com.tasfb2b.planificador.service;

import com.tasfb2b.aeropuerto.domain.Aeropuerto;
import com.tasfb2b.planificador.domain.CollapseEndCondition;
import com.tasfb2b.planificador.domain.Route;
import com.tasfb2b.planificador.domain.SimulationDayReport;
import com.tasfb2b.planificador.domain.Solution;
import com.tasfb2b.planificador.simulation.SimulationState;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;

/**
 * Delegado que encapsula toda la lógica de inyección de colapso
 * y verificación de condiciones de terminación.
 *
 * <p>Extraído de SimulationService para mantener la clase principal manejable.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class CollapseHelper {

    private final ALNSPlannerService alnsPlanner;

    @Qualifier("replanExecutor")
    private final Executor replanExecutor;

    /**
     * Ventana de ALNS para cada replan en modo colapso (ms).
     */
    private static final long REPLAN_WINDOW_MS = 500L;

    @Value("${tasf.sim.collapse.slaThreshold:30.0}")
    private double collapseSlaThreshold;

    @Value("${tasf.sim.collapse.consecutiveDays:2}")
    private int collapseConsecutiveDays;

    /**
     * Aplica inyecciones de cancelación del modo colapso con replanificación PARALELA.
     *
     * @param session   estado de la sesión (para stressFactor)
     * @param routes    rutas del ciclo actual
     * @param algorithm algoritmo en uso ("HGA"/"ALNS")
     * @return número de rutas rescatadas
     */

    //Dummies temporales
    @Deprecated
    public int applyCollapseInjections(
            SimulationProgressHolder.SimulationSessionState session,
            List<Route> routes,
            String algorithm) {
        return 0;
    }

    /**
     * Evalúa la condición de terminación del modo colapso al fin de un día simulado.
     */
    public record CollapseCheckResult(boolean terminated, String reason) {}

    public CollapseCheckResult checkEndCondition(
            SimulationProgressHolder.SimulationSessionState session,
            SimulationDayReport report,
            SimulationState endOfDayState,
            Map<String, Aeropuerto> airportMap,
            int slaViolationsCount) {

        // ── CONDICIÓN 1: Almacén excedido ──────────────────────────────────
        if (endOfDayState.isColapsado()) {
            return new CollapseCheckResult(true,
                    "ALMACEN_EXCEDIDO: Un almacén superó su capacidad física máxima.");
        }

        // ── CONDICIÓN 2: Avión sobrecargado ────────────────────────────────

        // ── CONDICIÓN 3: SLA incumplido ────────────────────────────────────
        // Cualquier maleta que no llegó a tiempo es violación de negocio.
        // report.getSlaPercent() < 100 significa que al menos 1 maleta no cumplió su ventana.
        if (slaViolationsCount > 0) {
            return new CollapseCheckResult(true, String.format(
                    "SLA_INCUMPLIDO: %d maleta(s) superaron su ventana de entrega " +
                            "(24h continental / 48h intercontinental) sin ser recogidas a tiempo.",
                    slaViolationsCount));
        }

        return new CollapseCheckResult(false, "NONE");
    }

    private void markCancelled(List<Route> rutasModificables,
                               int cancelCount,
                               Set<Long> rescuedVueloIds) {
        for (int i = 0; i < cancelCount && i < rutasModificables.size(); i++) {
            Route r = rutasModificables.get(i);
            if (!r.getFlights().isEmpty()
                    && rescuedVueloIds.contains(r.getFlights().get(0).getId())) {
                r.setStatus("rescued");
            } else {
                r.setStatus("cancelled");
                r.setCapacidadAsignada(0);
            }
        }
    }
}
