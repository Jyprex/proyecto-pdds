package com.tasfb2b.planificador.alns.operator;

import com.tasfb2b.planificador.domain.Route;
import com.tasfb2b.superlote.domain.SuperLot;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Random;
import java.util.Set;

/**
 * Operador de destrucción: elige un lote pivote y elimina los q lotes más
 * "relacionados" (mismo origen o destino). Sirve para diversificar la búsqueda
 * rompiendo clusters de rutas similares.
 */
public class RelatedDestroyOp implements DestroyOperator {

    @Override
    public List<SuperLot> destroy(List<Route> routes, int q, Random rng) {
        if (routes.isEmpty()) return List.of();

        // Elegir pivote aleatorio
        Route pivot = routes.get(rng.nextInt(routes.size()));
        String origenPivot  = pivot.getLot().getOrigenIcao();
        String destinoPivot = pivot.getLot().getDestinoIcao();
        long   slaPivot     = pivot.getLot().getSla();

        // Ordenar por grado de relación descendente (más relacionado primero)
        List<Route> sorted = new ArrayList<>(routes);
        sorted.sort((a, b) -> {
            int scoreA = relacionScore(a.getLot(), origenPivot, destinoPivot, slaPivot);
            int scoreB = relacionScore(b.getLot(), origenPivot, destinoPivot, slaPivot);
            return Integer.compare(scoreB, scoreA);
        });

        int toRemove = Math.min(q, sorted.size());
        List<SuperLot> removed = new ArrayList<>(toRemove);

        // Recolectar IDs de lotes a remover en un HashSet para lookup O(1)
        Set<Integer> lotIdsToRemove = new HashSet<>(toRemove * 2);
        for (int i = 0; i < toRemove; i++) {
            Route r = sorted.get(i);
            removed.add(r.getLot());
            lotIdsToRemove.add(r.getLot().getId());
        }

        // Single-pass removal — O(N) en lugar de O(N²)
        routes.removeIf(r -> lotIdsToRemove.contains(r.getLot().getId()));

        return removed;
    }

    private int relacionScore(SuperLot lot,
                               String origenPivot,
                               String destinoPivot,
                               long   slaPivot) {
        int score = 0;
        if (lot.getOrigenIcao().equals(origenPivot))   score += 2;
        if (lot.getDestinoIcao().equals(destinoPivot)) score += 2;
        // bonus si el SLA es cercano (±12h en ms)
        if (Math.abs(lot.getSla() - slaPivot) < 12L * 3_600_000) score += 1;
        return score;
    }

    @Override
    public String name() {
        return "RelatedDestroy";
    }
}
