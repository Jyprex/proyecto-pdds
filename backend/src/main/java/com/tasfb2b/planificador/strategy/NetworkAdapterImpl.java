package com.tasfb2b.planificador.strategy;

import com.tasfb2b.aeropuerto.domain.Aeropuerto;
import com.tasfb2b.superlote.domain.SuperLot;
import com.tasfb2b.vuelo.domain.Vuelo;
import com.tasfb2b.vuelo.repository.VueloRepository;
import com.tasfb2b.bloqueo.service.BloqueoService;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.HashMap;
import java.util.ArrayList;
import java.util.LinkedList;
import java.util.PriorityQueue;
import java.util.Comparator;
import java.util.Set;
import java.util.Collections;

@Component
public class NetworkAdapterImpl implements NetworkAdapter {

    private final VueloRepository repo;
    private final BloqueoService bloqueoService;

    // EntityManager para hacer JOIN FETCH y evitar LazyInitializationException
    // en hilos @Async que no tienen sesión JPA por defecto.
    @PersistenceContext
    private EntityManager em;

    /**
     * Período de repetición de vuelos (ms).
     * Todos los vuelos del dataset académico TASF.B2B son diarios.
     * Extraemos la constante para que sea documentable y testeable;
     * un futuro upgrade puede leer la frecuencia por vuelo desde la BD.
     */
    static final long PERIODO_DIARIO_MS = 24L * 60 * 60 * 1000;

    // Volatile para asegurar visibilidad entre hilos sin bloquear findBestRoute
    private volatile Map<String, List<Vuelo>> graph;

    public NetworkAdapterImpl(VueloRepository repo, BloqueoService bloqueoService) {
        this.repo = repo;
        this.bloqueoService = bloqueoService;
    }

    private Map<String, List<Vuelo>> getGraph() {
        if (graph == null) {
            synchronized (this) {
                if (graph == null) {
                    // JOIN FETCH garantiza que origen y destino se cargan EAGERLY
                    // dentro de la misma query, evitando proxies sin sesión.
                    // Funciona tanto en hilos HTTP como en hilos @Async.
                    @SuppressWarnings("unchecked")
                    List<Vuelo> vuelos = em.createQuery(
                            "SELECT DISTINCT v FROM Vuelo v " +
                            "LEFT JOIN FETCH v.origen " +
                            "LEFT JOIN FETCH v.destino"
                    ).getResultList();

                    Map<String, List<Vuelo>> tempGraph = new HashMap<>();
                    for (Vuelo v : vuelos) {
                        tempGraph.computeIfAbsent(
                                v.getOrigen().getIcaoCode(),
                                k -> new ArrayList<>()
                        ).add(v);
                    }
                    graph = Map.copyOf(tempGraph); // Grafo inmutable
                }
            }
        }
        return graph;
    }

    @Override
    public List<Vuelo> findBestRoute(Aeropuerto origen, Aeropuerto destino, SuperLot lot) {
        return calcularRuta(origen, destino, lot.getReadyTime(),
                Collections.emptySet(), Collections.emptyMap());
    }

    @Override
    public List<Vuelo> findBestRoute(Aeropuerto origen, Aeropuerto destino,
                                     SuperLot lot, Map<Long, Integer> remainingCap) {
        // Dijkstra consciente de capacidad: filtra vuelos sin espacio disponible.
        return calcularRuta(origen, destino, lot.getReadyTime(),
                Collections.emptySet(), remainingCap);
    }

    @Override
    public List<Vuelo> findAlternativeRoute(Aeropuerto origen,
                                             Aeropuerto destino,
                                             SuperLot lot,
                                             Set<Long> excludedFlightIds) {
        return calcularRuta(origen, destino, lot.getReadyTime(),
                excludedFlightIds, Collections.emptyMap());
    }

    @Override
    public void invalidateGraph() {
        synchronized (this) {
            graph = null;
        }
    }

    // ─────────────────────────────────────────────────────────
    // NÚCLEO: Dijkstra con exclusión de vuelos y bloqueos
    // ─────────────────────────────────────────────────────────
    private List<Vuelo> calcularRuta(Aeropuerto origen,
                                     Aeropuerto destino,
                                     long startTime,
                                     Set<Long> excludedFlightIds,
                                     Map<Long, Integer> remainingCap) {

        Map<String, List<Vuelo>> localGraph = getGraph();
        String destIcao = destino.getIcaoCode();

        PriorityQueue<Node> pq = new PriorityQueue<>(Comparator.comparingLong(n -> n.time));
        Map<String, Long> bestTime = new HashMap<>();
        Map<String, Vuelo> prevFlight = new HashMap<>();

        pq.add(new Node(origen.getIcaoCode(), startTime));
        bestTime.put(origen.getIcaoCode(), startTime);

        while (!pq.isEmpty()) {
            Node current = pq.poll();

            if (current.time > bestTime.getOrDefault(current.airport, Long.MAX_VALUE)) continue;
            if (current.airport.equals(destIcao)) break;

            // B06: Si el nodo origen actual está bloqueado, no se puede salir de él
            Instant momentCurrent = Instant.ofEpochMilli(current.time);
            if (bloqueoService.nodoEstaBloqueado(current.airport, momentCurrent)) {
                continue;
            }

            for (Vuelo v : localGraph.getOrDefault(current.airport, List.of())) {
                if (Boolean.TRUE.equals(v.getCancelled())) continue;
                if (excludedFlightIds.contains(v.getId())) continue;

                // B05: Si el tramo origen->destino está bloqueado en el momento de salida
                String orig = v.getOrigen().getIcaoCode();
                String dest = v.getDestino().getIcaoCode();
                if (bloqueoService.tramoEstaBloqueado(orig, dest, momentCurrent)) {
                    continue;
                }

                // B06: Si el nodo de destino está bloqueado, no se puede aterrizar en él
                long wait = calcularEsperaMatematica(current.time, v);
                long duration = v.getDuracionMs();
                
                // B09: Avería Tipo 3 - Demora de tránsito (duplica el tiempo de tránsito)
                if (bloqueoService.tieneDemoraTransito(orig, dest, momentCurrent)) {
                    duration *= 2;
                }

                long arrTime = current.time + wait + duration;
                if (bloqueoService.nodoEstaBloqueado(dest, Instant.ofEpochMilli(arrTime))) {
                    continue;
                }

                if (!remainingCap.isEmpty()) {
                    int capRestante = remainingCap.getOrDefault(v.getId(), v.getCapacidadTotal());
                    if (capRestante <= 0) continue;
                }

                long newTime = current.time + wait + duration;
                String next = dest;

                if (newTime < bestTime.getOrDefault(next, Long.MAX_VALUE)) {
                    bestTime.put(next, newTime);
                    prevFlight.put(next, v);
                    pq.add(new Node(next, newTime));
                }
            }
        }

        return reconstruirRuta(prevFlight, origen.getIcaoCode(), destIcao);
    }

    private long calcularEsperaMatematica(long currentTime, Vuelo v) {
        long dep = v.getDepartureEpoch(0L);
        if (currentTime <= dep) return dep - currentTime;

        // Aritmética modular: calcula cuánto falta para el próximo ciclo del vuelo.
        // PERIODO_DIARIO_MS es configurable (campo estático documentado = 24h).
        // Asunción académica: todos los vuelos del dataset TASF.B2B son diarios.
        // Un upgrade futuro leería v.getFrecuenciaDias() para vuelos no-diarios.
        long diff = currentTime - dep;
        long saltosNecesarios = (diff / PERIODO_DIARIO_MS) + 1;
        return (dep + (saltosNecesarios * PERIODO_DIARIO_MS)) - currentTime;
    }

    private List<Vuelo> reconstruirRuta(Map<String, Vuelo> prev, String origen, String destino) {
        LinkedList<Vuelo> path = new LinkedList<>();
        String curr = destino;

        while (curr != null && !curr.equals(origen)) {
            Vuelo v = prev.get(curr);
            if (v == null) return List.of();
            path.addFirst(v); // Más eficiente en LinkedList que add(0, v)
            curr = v.getOrigen().getIcaoCode();
        }
        return path;
    }

    private static record Node(String airport, long time) {}
}
