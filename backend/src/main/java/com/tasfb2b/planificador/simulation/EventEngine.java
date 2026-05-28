package com.tasfb2b.planificador.simulation;

import com.tasfb2b.planificador.domain.Event;
import com.tasfb2b.planificador.domain.EventType;
import com.tasfb2b.planificador.domain.Route;
import com.tasfb2b.vuelo.domain.Vuelo;
import org.springframework.stereotype.Component;

import java.util.*;

@Component
public class EventEngine {

    public List<Event> buildEvents(List<Route> routes, long dayStartEpochMs) {

        List<Event> events = new ArrayList<>();

        for (Route r : routes) {

            List<Vuelo> flights = r.getFlights();

            // Rutas sin vuelos asignados no generan eventos de movimiento
            if (flights == null || flights.isEmpty()) continue;

            int load = r.getCapacidadAsignada();

            for (Vuelo v : flights) {

                // salida — epoch anclado al día simulado actual
                events.add(new Event(
                        v.getDepartureEpoch(dayStartEpochMs),
                        EventType.FLIGHT_DEPARTURE,
                        r.getLot(),
                        v,
                        load
                ));

                // llegada — epoch anclado al día simulado actual (con cruce de medianoche)
                events.add(new Event(
                        v.getArrivalEpoch(dayStartEpochMs),
                        EventType.FLIGHT_ARRIVAL,
                        r.getLot(),
                        v,
                        load
                ));
            }

            // ── BAGGAGE_PICKUP ────────────────────────────────────────────────
            // Solo se genera si la ruta tiene maletas asignadas (no rutas vacías).
            // El cliente recoge en un instante aleatorio dentro de la ventana SLA:
            //   mínimo = arrivalTime del último vuelo (maletas ya en almacén)
            //   máximo = deadline del lote (límite contractual Tasf.B2B)
            // Semilla fija = lot.id → mismo resultado en cada ejecución (reproducibilidad
            // académica para experimentación numérica).
            if (load > 0 && r.getArrivalTime() > 0) {

                long arrivalTime = r.getArrivalTime();
                long deadline    = r.getLot().getDeadline();
                long ventana     = deadline - arrivalTime;

                long pickupTime;
                if (ventana > 0) {
                    // Distribución uniforme acotada al SLA, reproducible por lote
                    Random rnd = new Random(r.getLot().getId());
                    pickupTime = arrivalTime + (long)(rnd.nextDouble() * ventana);
                } else {
                    // Si arrivalTime >= deadline (llegó tarde), se libera en el deadline
                    pickupTime = deadline;
                }

                Vuelo lastFlight = flights.get(flights.size() - 1);

                events.add(new Event(
                        pickupTime,
                        EventType.BAGGAGE_PICKUP,
                        r.getLot(),
                        lastFlight,   // vuelo cuyo destino es el almacén que se libera
                        load
                ));
            }
            // ─────────────────────────────────────────────────────────────────
        }

        events.sort(Comparator.comparingLong(Event::getTime));

        return events;
    }
}
