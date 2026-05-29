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
 */
@Component
public class FitnessEvaluator {

    /**
     * Coeficiente de penalización proporcional por maleta no atendida.
     * Valor calibrado para que 21.000 maletas sin ruta (~-105 pts)
     * supere ampliamente la ganancia de "atendido" (+10 pts).
     */
    private static final double P_CAP = 0.005;

    public double evaluate(List<Route> routes,
                           SimulationState state) {

        double score = 0;
        int atendidos = 0;

        for (Route r : routes) {

            // SLA duro: cualquier ruta tardía invalida la solución
            if (r.isTarde()) {
                return -Double.MAX_VALUE;
            }

            // Premio por lote con al menos una maleta asignada
            if (r.isAtendido()) {
                score += 10;
                atendidos++;
            }

            // Penalización proporcional por exceso de demanda no cubierta
            // Penalización = P_CAP × E_cap  (cubre tanto noAtendido total como parcial)
            int exceso = r.getExcesoCapacidad();
            if (exceso > 0) {
                score -= P_CAP * exceso;
            }

            // Penalización por tiempo de retraso (horas)
            score -= r.getDelayHoras() * 2;
        }

        // Penalización por saturación real de almacenes
        score -= state.getSaturacionAeropuerto() * 12;

        // Bonus de estabilidad: ratio de lotes con al menos una maleta asignada
        score += routes.isEmpty()
                ? 0
                : (atendidos / (double) routes.size()) * 5;

        return score;
    }
}
