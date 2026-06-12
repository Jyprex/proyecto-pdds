package com.tasfb2b.planificador.alns.operator;

import com.tasfb2b.planificador.domain.Route;
import com.tasfb2b.superlote.domain.SuperLot;

import java.util.*;

/**
 * Operador de destrucción: elimina los q lotes con mayor delay o sin ruta asignada.
 * Útil para mejorar soluciones con muchos SLA incumplidos.
 *
 * <p>Optimizado: O(N log N) sort + O(N) removeIf (antes era O(N²) por remove(0) repetido).
 */
public class WorstDestroyOp implements DestroyOperator {

    @Override
    public List<SuperLot> destroy(List<Route> routes, int q, Random rng, long currentSimTime) {
        if (routes.isEmpty()) return List.of();

        // Filtrar rutas que pueden ser destruidas (no han empezado su primer tramo)
        List<Route> candidates = routes.stream()
                .filter(r -> r.getFlights().isEmpty() || r.getDepartureTime() > currentSimTime)
                .collect(java.util.stream.Collectors.toList());

        if (candidates.isEmpty()) return List.of();

        // Ordenar candidatos: primero los noAtendidos, luego por delayHoras descendente
        candidates.sort(Comparator
                .comparing(Route::isNoAtendido).reversed()
                .thenComparingDouble(Route::getDelayHoras).reversed());

        int toRemove = Math.min(q, candidates.size());
        List<SuperLot> removed = new ArrayList<>(toRemove);
        Set<Integer> lotIdsToRemove = new HashSet<>(toRemove * 2);

        for (int i = 0; i < toRemove; i++) {
            removed.add(candidates.get(i).getLot());
            lotIdsToRemove.add(candidates.get(i).getLot().getId());
        }

        // Single-pass removal — O(N)
        routes.removeIf(r -> lotIdsToRemove.contains(r.getLot().getId()));

        return removed;
    }

    @Override
    public String name() {
        return "WorstDestroy";
    }
}
