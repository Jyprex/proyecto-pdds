package com.tasfb2b.planificador.simulation;

import com.tasfb2b.planificador.domain.Event;
import com.tasfb2b.planificador.domain.EventType;
import com.tasfb2b.planificador.domain.Route;
import com.tasfb2b.vuelo.domain.Vuelo;
import org.springframework.stereotype.Component;

import java.util.*;

/**
 * Motor de eventos separado del SimulationRunner.
 *
 * <p>Genera la secuencia cronológica completa de eventos para un conjunto
 * de rutas dentro de un período simulado. Incluye:
 * <ul>
 *   <li>{@code LOT_ARRIVAL} — llegada del lote al aeropuerto de origen</li>
 *   <li>{@code FLIGHT_DEPARTURE} — despegue con carga</li>
 *   <li>{@code FLIGHT_ARRIVAL} — aterrizaje en cada escala/destino</li>
 *   <li>{@code STORAGE_RELEASE} — liberación del almacén tras 24h de permanencia</li>
 *   <li>{@code BAGGAGE_PICKUP} — el cliente recoge sus maletas</li>
 * </ul>
 */
@Component
public class EventEngine {

    public List<Event> buildEvents(List<Route> routes, long dayStartEpochMs) {

        List<Event> events = new ArrayList<>();

        for (Route r : routes) {

            List<Vuelo> flights = r.getFlights();

            // Rutas sin vuelos asignados no generan eventos de movimiento
            if (flights == null || flights.isEmpty()) continue;

            int load = r.getCapacidadAsignada();

            // ── LLEGADA DEL LOTE AL ORIGEN ──
            events.add(new Event(
                    r.getLot().getReadyTime(),
                    EventType.LOT_ARRIVAL,
                    r.getLot(),
                    flights.get(0), // vuelo de referencia para ICAO destino, origen
                    load
            ));

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

            // ── PERMANENCIA (24h) ──────────────────────────────────────────────
            // Regla de Permanencia: El paquete se queda ocupando espacio
            // en el almacén de destino por exactamente 24 horas tras su llegada,
            // momento en el cual se libera y ya no figura en el almacén.
            if (load > 0 && r.getArrivalTime() > 0) {

                long arrivalTime = r.getArrivalTime();
                Vuelo lastFlight = flights.get(flights.size() - 1);

                long localReleaseTime = computeLocalReleaseTime(
                        arrivalTime,
                        lastFlight.getDestino().getGmtOffset()
                );

                events.add(new Event(
                        localReleaseTime,
                        EventType.STORAGE_RELEASE,
                        r.getLot(),
                        lastFlight,
                        load
                ));
            }
        }

        events.sort(Comparator.comparingLong(Event::getTime));
        return events;
    }

    private long computeLocalReleaseTime(long arrivalEpochMs, int gmtOffsetHours) {
        long offsetMs = gmtOffsetHours * 60L * 60 * 1000;
        long localArrival = arrivalEpochMs + offsetMs;
        long localRelease = localArrival + 24L * 60 * 60 * 1000;
        return localRelease - offsetMs;
    }
}
