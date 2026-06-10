package com.tasfb2b.planificador.simulation;

import com.tasfb2b.planificador.domain.Event;
import com.tasfb2b.planificador.domain.EventType;
import com.tasfb2b.planificador.domain.Route;
import com.tasfb2b.vuelo.domain.Vuelo;
import com.tasfb2b.bloqueo.service.BloqueoService;
import org.springframework.stereotype.Component;

import java.time.Instant;
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
 * </ul>
 */
@Component
public class EventEngine {

    private final BloqueoService bloqueoService;

    public EventEngine(BloqueoService bloqueoService) {
        this.bloqueoService = bloqueoService;
    }

    /**
     * Construye todos los eventos de simulación para las rutas dadas.
     *
     * @param routes           rutas planificadas con vuelos asignados
     * @param dayStartEpochMs  epoch del inicio del período (para referencia temporal)
     * @return lista de eventos ordenada cronológicamente
     */
    public List<Event> buildEvents(List<Route> routes, long dayStartEpochMs) {

        List<Event> events = new ArrayList<>();

        for (Route r : routes) {

            List<Vuelo> flights = r.getFlights();
            if (flights == null || flights.isEmpty()) continue;

            int load = r.getCapacidadAsignada();

            // Llegada del lote al aeropuerto de origen
            events.add(new Event(
                    r.getLot().getReadyTime(),
                    EventType.LOT_ARRIVAL,
                    r.getLot(),
                    flights.get(0),
                    load
            ));

            // Secuencia de vuelos: departure → arrival por cada tramo
            long sequenceTime = r.getLot().getReadyTime();

            for (Vuelo v : flights) {
                long depTime = v.calcularSiguienteSalida(sequenceTime);
                events.add(new Event(depTime, EventType.FLIGHT_DEPARTURE, r.getLot(), v, load));

                long duration = v.getDuracionMs();
                // B09: Avería Tipo 3 - Demora de tránsito (duplica el tiempo de tránsito)
                if (bloqueoService != null && bloqueoService.tieneDemoraTransito(
                        v.getOrigen().getIcaoCode(),
                        v.getDestino().getIcaoCode(),
                        Instant.ofEpochMilli(depTime))) {
                    duration *= 2;
                }

                long arrTime = depTime + duration;
                events.add(new Event(arrTime, EventType.FLIGHT_ARRIVAL, r.getLot(), v, load));

                sequenceTime = arrTime;
            }

            // Permanencia 24h: el paquete ocupa almacén de destino por 24h tras su llegada
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

    /**
     * Calcula el momento UTC en que se libera el almacén tras 24h de permanencia local.
     */
    private long computeLocalReleaseTime(long arrivalEpochMs, int gmtOffsetHours) {
        long offsetMs = gmtOffsetHours * 60L * 60 * 1000;
        long localArrival = arrivalEpochMs + offsetMs;
        long localRelease = localArrival + 24L * 60 * 60 * 1000;
        return localRelease - offsetMs;
    }
}
