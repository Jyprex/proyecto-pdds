package com.tasfb2b.planificador.simulation;

import com.tasfb2b.planificador.domain.Event;
import com.tasfb2b.planificador.domain.EventType;
import com.tasfb2b.planificador.domain.Route;
import com.tasfb2b.vuelo.domain.Vuelo;
import org.springframework.stereotype.Component;

import java.util.*;

@Component
public class EventEngine {

    public List<Event> buildEvents(List<Route> routes, long startTime) {

        List<Event> events = new ArrayList<>();

        for (Route r : routes) {

            long t = r.getLot().getReadyTime();

            for (Vuelo v : r.getFlights()) {

                int load = r.getCapacidadAsignada();

                // salida
                events.add(new Event(
                        v.getDepartureEpoch(startTime),
                        EventType.FLIGHT_DEPARTURE,
                        r.getLot(),
                        v,
                        load
                ));

                // llegada
                events.add(new Event(
                        v.getArrivalEpoch(startTime),
                        EventType.FLIGHT_ARRIVAL,
                        r.getLot(),
                        v,
                        load
                ));
            }
        }

        events.sort(Comparator.comparingLong(Event::getTime));

        return events;
    }
}
