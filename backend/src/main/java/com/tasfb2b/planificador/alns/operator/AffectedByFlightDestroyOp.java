package com.tasfb2b.planificador.alns.operator;

import com.tasfb2b.planificador.domain.Route;
import com.tasfb2b.superlote.domain.SuperLot;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Random;

/**
 * Operador de destrucción: elimina todos los lotes cuya ruta contiene el vuelo cancelado.
 * Es el operador principal para el escenario de replanificación operativa.
 * En el ciclo ALNS general actúa como primer operador forzado en la iteración 0.
 */
public class AffectedByFlightDestroyOp implements DestroyOperator {

    private final Long vueloIdCancelado;

    public AffectedByFlightDestroyOp(Long vueloIdCancelado) {
        this.vueloIdCancelado = vueloIdCancelado;
    }

    @Override
    public List<SuperLot> destroy(List<Route> routes, int q, Random rng, long currentSimTime) {
        List<SuperLot> removed = new ArrayList<>();

        Iterator<Route> it = routes.iterator();
        while (it.hasNext()) {
            Route r = it.next();
            // Solo podemos destruir rutas que no han empezado su primer tramo
            if (!r.getFlights().isEmpty() && r.getDepartureTime() <= currentSimTime) {
                continue;
            }

            boolean afectado = r.getFlights().stream()
                    .anyMatch(v -> vueloIdCancelado.equals(v.getId()));
            if (afectado) {
                removed.add(r.getLot());
                it.remove();
            }
        }
        return removed;
    }

    @Override
    public String name() {
        return "AffectedByFlight(" + vueloIdCancelado + ")";
    }
}
