package com.tasfb2b.planificador.simulation;

import com.tasfb2b.planificador.domain.Event;
import com.tasfb2b.aeropuerto.domain.Aeropuerto;
import com.tasfb2b.vuelo.domain.Vuelo;
import lombok.Getter;

import java.util.*;

/**
 * Estado mutable de la simulación, actualizado evento a evento.
 *
 * <p>El colapso es REVERSIBLE: si la carga de todos los aeropuertos
 * baja por debajo de su storageCapacity, el sistema se recupera
 * (colapso = false). Esto permite modelar escenarios de recuperación.
 *
 * <p>saturacionAeropuerto = suma de maletas en exceso ACTUALES
 * (no acumulativo histórico).
 */
@Getter
public class SimulationState {

    private long currentTime;

    /** Carga actual (maletas almacenadas) por aeropuerto ICAO. */
    private final Map<String, Integer> cargaAeropuerto = new HashMap<>();

    /** Capacidad disponible restante por vuelo (decrece en DEPARTURE). */
    private final Map<Long, Integer> capacidadVuelo = new HashMap<>();

    /** Exceso actual de maletas sobre capacidad (suma de todos los aeropuertos saturados). */
    private int saturacionAeropuerto = 0;

    /** true si ALGÚN aeropuerto supera su storageCapacity en este instante. */
    private boolean colapso = false;

    /**
     * Acumulado de maletas entregadas al cliente (eventos BAGGAGE_PICKUP procesados).
     * Se usa para poblar SimulationDayReport.maletasEntregadas.
     */
    private int maletasEntregadas = 0;

    /** Mapa de aeropuertos, necesario para reevaluar saturación en DEPARTURE. */
    private Map<String, Aeropuerto> airportMap;

    public SimulationState(List<Aeropuerto> airports,
                           List<Vuelo> vuelos,
                           long startTime) {

        this.currentTime = startTime;
        this.airportMap = new HashMap<>();

        airports.forEach(a -> {
            cargaAeropuerto.put(a.getIcaoCode(), 0);
            airportMap.put(a.getIcaoCode(), a);
        });

        vuelos.forEach(v ->
                capacidadVuelo.put(v.getId(), v.getCapacidadTotal()));
    }

    // ─────────────────────────────────────────────
    // APLICAR EVENTO
    // ─────────────────────────────────────────────

    public void apply(Event event,
                      Map<String, Aeropuerto> airports) {

        currentTime = event.getTime();
        // Actualizar referencia al mapa de aeropuertos
        this.airportMap = airports;

        switch (event.getType()) {

            case FLIGHT_DEPARTURE -> {
                Vuelo v = event.getVuelo();

                // Descontar capacidad usada en este vuelo
                int remaining = capacidadVuelo.getOrDefault(v.getId(), v.getCapacidadTotal());
                capacidadVuelo.put(v.getId(),
                        Math.max(0, remaining - event.getLoad()));

                // Las maletas SALEN del aeropuerto origen → reducir carga
                String icaoOrigen = v.getOrigen().getIcaoCode();
                int cargaActual = cargaAeropuerto.getOrDefault(icaoOrigen, 0);
                int nuevaCarga = Math.max(0, cargaActual - event.getLoad());
                cargaAeropuerto.put(icaoOrigen, nuevaCarga);

                // Re-evaluar saturación global tras el egreso
                recalcularSaturacion(airports);
            }

            case FLIGHT_ARRIVAL -> {
                Vuelo v = event.getVuelo();
                String icao = v.getDestino().getIcaoCode();
                Aeropuerto ap = airports.get(icao);

                int current = cargaAeropuerto.getOrDefault(icao, 0);
                int updated = current + event.getLoad();
                cargaAeropuerto.put(icao, updated);

                // Re-evaluar saturación global tras el ingreso
                recalcularSaturacion(airports);
            }

            case LOT_ARRIVAL -> {
                // solo informativo
            }

            case BAGGAGE_PICKUP -> {
                // El cliente retira sus maletas del almacén destino.
                // Se reduce la carga del aeropuerto y se reevalúa la saturación.
                // Garantía: carga nunca baja de 0 (Math.max protege invariante).
                String icaoDestino = event.getVuelo().getDestino().getIcaoCode();
                int cargaActual = cargaAeropuerto.getOrDefault(icaoDestino, 0);
                int nuevaCarga  = Math.max(0, cargaActual - event.getLoad());
                cargaAeropuerto.put(icaoDestino, nuevaCarga);
                maletasEntregadas += event.getLoad();
                recalcularSaturacion(airports);
            }
        }
    }

    /**
     * Recalcula la saturación total y el estado de colapso basándose en
     * la carga ACTUAL de todos los aeropuertos. Al ser invocado tras cada
     * DEPARTURE y ARRIVAL, el colapso puede activarse Y desactivarse.
     */
    private void recalcularSaturacion(Map<String, Aeropuerto> airports) {
        int totalExceso = 0;

        for (Map.Entry<String, Integer> entry : cargaAeropuerto.entrySet()) {
            Aeropuerto ap = airports.get(entry.getKey());
            if (ap == null) continue;

            int exceso = entry.getValue() - ap.getStorageCapacity();
            if (exceso > 0) {
                totalExceso += exceso;
            }
        }

        this.saturacionAeropuerto = totalExceso;
        // Colapso reversible: se activa Y desactiva según la saturación actual
        this.colapso = totalExceso > 0;
    }

    public boolean isColapsado() {
        return colapso;
    }

    /**
     * Retorna la carga actual (maletas) en un aeropuerto dado.
     * Útil para que SimulationService calcule lotes pendientes.
     */
    public int getLoadAt(String icao) {
        return cargaAeropuerto.getOrDefault(icao, 0);
    }

    /**
     * Retorna el porcentaje de ocupación de un aeropuerto respecto a su capacidad.
     * Usado para construir el mapa de cargas en el DTO de status.
     */
    public int getOccupancyPercent(String icao, Map<String, Aeropuerto> airports) {
        Aeropuerto ap = airports.get(icao);
        if (ap == null || ap.getStorageCapacity() <= 0) return 0;
        int carga = cargaAeropuerto.getOrDefault(icao, 0);
        return (int) Math.min(100, (carga * 100.0) / ap.getStorageCapacity());
    }
}