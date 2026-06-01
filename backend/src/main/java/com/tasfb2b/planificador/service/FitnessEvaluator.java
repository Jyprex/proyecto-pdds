package com.tasfb2b.planificador.service;

import com.tasfb2b.planificador.domain.Route;
import com.tasfb2b.planificador.simulation.SimulationState;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Evaluador de fitness para soluciones del planificador.
 *
 * <p>Fórmula de penalización por capacidad (documento Selección de Algoritmos v2.0):
 * <pre>Penalización_cap = P_CAP × E_cap</pre>
 * donde E_cap = maletas no atendidas (excesoCapacidad).
 * Esto incentiva subir la mayor cantidad posible de carga,
 * no solo el mínimo para activar el flag "atendido".
 *
 * <p>Penalizaciones adicionales para estrés extremo:
 * <ul>
 *   <li>CARRY-OVER temporal: penalización exponencial por proximidad al SLA deadline.</li>
 *   <li>COLA DE ESPERA: penalización por maletas bloqueadas en colas de aeropuerto.</li>
 * </ul>
 */
@Component
public class FitnessEvaluator {

    /**
     * Coeficiente de penalización proporcional por maleta no atendida.
     * Valor calibrado para que 21.000 maletas sin ruta (~-105 pts)
     * supere ampliamente la ganancia de "atendido" (+10 pts).
     */
    private static final double P_CAP = 0.005;

    /** Peso de penalización por arrastre temporal (carry-over). */
    private static final double W_CARRY = 15.0;

    /** Peso de penalización por maletas en cola de espera. */
    private static final double W_QUEUE = 8.0;

    /** Penalización severa (pero finita) por ruta tardía. */
    private static final double LATE_PENALTY = 500.0;

    public double evaluateRoutes(List<Route> routes, long currentTime) {
        double score = 0;
        int atendidos = 0;

        for (Route r : routes) {

            if (r.isTarde()) {
                score -= LATE_PENALTY;
                score -= r.getDelayHoras() * 10;
                continue;
            }

            if (r.isAtendido()) {
                score += 10;
                atendidos++;
            }

            int exceso = r.getExcesoCapacidad();
            if (exceso > 0) {
                score -= P_CAP * exceso;
            }

            score -= r.getDelayHoras() * 2;

            if (r.isAtendido() && r.getLot().getSla() > 0) {
                long deadline = r.getLot().getDeadline();
                long sla = r.getLot().getSla();
                long timeRemaining = deadline - currentTime;

                if (timeRemaining < sla) {
                    double ratio = Math.max(0.0, 1.0 - (double) timeRemaining / sla);
                    score -= W_CARRY * ratio * ratio;
                }
            }
        }

        score += routes.isEmpty() ? 0 : (atendidos / (double) routes.size()) * 5;
        return score;
    }

    public double evaluateState(SimulationState state) {
        double score = 0;
        score -= state.getSaturacionAeropuerto() * 12;
        score -= W_QUEUE * state.getMaletasEnCola();
        return score;
    }

    public double evaluate(List<Route> routes,
                           SimulationState state) {
        return evaluateRoutes(routes, state.getCurrentTime()) + evaluateState(state);
    }
}
