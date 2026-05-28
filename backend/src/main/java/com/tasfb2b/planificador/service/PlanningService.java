package com.tasfb2b.planificador.service;

import com.tasfb2b.planificador.domain.Solution;
import com.tasfb2b.superlote.service.SuperLotService;
import com.tasfb2b.vuelo.service.VueloService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Fachada de planificación que expone ALNS.
 * Los controllers dependen de esta clase, no de los planners directamente.
 */
@Service
@RequiredArgsConstructor
public class PlanningService {

    private final SuperLotService        superLotService;
    private final VueloService           vueloService;

    private final ALNSPlannerService     alnsPlanner;
    private final PlanningSessionHolder  sessionHolder;

    /**
     * Ejecuta la planificación inicial con ALNS.
     * Guarda el resultado en {@link PlanningSessionHolder}.
     */
    public Solution ejecutarALNS(long windowMs) {
        var lots = superLotService.agruparEnvios();
        Solution sol = alnsPlanner.plan(lots, windowMs);
        sessionHolder.store(sol);
        return sol;
    }

    /**
     * Replanifica las rutas afectadas por la cancelación de un vuelo usando ALNS.
     * Requiere que haya una solución activa en {@link PlanningSessionHolder}.
     *
     * @param vueloId  ID del vuelo cancelado
     * @param windowMs tiempo máximo de ejecución ALNS
     * @return nueva solución con las rutas afectadas corregidas
     */
    public Solution replanificar(Long vueloId, long windowMs) {
        // 1. Cancelar el vuelo en BD e invalidar el grafo para que el ALNS no lo encuentre
        vueloService.cancelarVuelo(vueloId);

        // 2. Correr el ciclo de replanificación con ALNS
        return alnsPlanner.replanificar(vueloId, windowMs);
    }

    /** Retorna la solución activa actual, o null si no hay ninguna. */
    public Solution getSolucionActual() {
        return sessionHolder.get();
    }
}
