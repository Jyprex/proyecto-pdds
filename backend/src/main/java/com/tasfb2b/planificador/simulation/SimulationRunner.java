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

        List<Event> events = engine.buildEvents(routes, dayStartEpochMs);
        events.sort((a, b) -> Long.compare(a.getTime(), b.getTime()));

        for (Event e : events) {
            state.apply(e, airports);
        }

        return state;
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

        List<Event> events = engine.buildEvents(routes, dayStartEpochMs);
        events.sort((a, b) -> Long.compare(a.getTime(), b.getTime()));

        for (Event e : events) {
            if (e.getTime() > endTime) break;
            state.apply(e, airports);
        }

        return state;
    }
}
