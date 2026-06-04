package com.tasfb2b.planificador.service;

import com.tasfb2b.aeropuerto.domain.Aeropuerto;
import com.tasfb2b.planificador.domain.Route;
import com.tasfb2b.superlote.domain.SuperLot;
import com.tasfb2b.vuelo.domain.Vuelo;
import com.tasfb2b.planificador.strategy.NetworkAdapter;
import org.springframework.stereotype.Component;

import java.util.*;

@Component
public class RouteBuilder {

    private final NetworkAdapter network;
    private final RoutePool routePool;

    public RouteBuilder(NetworkAdapter network, RoutePool routePool) {
        this.network = network;
        this.routePool = routePool;
    }

    public RoutePool getRoutePool() {
        return routePool;
    }

    public Route build(SuperLot lot,
                       Map<String, Aeropuerto> airportMap,
                       Map<String, Integer> cargaAeropuerto,
                       Map<Long, Integer> capacidadVuelo) {

        Aeropuerto origen  = airportMap.get(lot.getOrigenIcao());
        Aeropuerto destino = airportMap.get(lot.getDestinoIcao());

        // Si el caller provee un mapa de capacidad real (ALNS con estado acumulado),
        // usamos el overload consciente de capacidad. Dijkstra filtrará vuelos llenos.
        // Si el mapa está vacío (modo legacy/HGA), usamos el Dijkstra estándar.
        List<Vuelo> flights = capacidadVuelo.isEmpty()
                ? network.findBestRoute(origen, destino, lot)
                : network.findBestRoute(origen, destino, lot, capacidadVuelo);

        if (flights == null || flights.isEmpty()) {
            Route empty = routePool.borrow();
            empty.setLot(lot);
            empty.setHops(List.of());
            empty.setFlights(List.of());
            empty.setDemandaTotal(lot.getTotalMaletas());
            empty.setCapacidadAsignada(0);
            empty.setArrivalTime(Long.MAX_VALUE);
            empty.setDeadline(lot.getSla());
            return empty;
        }

        // ─────────────────────────────────────────────
        // 1. CAPACIDAD DE VUELO (simulada)
        // ─────────────────────────────────────────────
        int capacidadRuta = flights.stream()
                .mapToInt(v -> capacidadVuelo.getOrDefault(v.getId(), v.getCapacidadTotal()))
                .min()
                .orElse(0);

        int asignado = Math.min(lot.getTotalMaletas(), capacidadRuta);

        // ─────────────────────────────────────────────
        // 2. SIMULACIÓN DE SATURACIÓN AEROPUERTO
        // ─────────────────────────────────────────────
        int saturacionAeropuerto = 0;

        for (Vuelo v : flights) {

            String icao = v.getOrigen().getIcaoCode();
            Aeropuerto ap = airportMap.get(icao);

            int cargaActual = cargaAeropuerto.getOrDefault(icao, 0);
            int nuevaCarga = cargaActual + asignado;

            if (nuevaCarga > ap.getStorageCapacity()) {
                saturacionAeropuerto += (nuevaCarga - ap.getStorageCapacity());
            }
        }

        // ─────────────────────────────────────────────
        // 3. CONSTRUCCIÓN DE RUTA (SIEMPRE)
        // ─────────────────────────────────────────────
        List<String> hops = new ArrayList<>();
        for (Vuelo v : flights) {
            hops.add(v.getOrigen().getIcaoCode());
        }
        hops.add(destino.getIcaoCode());

        Route route = routePool.borrow();
        route.setLot(lot);
        route.setHops(hops);
        route.setFlights(flights);
        route.setDemandaTotal(lot.getTotalMaletas());
        route.setCapacidadAsignada(asignado);
        route.setDeadline(lot.getSla());

        route.calcularArrivalTime();


        return route;
    }

    /**
     * Construye una ruta alternativa (backup) excluyendo los vuelos del camino principal.
     * El backup se usa en ALNS como warm-start cuando se cancela uno de esos vuelos.
     *
     * @param lot               lote a enrutar
     * @param airportMap        mapa de aeropuertos
     * @param excludedFlightIds vuelos a excluir del grafo (los de la ruta principal)
     * @return ruta alternativa, o null si no existe camino alternativo
     */
    public Route buildBackup(SuperLot lot,
                             Map<String, Aeropuerto> airportMap,
                             Set<Long> excludedFlightIds) {

        Aeropuerto origen  = airportMap.get(lot.getOrigenIcao());
        Aeropuerto destino = airportMap.get(lot.getDestinoIcao());

        if (origen == null || destino == null) return null;

        List<Vuelo> flights = network.findAlternativeRoute(origen, destino, lot, excludedFlightIds);

        if (flights == null || flights.isEmpty()) return null;

        List<String> hops = new ArrayList<>();
        for (Vuelo v : flights) hops.add(v.getOrigen().getIcaoCode());
        hops.add(destino.getIcaoCode());

        int capacidadBackup = flights.stream()
                .mapToInt(Vuelo::getCapacidadTotal)
                .min()
                .orElse(0);

        Route backup = routePool.borrow();
        backup.setLot(lot);
        backup.setHops(hops);
        backup.setFlights(flights);
        backup.setDemandaTotal(lot.getTotalMaletas());
        backup.setCapacidadAsignada(Math.min(lot.getTotalMaletas(), capacidadBackup));
        backup.setDeadline(lot.getSla());

        backup.calcularArrivalTime();
        return backup;
    }
}