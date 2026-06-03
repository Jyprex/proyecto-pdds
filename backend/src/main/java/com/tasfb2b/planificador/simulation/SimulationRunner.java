package com.tasfb2b.planificador.simulation;

import com.tasfb2b.aeropuerto.domain.Aeropuerto;
import com.tasfb2b.planificador.domain.Event;
import com.tasfb2b.planificador.domain.Route;
import com.tasfb2b.vuelo.domain.Vuelo;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Component
@RequiredArgsConstructor
public class SimulationRunner {

    private final EventEngine engine;

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
                        startTime
                );

        long t0 = System.nanoTime();
        List<Event> events = engine.buildEvents(routes, dayStartEpochMs);
        long t1 = System.nanoTime();
        events.sort((a, b) -> Long.compare(a.getTime(), b.getTime()));
        long t2 = System.nanoTime();

        for (Event e : events) {
            state.apply(e, airports);
        }
        long t3 = System.nanoTime();
        
        state.setEventCounts(events.size(), events.size());
        state.setBuildEventsTimeNanos(t1 - t0 + (t2 - t1)); // Incluye ordenamiento
        state.setApplyEventsTimeNanos(t3 - t2);

        return state;
    }

    /**
     * Avanza el estado de la simulación de forma incremental.
     * En lugar de reconstruir desde cero, aplica eventos que caen en la nueva ventana de tiempo.
     */
    public void advanceTo(SimulationState state,
                          List<Route> routes,
                          Map<String, Aeropuerto> airports,
                          long dayStartEpochMs,
                          long endTime) {

        // Registrar nuevos vuelos descubiertos en las rutas (para track de capacidad)
        List<Vuelo> vuelos = routes.stream()
                .flatMap(r -> r.getFlights().stream())
                .distinct()
                .toList();
        state.registerFlights(vuelos);

        long t0 = System.nanoTime();
        List<Event> events = engine.buildEvents(routes, dayStartEpochMs);
        long t1 = System.nanoTime();
        events.sort((a, b) -> Long.compare(a.getTime(), b.getTime()));
        long t2 = System.nanoTime();

        long lastProcessedTime = state.getCurrentTime();
        int applied = 0;
        for (Event e : events) {
            // Aplicar solo eventos que ocurren DESPUÉS del último tiempo procesado
            // y HASTA el tiempo final solicitado.
            if (e.getTime() > lastProcessedTime && e.getTime() <= endTime) {
                state.apply(e, airports);
                applied++;
            }
        }
        long t3 = System.nanoTime();

        // Si no hubo eventos, avanzar el reloj manualmente para mantener sincronía
        if (state.getCurrentTime() < endTime) {
            state.setCurrentTime(endTime);
        }

        state.setEventCounts(events.size(), applied);
        state.setBuildEventsTimeNanos(t1 - t0 + (t2 - t1));
        state.setApplyEventsTimeNanos(t3 - t2);
    }

    public SimulationState runUntil(List<Route> routes,
                                    Map<String, Aeropuerto> airports,
                                    long startTime,
                                    long dayStartEpochMs,
                                    long endTime) {

        List<Vuelo> vuelos = routes.stream()
                .flatMap(r -> r.getFlights().stream())
                .distinct()
                .toList();

        SimulationState state =
                new SimulationState(
                        new ArrayList<>(airports.values()),
                        vuelos,
                        startTime
                );

        long t0 = System.nanoTime();
        List<Event> events = engine.buildEvents(routes, dayStartEpochMs);
        long t1 = System.nanoTime();
        events.sort((a, b) -> Long.compare(a.getTime(), b.getTime()));
        long t2 = System.nanoTime();

        int applied = 0;
        for (Event e : events) {
            if (e.getTime() > endTime) break;
            state.apply(e, airports);
            applied++;
        }
        long t3 = System.nanoTime();
        
        state.setEventCounts(events.size(), applied);
        state.setBuildEventsTimeNanos(t1 - t0 + (t2 - t1));
        state.setApplyEventsTimeNanos(t3 - t2);

        return state;
    }
}
