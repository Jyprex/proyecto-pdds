package com.tasfb2b.tracking.service;

import com.tasfb2b.tracking.domain.ShipmentState;
import com.tasfb2b.tracking.domain.ShipmentStatus;
import com.tasfb2b.planificador.domain.Event;
import com.tasfb2b.planificador.domain.Route;
import com.tasfb2b.vuelo.domain.Vuelo;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

public class ShipmentTracker {

    private final Map<String, ShipmentState> bags = new ConcurrentHashMap<>();
    private final Map<String, Set<String>> byFlightInstance = new ConcurrentHashMap<>();
    private final Map<String, Set<String>> byAirport = new ConcurrentHashMap<>();
    private final Map<String, Set<String>> byShipmentCode = new ConcurrentHashMap<>();

    public record HopInfo(String origenIcao, String destinoIcao, Long vueloId,
                          String flightInstanceKey, long departureTime, long arrivalTime) {}

    private final Map<String, List<HopInfo>> hopsByBag = new ConcurrentHashMap<>();

    private ShipmentState getOrCreate(String bagId) {
        return bags.computeIfAbsent(bagId, id -> {
            ShipmentState s = new ShipmentState(id);
            byShipmentCode.computeIfAbsent(s.getShipmentCode(), k -> ConcurrentHashMap.newKeySet()).add(id);
            return s;
        });
    }

    public ShipmentState getBag(String bagId) { return bags.get(bagId); }

    public List<ShipmentState> getByShipment(String codigoPedido) {
        return byShipmentCode.getOrDefault(codigoPedido, Set.of()).stream().map(bags::get).filter(Objects::nonNull).toList();
    }

    public Collection<ShipmentState> getAll() { return bags.values(); }

    public List<ShipmentState> getByFlightInstance(String instanceKey) {
        return byFlightInstance.getOrDefault(instanceKey, Set.of()).stream().map(bags::get).filter(Objects::nonNull).toList();
    }

    public List<ShipmentState> getByAirport(String icao) {
        // Filtro defensivo: una maleta ENTREGADA nunca debe aparecer en la
        // trazabilidad de un almacén — ya salió físicamente de la red, por
        // regla de negocio solo debe verse en el histórico de envíos. Esto
        // protege incluso ante una condición de carrera residual del índice.
        return byAirport.getOrDefault(icao, Set.of()).stream()
                .map(bags::get)
                .filter(Objects::nonNull)
                .filter(s -> s.getEstado() != ShipmentStatus.ENTREGADO)  // ← NUEVO
                .toList();
    }

    public void registerPlannedHops(List<String> bagIds, Route route) {
        if (route.getFlights() == null || route.getLegDepartures() == null) return;
        List<HopInfo> hops = new ArrayList<>();
        for (int i = 0; i < route.getFlights().size(); i++) {
            Vuelo v = route.getFlights().get(i);
            long dep = route.getLegDepartures().get(i);
            long arr = route.getLegArrivals().get(i);
            hops.add(new HopInfo(v.getOrigen().getIcaoCode(), v.getDestino().getIcaoCode(), v.getId(), v.getId() + "-" + dep, dep, arr));
        }
        for (String bagId : bagIds) hopsByBag.put(bagId, hops);
    }

    public List<HopInfo> getHops(String bagId) { return hopsByBag.getOrDefault(bagId, List.of()); }

    public Map<String, List<HopInfo>> getShipmentHops(String codigoPedido) {
        Map<String, List<HopInfo>> result = new LinkedHashMap<>();
        for (String bagId : byShipmentCode.getOrDefault(codigoPedido, Set.of())) result.put(bagId, getHops(bagId));
        return result;
    }

    public void observe(Event event) {
        switch (event.getType()) {
            case LOT_ARRIVAL -> handleLotArrival(event);
            case FLIGHT_DEPARTURE -> handleDeparture(event);
            case FLIGHT_ARRIVAL -> handleArrival(event);
            case BAGGAGE_PICKUP -> handlePickup(event);
            default -> {}
        }
    }

    private void handleDeparture(Event event) {
        String instanceKey = event.getFlightInstanceKey();
        for (String bagId : event.getBagIds()) {
            ShipmentState s = getOrCreate(bagId);
            removeFromAirportIndex(bagId, s.getAeropuertoActual());
            s.setEstado(ShipmentStatus.EN_VUELO);
            s.setVueloActual(event.getVuelo().getId());
            s.setVueloInstanceActual(instanceKey);
            s.setAeropuertoActual(null);
            byFlightInstance.computeIfAbsent(instanceKey, k -> ConcurrentHashMap.newKeySet()).add(bagId);
        }
    }

    private void handleArrival(Event event) {
        String instanceKey = event.getFlightInstanceKey();
        String icao = event.getVuelo().getDestino().getIcaoCode();
        ShipmentStatus nuevoEstado = event.isFinalLeg() ? ShipmentStatus.EN_ALMACEN_DESTINO : ShipmentStatus.EN_ALMACEN_INTERMEDIO;

        for (String bagId : event.getBagIds()) {
            ShipmentState s = getOrCreate(bagId);
            s.setEstado(nuevoEstado);
            s.setAeropuertoActual(icao);
            s.setVueloActual(null);
            s.setVueloInstanceActual(null);

            Set<String> set = byFlightInstance.get(instanceKey);
            if (set != null) { set.remove(bagId); if (set.isEmpty()) byFlightInstance.remove(instanceKey); }

            byAirport.computeIfAbsent(icao, k -> ConcurrentHashMap.newKeySet()).add(bagId);
        }
    }

    private void handlePickup(Event event) {
        for (String bagId : event.getBagIds()) {
            ShipmentState s = getOrCreate(bagId);
            removeFromAirportIndex(bagId, s.getAeropuertoActual());
            s.setEstado(ShipmentStatus.ENTREGADO);
            s.setAeropuertoActual(null);
            s.setVueloActual(null);
            s.setVueloInstanceActual(null);
        }
    }

    private void handleLotArrival(Event event) {
        String icao = event.getLot().getOrigenIcao();
        for (String bagId : event.getBagIds()) {
            ShipmentState s = getOrCreate(bagId);
            s.setEstado(ShipmentStatus.EN_ALMACEN_ORIGEN);
            s.setAeropuertoActual(icao);

            String oldInstanceKey = s.getVueloInstanceActual();
            if (oldInstanceKey != null) {
                Set<String> set = byFlightInstance.get(oldInstanceKey);
                if (set != null) { set.remove(bagId); if (set.isEmpty()) byFlightInstance.remove(oldInstanceKey); }
            }
            s.setVueloActual(null);
            s.setVueloInstanceActual(null);
            byAirport.computeIfAbsent(icao, k -> ConcurrentHashMap.newKeySet()).add(bagId);
        }
    }

    private void removeFromAirportIndex(String bagId, String icao) {
        if (icao == null) return;
        Set<String> set = byAirport.get(icao);
        if (set != null) set.remove(bagId);
    }
}