package com.tasfb2b.planificador.alns;

import com.tasfb2b.planificador.alns.operator.DestroyOperator;
import com.tasfb2b.planificador.alns.operator.RepairOperator;

import java.util.List;
import java.util.Random;

/**
 * Gestiona los pesos adaptativos de los operadores del ALNS.
 *
 * <p>Cada operador tiene un peso w_i que refleja su rendimiento histórico.
 * La selección se hace por ruleta (roulette wheel) proporcional a w_i.
 * Al final de cada segmento de iteraciones, los pesos se actualizan con:
 * <pre>w_i = (1 - DECAY) * w_i + DECAY * (σ_i / n_i)</pre>
 * donde σ_i = puntaje acumulado y n_i = veces seleccionado en el segmento.
 *
 * <p>Esquema de recompensas:
 * <ul>
 *   <li>GLOBAL_BEST = 10  (nueva mejor solución global)</li>
 *   <li>IMPROVE = 5       (mejora respecto a la solución actual)</li>
 *   <li>ACCEPT = 1        (aceptada por Simulated Annealing sin mejorar)</li>
 *   <li>REJECT = 0        (rechazada)</li>
 * </ul>
 */
public class AdaptiveWeightTracker {

    // ── Recompensas ──────────────────────────────────────────────
    public static final double REWARD_GLOBAL_BEST = 10.0;
    public static final double REWARD_IMPROVE     =  5.0;
    public static final double REWARD_ACCEPT      =  1.0;
    public static final double REWARD_REJECT      =  0.0;

    /** Factor de decaimiento para la actualización de pesos. */
    private static final double DECAY = 0.1;

    /** Umbral de saturación para activar modo estrés. */
    private static final double SATURATION_THRESHOLD = 0.90;

    /** Multiplicador para GreedyRepair bajo estrés extremo. */
    private static final double GREEDY_BOOST = 3.0;

    /** Multiplicador para RegretRepair bajo estrés extremo. */
    private static final double REGRET_DAMPEN = 0.5;

    // ── Estado de operadores ──────────────────────────────────────
    private final List<DestroyOperator> destroyOps;
    private final List<RepairOperator>  repairOps;

    private final double[] wDestroy;
    private final double[] wRepair;

    private final double[] sigmaDestroy; // puntaje acumulado en el segmento
    private final double[] sigmaRepair;
    private final int[]    nDestroy;     // veces seleccionado en el segmento
    private final int[]    nRepair;

    private int lastDestroyIdx = -1;
    private int lastRepairIdx  = -1;

    /**
     * Nivel de saturación actual de la red (0.0 – 1.0).
     * Seteado externamente por ALNSPlannerService cada ciclo.
     * Cuando supera SATURATION_THRESHOLD, el selector de operadores
     * favorece GreedyRepair sobre RegretRepair para ahorrar CPU.
     */
    private double saturationLevel = 0.0;

    public AdaptiveWeightTracker(List<DestroyOperator> destroyOps,
                                 List<RepairOperator> repairOps) {
        this.destroyOps = destroyOps;
        this.repairOps  = repairOps;

        wDestroy     = initWeights(destroyOps.size());
        wRepair      = initWeights(repairOps.size());
        sigmaDestroy = new double[destroyOps.size()];
        sigmaRepair  = new double[repairOps.size()];
        nDestroy     = new int[destroyOps.size()];
        nRepair      = new int[repairOps.size()];
    }

    private double[] initWeights(int size) {
        double[] w = new double[size];
        for (int i = 0; i < size; i++) w[i] = 1.0;
        return w;
    }

    /**
     * Establece el nivel de saturación actual de la red.
     * @param level valor entre 0.0 (red vacía) y 1.0 (100% saturada)
     */
    public void setSaturationLevel(double level) {
        this.saturationLevel = Math.max(0.0, Math.min(1.0, level));
    }

    // ── Selección por ruleta ──────────────────────────────────────

    public DestroyOperator selectDestroy(Random rng) {
        lastDestroyIdx = rouletteWheel(wDestroy, rng);
        nDestroy[lastDestroyIdx]++;
        return destroyOps.get(lastDestroyIdx);
    }

    /** Fuerza la selección de un operador concreto (usado en la primera iteración de replanificación). */
    public void forceDestroy(int idx) {
        lastDestroyIdx = idx;
        nDestroy[idx]++;
    }

    /**
     * Selecciona operador de reparación por ruleta.
     * Bajo saturación >90%, boostea GreedyRepair y dampea RegretRepair
     * para ahorrar CPU (Greedy es ~2× más rápido).
     */
    public RepairOperator selectRepair(Random rng) {
        double[] adjustedWeights;

        if (saturationLevel > SATURATION_THRESHOLD) {
            // Modo estrés: ajustar pesos para favorecer operadores rápidos
            adjustedWeights = new double[wRepair.length];
            for (int i = 0; i < wRepair.length; i++) {
                String opName = repairOps.get(i).name();
                if (opName.contains("Greedy")) {
                    adjustedWeights[i] = wRepair[i] * GREEDY_BOOST;
                } else if (opName.contains("Regret")) {
                    adjustedWeights[i] = wRepair[i] * REGRET_DAMPEN;
                } else {
                    adjustedWeights[i] = wRepair[i];
                }
            }
        } else {
            adjustedWeights = wRepair;
        }

        lastRepairIdx = rouletteWheel(adjustedWeights, rng);
        nRepair[lastRepairIdx]++;
        return repairOps.get(lastRepairIdx);
    }

    /**
     * Acumula la recompensa para los operadores usados en la última iteración.
     * Usar las constantes REWARD_* como parámetro.
     */
    public void update(double reward) {
        if (lastDestroyIdx >= 0) sigmaDestroy[lastDestroyIdx] += reward;
        if (lastRepairIdx  >= 0) sigmaRepair[lastRepairIdx]   += reward;
    }

    /**
     * Actualiza los pesos al final de cada segmento y resetea contadores.
     * Llamar cada SEGMENT_SIZE iteraciones.
     */
    public void normalizeWeights() {
        for (int i = 0; i < wDestroy.length; i++) {
            if (nDestroy[i] > 0) {
                wDestroy[i] = (1 - DECAY) * wDestroy[i]
                        + DECAY * (sigmaDestroy[i] / nDestroy[i]);
            }
            sigmaDestroy[i] = 0;
            nDestroy[i]     = 0;
        }
        for (int i = 0; i < wRepair.length; i++) {
            if (nRepair[i] > 0) {
                wRepair[i] = (1 - DECAY) * wRepair[i]
                        + DECAY * (sigmaRepair[i] / nRepair[i]);
            }
            sigmaRepair[i] = 0;
            nRepair[i]     = 0;
        }
    }

    // ── Utilidades ────────────────────────────────────────────────

    private int rouletteWheel(double[] weights, Random rng) {
        double total = 0;
        for (double w : weights) total += w;

        double rand = rng.nextDouble() * total;
        double cumul = 0;
        for (int i = 0; i < weights.length; i++) {
            cumul += weights[i];
            if (rand <= cumul) return i;
        }
        return weights.length - 1; // fallback por precisión flotante
    }

    /** Retorna las estadísticas actuales para logging/diagnóstico. */
    public String statsDestroy() {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < destroyOps.size(); i++) {
            sb.append(destroyOps.get(i).name())
              .append("=").append(String.format("%.2f", wDestroy[i]));
            if (i < destroyOps.size() - 1) sb.append(", ");
        }
        return sb.append("]").toString();
    }

    public String statsRepair() {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < repairOps.size(); i++) {
            sb.append(repairOps.get(i).name())
              .append("=").append(String.format("%.2f", wRepair[i]));
            if (i < repairOps.size() - 1) sb.append(", ");
        }
        return sb.append("]").toString();
    }
}
