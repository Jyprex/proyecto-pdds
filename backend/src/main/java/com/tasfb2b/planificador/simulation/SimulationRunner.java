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
 * <p>Soporta dos modos de operación:
 * <ul>
 *   <li>{@link #run}: one-shot completo (para HGA/ALNS fitness evaluation)</li>
 *   <li>{@link #advanceTo}: incremental (para micro-batching en SimulationService)</li>
 * </ul>
 */
@Component
@RequiredArgsConstructor
public class SimulationRunner {

    private final EventEngine engine;
    private final BloqueoService bloqueoService;

    /**
     * Simulación one-shot: crea un estado nuevo, genera todos los eventos
     * y los aplica secuencialmente. Usado para evaluación de fitness en HGA/ALNS.
     *
     * <p>Nota: el colapso YA NO aborta la simulación (colapso informativo).
     * Todos los eventos se procesan hasta el final para obtener métricas completas.
     */
    public SimulationState run(List<Route> routes,
                               Map<String, Aeropuerto> airports,
                               long startTime,
                               long dayStartEpochMs) {

        List<Vuelo> vuelos = routes.stream()
                .flatMap(r -> r.getFlights().stream())
                .distinct()
                .toList();

        SimulationState state =
                new SimulationState(
                        new ArrayList<>(airports.values()),
                        vuelos,
                        startTime,
                        bloqueoService
                );

        long t0 = System.nanoTime();
        List<Event> events = engine.buildEvents(routes, dayStartEpochMs);
        long buildNanos = System.nanoTime() - t0;
        state.setBuildEventsTimeNanos(buildNanos);

        long t1 = System.nanoTime();
        int applied = 0;
        for (Event e : events) {
            state.apply(e, airports);
            applied++;
        }
        long applyNanos = System.nanoTime() - t1;
        state.setApplyEventsTimeNanos(applyNanos);
        state.setEventCounts(events.size(), applied);

        return state;
    }

    /**
     * Simulación incremental: avanza un estado EXISTENTE hasta {@code untilTime},
     * registrando los vuelos de las rutas nuevas y aplicando solo eventos
     * dentro de la ventana temporal {@code [state.currentTime, untilTime)}.
     *
     * <p>Usado por el micro-batching de SimulationService para avanzar
     * ciclo a ciclo sin reconstruir el estado completo.
     *
     * @param state      estado mutable existente (persistente entre ciclos)
     * @param allRoutes  TODAS las rutas conocidas hasta ahora (master solution)
     * @param airports   mapa de aeropuertos
     * @param dayStart   epoch del inicio del día actual (para EventEngine)
     * @param untilTime  epoch hasta dónde avanzar
     */
    public void advanceTo(SimulationState state,
                          List<Route> allRoutes,
                          Map<String, Aeropuerto> airports,
                          long dayStart,
                          long untilTime) {

        // Registrar vuelos de rutas nuevas (si los hay)
        for (Route r : allRoutes) {
            if (r.getFlights() != null) {
                state.registerFlights(r.getFlights());
            }
        }

        long t0 = System.nanoTime();
        List<Event> events = engine.buildEvents(allRoutes, dayStart);
        long buildNanos = System.nanoTime() - t0;
        state.setBuildEventsTimeNanos(buildNanos);

        long t1 = System.nanoTime();
        int total = events.size();
        int applied = 0;

        for (Event e : events) {
            // Solo aplicar eventos que están DENTRO de la ventana temporal
            if (e.getTime() < state.getCurrentTime()) continue;
            if (e.getTime() >= untilTime) break;

            state.apply(e, airports);
            applied++;
        }

        long applyNanos = System.nanoTime() - t1;
        state.setApplyEventsTimeNanos(applyNanos);
        state.setEventCounts(total, applied);
        state.setCurrentTime(untilTime);
    }
}
