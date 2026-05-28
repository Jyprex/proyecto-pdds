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

            // Aseguramos secuencialidad: el próximo vuelo no puede salir antes de que aterrice el anterior o de que el lote esté listo.
            long sequenceTime = r.getLot().getReadyTime();

            for (Vuelo v : flights) {

                // departure anclado a partir del sequenceTime
                long depTime = v.calcularSiguienteSalida(sequenceTime);
                events.add(new Event(
                        depTime,
                        EventType.FLIGHT_DEPARTURE,
                        r.getLot(),
                        v,
                        load
                ));

                // llegada del vuelo
                long arrTime = depTime + v.getDuracionMs();
                events.add(new Event(
                        arrTime,
                        EventType.FLIGHT_ARRIVAL,
                        r.getLot(),
                        v,
                        load
                ));
                
                // Actualizamos el sequenceTime para el siguiente tramo (si lo hay)
                sequenceTime = arrTime;
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
