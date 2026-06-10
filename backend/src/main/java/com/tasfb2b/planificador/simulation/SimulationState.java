package com.tasfb2b.planificador.simulation;

import com.tasfb2b.planificador.domain.Event;
import com.tasfb2b.aeropuerto.domain.Aeropuerto;
import com.tasfb2b.vuelo.domain.Vuelo;
import com.tasfb2b.bloqueo.service.BloqueoService;
import lombok.Getter;

import java.util.*;

/**
 * Estado mutable de la simulación, actualizado evento a evento.
 */
@Getter
public class SimulationState {

    private long currentTime;

    public void setCurrentTime(long currentTime) {
        this.currentTime = currentTime;
    }

    /** Carga actual (maletas almacenadas) por aeropuerto ICAO. */
    private final Map<String, Integer> cargaAeropuerto = new HashMap<>();

    /** Capacidad disponible restante por vuelo (decrece en DEPARTURE). */
    private final Map<Long, Integer> capacidadVuelo = new HashMap<>();

    /** Hard Constraint: maletas realmente embarcadas por (lote, vuelo). */
    private final Map<String, Integer> maletasEmbarcadas = new HashMap<>();

    /** Exceso actual de maletas sobre capacidad (suma de todos los aeropuertos saturados). */
    private int saturacionAeropuerto = 0;

    /** true si ALGÚN aeropuerto supera su storageCapacity en este instante. */
    private boolean colapso = false;

    /**
     * Acumulado de maletas entregadas al cliente (eventos BAGGAGE_PICKUP / STORAGE_RELEASE).
     * Se usa para poblar SimulationDayReport.maletasEntregadas.
     */
    private int maletasEntregadas = 0;

    /** Cantidad de maletas que están a la espera de replanificación por cancelación. */
    private int maletasEnEsperaReplan = 0;

    /** Vuelos cancelados procesados en la simulación. */
    private final Set<Long> vuelosCancelados = new HashSet<>();

    /** Cantidad de eventos totales generados para el periodo. */
    private int totalEventsCount = 0;

    /** Cantidad de eventos efectivamente aplicados (dentro del tiempo). */
    private int appliedEventsCount = 0;

    /** Tiempo consumido en construir eventos (ns). */
    @lombok.Setter
    private long buildEventsTimeNanos = 0;

    /** Tiempo consumido en aplicar eventos (ns). */
    @lombok.Setter
    private long applyEventsTimeNanos = 0;

    public void setEventCounts(int total, int applied) {
        this.totalEventsCount = total;
        this.appliedEventsCount = applied;
    }

    /** Mapa de aeropuertos, necesario para reevaluar saturación en DEPARTURE. */
    private Map<String, Aeropuerto> airportMap;

    private final BloqueoService bloqueoService;

    // ── COLA DE ESPERA (CARRY-OVER) ────────────────────────
    /**
     * Registro de maletas en espera por capacidad de almacén.
     * @param lotId       ID del SuperLot al que pertenece
     * @param cantidad    número de maletas pendientes
     * @param enqueueTime epoch ms cuando se encoló (para prioridad FIFO)
     */
    public record PendingBag(int lotId, int cantidad, long enqueueTime) {}

    /** Cola FIFO de maletas que no pudieron entrar al almacén por capacidad. */
    @Getter
    private final Map<String, ArrayDeque<PendingBag>> colaEspera = new HashMap<>();

    /** Total global de maletas en cola de espera (para métricas). */
    @Getter
    private int maletasEnCola = 0;

    public SimulationState(List<Aeropuerto> airports,
                           List<Vuelo> vuelos,
                           long startTime,
                           BloqueoService bloqueoService) {

        this.currentTime = startTime;
        this.airportMap = new HashMap<>();
        this.bloqueoService = bloqueoService;

        airports.forEach(a -> {
            cargaAeropuerto.put(a.getIcaoCode(), 0);
            airportMap.put(a.getIcaoCode(), a);
        });

        vuelos.forEach(v ->
                capacidadVuelo.put(v.getId(), v.getCapacidadTotal()));
    }

    /** Registra nuevos vuelos en el estado para trackear su capacidad. */
    public void registerFlights(List<Vuelo> vuelos) {
        if (vuelos == null) return;
        vuelos.forEach(v -> {
            if (!capacidadVuelo.containsKey(v.getId())) {
                capacidadVuelo.put(v.getId(), v.getCapacidadTotal());
            }
        });
    }

    /** Obtiene la capacidad de almacenamiento efectiva considerando averías vigentes */
    private int getEffectiveStorageCapacity(Aeropuerto ap) {
        if (ap == null) return 0;
        int originalCapacity = ap.getStorageCapacity();
        if (bloqueoService == null) return originalCapacity;
        int pct = bloqueoService.getCapacidadEfectivaPct(ap.getIcaoCode(), java.time.Instant.ofEpochMilli(currentTime));
        return (int) (originalCapacity * (pct / 100.0));
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

                // Hard Constraint: descontar capacidad real, no planificada
                int remaining = capacidadVuelo.getOrDefault(v.getId(), v.getCapacidadTotal());
                int actualLoad = Math.min(event.getLoad(), remaining);

                maletasEmbarcadas.put(v.getId() + "-" + event.getLot().getId(), actualLoad);
                capacidadVuelo.put(v.getId(), remaining - actualLoad);

                // Las maletas SALEN del aeropuerto origen → reducir carga
                String icaoOrigen = v.getOrigen().getIcaoCode();
                int cargaActual = cargaAeropuerto.getOrDefault(icaoOrigen, 0);
                int nuevaCarga = Math.max(0, cargaActual - actualLoad);
                cargaAeropuerto.put(icaoOrigen, nuevaCarga);

                // Re-evaluar saturación global tras el egreso
                recalcularSaturacion(airports);

                // Drenar cola de espera si se liberó espacio
                drainCola(icaoOrigen, airports);
            }

            case FLIGHT_ARRIVAL -> {
                Vuelo v = event.getVuelo();
                int actualLoad = maletasEmbarcadas.getOrDefault(
                        v.getId() + "-" + event.getLot().getId(), event.getLoad());

                String icao = v.getDestino().getIcaoCode();
                Aeropuerto ap = airports.get(icao);
                int current = cargaAeropuerto.getOrDefault(icao, 0);

                int effectiveCapacity = getEffectiveStorageCapacity(ap);
                // Cola de espera: si el almacén está lleno, encolar excedente
                if (ap != null && current + actualLoad > effectiveCapacity) {
                    int espacioLibre = Math.max(0, effectiveCapacity - current);
                    int excedente = actualLoad - espacioLibre;

                    if (espacioLibre > 0) {
                        cargaAeropuerto.put(icao, current + espacioLibre);
                    }
                    if (excedente > 0) {
                        colaEspera.computeIfAbsent(icao, k -> new ArrayDeque<>())
                                .add(new PendingBag(event.getLot().getId(), excedente, event.getTime()));
                        maletasEnCola += excedente;
                    }
                } else {
                    cargaAeropuerto.put(icao, current + actualLoad);
                }

                recalcularSaturacion(airports);
            }

            case LOT_ARRIVAL -> {
                String icao = event.getLot().getOrigenIcao();
                Aeropuerto ap = airports.get(icao);
                int actualLoad = event.getLoad();
                int current = cargaAeropuerto.getOrDefault(icao, 0);

                int effectiveCapacity = getEffectiveStorageCapacity(ap);
                if (ap != null && current + actualLoad > effectiveCapacity) {
                    int espacioLibre = Math.max(0, effectiveCapacity - current);
                    int excedente = actualLoad - espacioLibre;

                    if (espacioLibre > 0) {
                        cargaAeropuerto.put(icao, current + espacioLibre);
                    }
                    if (excedente > 0) {
                        colaEspera.computeIfAbsent(icao, k -> new ArrayDeque<>())
                                .add(new PendingBag(event.getLot().getId(), excedente, event.getTime()));
                        maletasEnCola += excedente;
                    }
                } else {
                    cargaAeropuerto.put(icao, current + actualLoad);
                }
                recalcularSaturacion(airports);
            }

            case BAGGAGE_PICKUP -> {
                Vuelo v = event.getVuelo();
                int actualLoad = maletasEmbarcadas.getOrDefault(
                        v.getId() + "-" + event.getLot().getId(), event.getLoad());

                String icaoDestino = v.getDestino().getIcaoCode();
                int cargaActual = cargaAeropuerto.getOrDefault(icaoDestino, 0);
                int nuevaCarga = Math.max(0, cargaActual - actualLoad);
                cargaAeropuerto.put(icaoDestino, nuevaCarga);
                maletasEntregadas += actualLoad;
                recalcularSaturacion(airports);
                drainCola(icaoDestino, airports);
            }

            case STORAGE_RELEASE -> {
                Vuelo v = event.getVuelo();
                int actualLoad = maletasEmbarcadas.getOrDefault(
                        v.getId() + "-" + event.getLot().getId(), event.getLoad());

                String icaoDestino = v.getDestino().getIcaoCode();
                int cargaActual = cargaAeropuerto.getOrDefault(icaoDestino, 0);
                int nuevaCarga = Math.max(0, cargaActual - actualLoad);
                cargaAeropuerto.put(icaoDestino, nuevaCarga);
                maletasEntregadas += actualLoad;
                recalcularSaturacion(airports);
                drainCola(icaoDestino, airports);
            }

            case FLIGHT_CANCELLED -> {
                vuelosCancelados.add(event.getVuelo().getId());
                maletasEnEsperaReplan += event.getLoad();
            }

            case REPLAN_TRIGGER -> {
                maletasEnEsperaReplan = Math.max(0, maletasEnEsperaReplan - event.getLoad());
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

            int exceso = entry.getValue() - getEffectiveStorageCapacity(ap);
            if (exceso > 0) {
                totalExceso += exceso;
            }
        }

        this.saturacionAeropuerto = totalExceso;
        // Colapso reversible: se activa Y desactiva según la saturación actual
        this.colapso = totalExceso > 0;
    }

    /**
     * Drena la cola de espera de un aeropuerto, moviendo maletas encoladas
     * al almacén mientras haya espacio disponible. Llamar después de cada
     * evento que libere espacio (DEPARTURE, STORAGE_RELEASE, BAGGAGE_PICKUP).
     */
    private void drainCola(String icao, Map<String, Aeropuerto> airports) {
        ArrayDeque<PendingBag> cola = colaEspera.get(icao);
        if (cola == null || cola.isEmpty()) return;

        Aeropuerto ap = airports.get(icao);
        if (ap == null) return;

        int cargaActual = cargaAeropuerto.getOrDefault(icao, 0);
        int effectiveCapacity = getEffectiveStorageCapacity(ap);
        int espacioLibre = effectiveCapacity - cargaActual;

        while (!cola.isEmpty() && espacioLibre > 0) {
            PendingBag pb = cola.peek();
            if (pb.cantidad() <= espacioLibre) {
                cola.poll();
                cargaAeropuerto.put(icao, cargaAeropuerto.getOrDefault(icao, 0) + pb.cantidad());
                espacioLibre -= pb.cantidad();
                maletasEnCola -= pb.cantidad();
            } else {
                // Mover parcial: llenar el espacio y dejar el resto en cola
                cola.poll();
                cargaAeropuerto.put(icao, effectiveCapacity);
                int restante = pb.cantidad() - espacioLibre;
                cola.addFirst(new PendingBag(pb.lotId(), restante, pb.enqueueTime()));
                maletasEnCola -= espacioLibre;
                espacioLibre = 0;
            }
        }

        // Limpiar entrada del mapa si la cola quedó vacía
        if (cola.isEmpty()) colaEspera.remove(icao);

        recalcularSaturacion(airports);
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
        int effectiveCapacity = getEffectiveStorageCapacity(ap);
        if (ap == null || effectiveCapacity <= 0) return 0;
        int carga = cargaAeropuerto.getOrDefault(icao, 0);
        return (int) Math.min(100, (carga * 100.0) / effectiveCapacity);
    }
}