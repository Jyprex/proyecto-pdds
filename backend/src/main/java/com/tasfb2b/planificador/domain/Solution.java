package com.tasfb2b.planificador.domain;

import com.tasfb2b.planificador.domain.Route;
import lombok.Data;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Data
public class Solution {
    private String planId = java.util.UUID.randomUUID().toString();
    private List<Route> routes;
    private double fitness;        // SuperLots atendidos antes del colapso
    private int routeCount;
    private long collapseTime;     // tiempoFinal de plan - tiempo Inicial de plan
    private int routesValidas; //efectivas
    private int routesFallidas; //sin ruta o violaciones

    /** Rutas de respaldo precalculadas por HGA. Clave: lot.getId() */
    private Map<Integer, Route> backupRoutes = new HashMap<>();
    // ── VALIDACIÓN DE SOLUCIÓN ─────────────────────────

    public void validarSolucion() {

        if (routes == null) {
            throw new IllegalStateException("La solución no contiene rutas");
        }

        if (routes.isEmpty()) {
            throw new IllegalStateException("La solución no tiene rutas asignadas");
        }

        for (Route r : routes) {

            if (r == null) {
                throw new IllegalStateException("Ruta nula en la solución");
            }

            r.validarConsistencia();

            if (r.getArrivalTime() > 0 && r.getDeadline() > 0) {
                if (r.getArrivalTime() < r.getLot().getReadyTime()) {
                    throw new IllegalStateException("Ruta llega antes de que el lote exista");
                }
            }
        }
    }

    public boolean esColapsada() {
        return routes.stream().anyMatch(Route::isTarde);
    }

    public long getTiempoVidaSistema() {
        return collapseTime > 0 ? collapseTime : System.currentTimeMillis();
    }
}
