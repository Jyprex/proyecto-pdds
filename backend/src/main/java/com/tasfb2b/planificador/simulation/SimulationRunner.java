package com.tasfb2b.planificador.simulation;

import com.tasfb2b.aeropuerto.domain.Aeropuerto;
import com.tasfb2b.planificador.domain.Event;
import com.tasfb2b.planificador.domain.Route;
import com.tasfb2b.vuelo.domain.Vuelo;
import com.tasfb2b.bloqueo.service.BloqueoService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Ejecuta la simulación basada en eventos sobre un conjunto de rutas.
 *
 * <p>Usado EXCLUSIVAMENTE por {@link com.tasfb2b.planificador.service.ALNSPlannerService}
 * para evaluar el fitness de cada candidato durante el ALNS ({@code run}, "one-shot").
 * Es crítico para el buen funcionamiento del algoritmo — cada iteración de ALNS lo
 * invoca para simular una solución candidata y medir su calidad real.
 *
 * <p>{@code advanceTo} queda SIN USO ACTIVO desde la migración a la arquitectura de
 * doble búfer por bloques: {@code SimulationService.computeBlock()} hace su propio
 * avance incremental de eventos inline, sin pasar por este método. Se conserva por si
 * se necesita reutilizar el mecanismo de avance incremental en el futuro.
 */
@Component
@RequiredArgsConstructor
public class SimulationRunner {

    private final EventEngine engine;
    private final BloqueoService bloqueoService;

    /**
     * Simulación one-shot: crea un estado nuevo, genera todos los eventos
     * y los aplica secuencialmente. Usado para evaluación de fitness en ALNS.
     *
     * <p>Con la nueva SimulationState (colapso duro e inmediato), si una solución
     * candidata viola capacidad de vuelo/almacén, el estado queda "congelado" en
     * ese instante (apply() ignora eventos posteriores) — el fitness evaluator
     * penaliza esto naturalmente vía isColapsado()/getCurrentTime().
     */
    public SimulationState run(List<Route> routes,
                               Map<String, Aeropuerto> airports,
                               long startTime,
                               long dayStartEpochMs) {

        List<Vuelo> vuelos = routes.stream()
                .flatMap(r -> r.getFlights().stream())
                .distinct()
                .toList();

        SimulationState state = new SimulationState(
                new ArrayList<>(airports.values()), vuelos, startTime, bloqueoService);

        List<Event> events = engine.buildEvents(routes, dayStartEpochMs);
        for (Event e : events) {
            state.apply(e, airports);
        }

        return state;
    }

    /**
     * Simulación incremental: avanza un estado EXISTENTE hasta {@code untilTime}.
     * NO USADO ACTUALMENTE por el flujo principal (ver nota de clase) — se mantiene
     * compilable y funcional por si se retoma en el futuro.
     */
    public void advanceTo(SimulationState state,
                          List<Route> allRoutes,
                          Map<String, Aeropuerto> airports,
                          long dayStart,
                          long untilTime) {

        for (Route r : allRoutes) {
            if (r.getFlights() != null) {
                state.registerFlights(r.getFlights());
            }
        }

        List<Event> events = engine.buildEvents(allRoutes, dayStart);

        for (Event e : events) {
            if (e.getTime() < state.getCurrentTime()) continue;
            if (e.getTime() >= untilTime) break;
            state.apply(e, airports);
        }

        state.setCurrentTime(untilTime);
    }
}