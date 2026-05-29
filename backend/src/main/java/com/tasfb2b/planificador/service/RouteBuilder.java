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

    public RouteBuilder(NetworkAdapter network) {
        this.network = network;
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
            return Route.builder()
                    .lot(lot)
                    .hops(List.of())
                    .flights(List.of())
                    .demandaTotal(lot.getTotalMaletas())
                    .capacidadAsignada(0)
                    .arrivalTime(Long.MAX_VALUE)
                    .deadline(lot.getDeadline())
                    .build();
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

        Route route = Route.builder()
                .lot(lot)
                .hops(hops)
                .flights(flights)
                .demandaTotal(lot.getTotalMaletas())
                .capacidadAsignada(asignado)
                .deadline(lot.getDeadline())
                .build();

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

        Route backup = Route.builder()
                .lot(lot)
                .hops(hops)
                .flights(flights)
                .demandaTotal(lot.getTotalMaletas())
                .capacidadAsignada(Math.min(lot.getTotalMaletas(), capacidadBackup))
                .deadline(lot.getDeadline())
                .build();

        backup.calcularArrivalTime();
        return backup;
    }
}
