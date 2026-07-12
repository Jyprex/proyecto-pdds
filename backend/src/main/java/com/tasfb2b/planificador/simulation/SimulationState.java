package com.tasfb2b.planificador.simulation;

import com.tasfb2b.planificador.domain.Event;
import com.tasfb2b.aeropuerto.domain.Aeropuerto;
import com.tasfb2b.vuelo.domain.Vuelo;
import com.tasfb2b.bloqueo.service.BloqueoService;
import lombok.Getter;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Estado mutable de la simulación. La planificación usa evaluación ALNS
 * por lo que el estado continúa procesando eventos incluso después de un colapso
 * para calcular las penalizaciones suaves (soft penalties) correctamente.
 */
@Getter
public class SimulationState {

    private long currentTime;
    public void setCurrentTime(long currentTime) { this.currentTime = currentTime; }

    private final Map<String, Integer> cargaAeropuerto = new HashMap<>();
    private final Map<Long, Integer> capacidadVuelo = new HashMap<>();
    private final Map<String, Integer> maletasEmbarcadas = new HashMap<>();
    private final Map<String, Integer> cargaAcumuladaPorInstanciaVuelo = new HashMap<>();

    private boolean colapso = false;
    private String collapseReason = null;
    private Long collapseTime = null;

    private int maletasEntregadas = 0;

    private Map<String, Aeropuerto> airportMap;
    private final BloqueoService bloqueoService;

    // --- Para SimulationRunner (Métricas de tiempo y eventos) ---
    private long buildEventsTimeNanos;
    private long applyEventsTimeNanos;
    private int totalEvents;
    private int appliedEvents;

    // --- Para ALNS / FitnessEvaluator / CollapseHelper ---
    private double saturacionAeropuerto = 0.0;
    private int maletasEnCola = 0;
    private boolean violacionCapacidadVuelo = false;

    public void setBuildEventsTimeNanos(long buildEventsTimeNanos) { this.buildEventsTimeNanos = buildEventsTimeNanos; }
    public void setApplyEventsTimeNanos(long applyEventsTimeNanos) { this.applyEventsTimeNanos = applyEventsTimeNanos; }
    public void setEventCounts(int total, int applied) { this.totalEvents = total; this.appliedEvents = applied; }

    public SimulationState(List<Aeropuerto> airports, List<Vuelo> vuelos, long startTime, BloqueoService bloqueoService) {
        this.currentTime = startTime;
        this.airportMap = new HashMap<>();
        this.bloqueoService = bloqueoService;
        airports.forEach(a -> {
            cargaAeropuerto.put(a.getIcaoCode(), 0);
            airportMap.put(a.getIcaoCode(), a);
        });
        if (vuelos != null) {
            vuelos.forEach(v -> capacidadVuelo.put(v.getId(), v.getCapacidadTotal()));
        }
    }

    /** Constructor privado usado exclusivamente por copy(). */
    private SimulationState(Map<String, Aeropuerto> airportMap, BloqueoService bloqueoService, long currentTime) {
        this.airportMap = airportMap;
        this.bloqueoService = bloqueoService;
        this.currentTime = currentTime;
    }

    /** Clon profundo de los mapas mutables — usado para el snapshot visual de cada bloque. */
    public SimulationState copy() {
        SimulationState clone = new SimulationState(this.airportMap, this.bloqueoService, this.currentTime);
        clone.cargaAeropuerto.putAll(this.cargaAeropuerto);
        clone.capacidadVuelo.putAll(this.capacidadVuelo);
        clone.maletasEmbarcadas.putAll(this.maletasEmbarcadas);
        clone.cargaAcumuladaPorInstanciaVuelo.putAll(this.cargaAcumuladaPorInstanciaVuelo);
        clone.maletasEntregadas = this.maletasEntregadas;
        clone.colapso = this.colapso;
        clone.collapseReason = this.collapseReason;
        clone.collapseTime = this.collapseTime;

        // Copiar métricas del ALNS
        clone.saturacionAeropuerto = this.saturacionAeropuerto;
        clone.maletasEnCola = this.maletasEnCola;
        clone.violacionCapacidadVuelo = this.violacionCapacidadVuelo;

        return clone;
    }

    public void registerFlights(List<Vuelo> vuelos) {
        if (vuelos == null) return;
        vuelos.forEach(v -> capacidadVuelo.putIfAbsent(v.getId(), v.getCapacidadTotal()));
    }

    private int getEffectiveStorageCapacity(Aeropuerto ap) {
        if (ap == null) return 0;
        int original = ap.getStorageCapacity();
        if (bloqueoService == null) return original;
        int pct = bloqueoService.getCapacidadEfectivaPct(ap.getIcaoCode(), java.time.Instant.ofEpochMilli(currentTime));
        return (int) (original * (pct / 100.0));
    }

    private void registrarColapsoVisual(long time, String reason) {
        // Solo guardamos el primer evento de colapso para el frontend
        if (!colapso) {
            colapso = true;
            collapseTime = time;
            collapseReason = reason;
        }
    }

    private void actualizarSaturacionGlobal() {
        double maxRatio = 0.0;
        for (Map.Entry<String, Integer> entry : cargaAeropuerto.entrySet()) {
            Aeropuerto ap = airportMap.get(entry.getKey());
            if (ap != null && ap.getStorageCapacity() > 0) {
                double ratio = (double) entry.getValue() / getEffectiveStorageCapacity(ap);
                if (ratio > maxRatio) maxRatio = ratio;
            }
        }
        // Nos quedamos con el pico histórico del día
        if (maxRatio > this.saturacionAeropuerto) {
            this.saturacionAeropuerto = maxRatio;
        }
    }

    public void apply(Event event, Map<String, Aeropuerto> airports) {
        // NOTA: Se eliminó el 'if (colapso) return;' para permitir métricas heurísticas completas.

        currentTime = event.getTime();
        this.airportMap = airports;

        switch (event.getType()) {

            case FLIGHT_DEPARTURE -> {
                Vuelo v = event.getVuelo();
                int remaining = capacidadVuelo.getOrDefault(v.getId(), v.getCapacidadTotal());

                String instanciaKey = v.getId() + "-" + event.getTime();
                int acumulada = cargaAcumuladaPorInstanciaVuelo.getOrDefault(instanciaKey, 0) + event.getLoad();
                cargaAcumuladaPorInstanciaVuelo.put(instanciaKey, acumulada);

                if (event.getLoad() > remaining || acumulada > v.getCapacidadTotal()) {
                    registrarColapsoVisual(event.getTime(), "VUELO_EXCEDIDO: vuelo " + v.getId() + " intentó embarcar más maletas de las permitidas.");
                    this.violacionCapacidadVuelo = true;
                }

                maletasEmbarcadas.put(v.getId() + "-" + event.getLot().getId(), event.getLoad());
                capacidadVuelo.put(v.getId(), remaining - event.getLoad());

                String icaoOrigen = v.getOrigen().getIcaoCode();
                cargaAeropuerto.put(icaoOrigen, Math.max(0, cargaAeropuerto.getOrDefault(icaoOrigen, 0) - event.getLoad()));
            }

            case FLIGHT_ARRIVAL -> {
                Vuelo v = event.getVuelo();
                int actualLoad = maletasEmbarcadas.getOrDefault(v.getId() + "-" + event.getLot().getId(), event.getLoad());
                capacidadVuelo.merge(v.getId(), actualLoad, Integer::sum);

                String icao = v.getDestino().getIcaoCode();
                Aeropuerto ap = airports.get(icao);
                int current = cargaAeropuerto.getOrDefault(icao, 0);
                int effectiveCapacity = getEffectiveStorageCapacity(ap);

                if (ap != null && current + actualLoad > effectiveCapacity) {
                    registrarColapsoVisual(event.getTime(), "ALMACEN_EXCEDIDO: " + icao + " superó su capacidad al recibir un vuelo.");
                }
                cargaAeropuerto.put(icao, current + actualLoad);
            }

            case LOT_ARRIVAL -> {
                String icao = event.getLot().getOrigenIcao();
                Aeropuerto ap = airports.get(icao);
                int actualLoad = event.getLoad();
                int current = cargaAeropuerto.getOrDefault(icao, 0);
                int effectiveCapacity = getEffectiveStorageCapacity(ap);

                if (ap != null && current + actualLoad > effectiveCapacity) {
                    registrarColapsoVisual(event.getTime(), "ALMACEN_EXCEDIDO: " + icao + " superó su capacidad al recibir envíos nuevos.");
                }
                cargaAeropuerto.put(icao, current + actualLoad);

                // Sumar maletas que llegan a la cola
                this.maletasEnCola += actualLoad;
            }

            case BAGGAGE_PICKUP -> {
                Vuelo v = event.getVuelo();
                int actualLoad = maletasEmbarcadas.getOrDefault(v.getId() + "-" + event.getLot().getId(), event.getLoad());
                String icaoDestino = v.getDestino().getIcaoCode();
                cargaAeropuerto.put(icaoDestino, Math.max(0, cargaAeropuerto.getOrDefault(icaoDestino, 0) - actualLoad));
                maletasEntregadas += actualLoad;

                // Restar maletas que salen de la cola
                this.maletasEnCola = Math.max(0, this.maletasEnCola - actualLoad);
            }

            default -> {}
        }

        actualizarSaturacionGlobal();
    }

    public boolean isColapsado() { return colapso; }

    public int getLoadAt(String icao) { return cargaAeropuerto.getOrDefault(icao, 0); }

    public int getOccupancyPercent(String icao, Map<String, Aeropuerto> airports) {
        Aeropuerto ap = airports.get(icao);
        int cap = getEffectiveStorageCapacity(ap);
        if (ap == null || cap <= 0) return 0;
        return (int) Math.min(100, Math.ceil((cargaAeropuerto.getOrDefault(icao, 0) * 100.0) / cap));
    }
}