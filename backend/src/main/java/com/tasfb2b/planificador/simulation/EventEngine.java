package com.tasfb2b.planificador.simulation;

import com.tasfb2b.planificador.domain.Event;
import com.tasfb2b.planificador.domain.EventType;
import com.tasfb2b.planificador.domain.Route;
import com.tasfb2b.vuelo.domain.Vuelo;
import com.tasfb2b.bloqueo.service.BloqueoService;
import org.springframework.stereotype.Component;
import com.tasfb2b.superlote.domain.SuperLot;

import java.time.Instant;
import java.util.*;

@Component
public class EventEngine {

    public static final long DEBUG_VUELO_ID = 178L;
    private static final long PICKUP_DELAY_MS = 10 * 60 * 1000L; // 10 min, fijo por requisito

    private final BloqueoService bloqueoService;

    public EventEngine(BloqueoService bloqueoService) {
        this.bloqueoService = bloqueoService;
    }

    /**
     * Construye eventos completos para fitness de ALNS/HGA (estados efímeros,
     * NUNCA tocan ShipmentTracker). No genera STORAGE_RELEASE; BAGGAGE_PICKUP
     * fijo a 10 min tras la llegada, igual que buildEventsForRoute.
     */
    public List<Event> buildEvents(List<Route> routes, long dayStartEpochMs) {

        List<Event> events = new ArrayList<>();

        for (Route r : routes) {

            List<Vuelo> flights = r.getFlights();
            if (flights == null || flights.isEmpty()) continue;

            int load = r.getCapacidadAsignada();
            List<String> bagIds = r.getBagIds() != null ? r.getBagIds() : List.of();

            events.add(new Event(
                    r.getLot().getReadyTime(), EventType.LOT_ARRIVAL,
                    r.getLot(), flights.get(0), load, bagIds, null, false
            ));

            long sequenceTime = r.getLot().getReadyTime();

            for (int i = 0; i < flights.size(); i++) {
                Vuelo v = flights.get(i);
                boolean esUltimoTramo = (i == flights.size() - 1);

                long depTime = v.calcularSiguienteSalida(sequenceTime);
                String instanceKey = v.getId() + "-" + depTime;

                events.add(new Event(depTime, EventType.FLIGHT_DEPARTURE, r.getLot(), v, load, bagIds, instanceKey, false));

                long duration = v.getDuracionMs();
                if (bloqueoService != null && bloqueoService.tieneDemoraTransito(
                        v.getOrigen().getIcaoCode(), v.getDestino().getIcaoCode(),
                        Instant.ofEpochMilli(depTime))) {
                    duration *= 2;
                }

                long arrTime = depTime + duration;
                events.add(new Event(arrTime, EventType.FLIGHT_ARRIVAL, r.getLot(), v, load, bagIds, instanceKey, esUltimoTramo));

                sequenceTime = arrTime;
            }

            if (load > 0 && r.getArrivalTime() > 0) {
                long arrivalTime = r.getArrivalTime();
                Vuelo lastFlight = flights.get(flights.size() - 1);
                long pickupTime = arrivalTime + PICKUP_DELAY_MS;
                events.add(new Event(pickupTime, EventType.BAGGAGE_PICKUP, r.getLot(), lastFlight, load, bagIds, null, false));
            }
        }

        events.sort(Comparator.comparingLong(Event::getTime));
        return events;
    }

    /** LOT_ARRIVAL independiente, ver doc original. */
    public List<Event> buildLotArrivalEvents(SuperLot lot, List<String> bagIdsSubset) {
        List<Event> events = new ArrayList<>();
        if (bagIdsSubset.isEmpty()) return events;

        Map<String, Long> bagReadyTimes = lot.getBagReadyTimes();

        // Agrupar bagIds por su readyTime individual real
        Map<Long, List<String>> byReadyTime = new TreeMap<>();
        for (String bagId : bagIdsSubset) {
            Long rt = (bagReadyTimes != null) ? bagReadyTimes.get(bagId) : null;
            long effectiveReadyTime = (rt != null) ? rt : lot.getReadyTime();
            byReadyTime.computeIfAbsent(effectiveReadyTime, k -> new ArrayList<>()).add(bagId);
        }

        // Un evento LOT_ARRIVAL por cada grupo de maletas que comparten
        // exactamente el mismo readyTime
        for (Map.Entry<Long, List<String>> entry : byReadyTime.entrySet()) {
            long readyTime = entry.getKey();
            List<String> bags = entry.getValue();
            events.add(new Event(
                    readyTime, EventType.LOT_ARRIVAL, lot, null,
                    bags.size(), bags, null, false
            ));
        }

        return events;
    }

    /**
     * Construye la cadena de eventos para UNA ruta sobre un subconjunto de bagIds,
     * leyendo legDepartures/legArrivals (ya calculados una sola vez en RouteBuilder
     * — única fuente de verdad de horarios). NO genera STORAGE_RELEASE. BAGGAGE_PICKUP
     * fijo a 10 minutos tras la llegada (requisito de negocio).
     */
    public List<Event> buildEventsForRoute(Route r, List<String> bagIdsSubset, long dayStartEpochMs) {

        List<Event> events = new ArrayList<>();
        List<Vuelo> flights = r.getFlights();
        List<Long> legDeps = r.getLegDepartures();
        List<Long> legArrs = r.getLegArrivals();

        if (flights == null || flights.isEmpty() || bagIdsSubset.isEmpty()) return events;
        if (legDeps == null || legArrs == null || legDeps.size() != flights.size()) return events;

        int load = bagIdsSubset.size();

        for (int i = 0; i < flights.size(); i++) {
            Vuelo v = flights.get(i);
            long depTime = legDeps.get(i);
            long arrTime = legArrs.get(i);
            String instanceKey = v.getId() + "-" + depTime;
            boolean esUltimoTramo = (i == flights.size() - 1);

            if (v.getId() == DEBUG_VUELO_ID) {
                System.out.println(String.format(
                        "[EVENT-ENGINE] instanceKey=%s bagIdsSubset=%d arrTime=%d depTime=%d isFinalLeg=%b",
                        instanceKey, bagIdsSubset.size(), arrTime, depTime, esUltimoTramo
                ));
            }

            events.add(new Event(depTime, EventType.FLIGHT_DEPARTURE, r.getLot(), v, load, bagIdsSubset, instanceKey, false));
            events.add(new Event(arrTime, EventType.FLIGHT_ARRIVAL, r.getLot(), v, load, bagIdsSubset, instanceKey, esUltimoTramo));
        }

        if (r.getArrivalTime() > 0) {
            long arrivalTime = r.getArrivalTime();
            Vuelo lastFlight = flights.get(flights.size() - 1);
            long pickupTime = arrivalTime + PICKUP_DELAY_MS;
            events.add(new Event(pickupTime, EventType.BAGGAGE_PICKUP, r.getLot(), lastFlight, load, bagIdsSubset, null, false));
        }

        return events;
    }
}