package com.tasfb2b.planificador.service;

/*
 * Sistema TASF.B2B — Motor de Optimización Logística
 * Grupo 4D — Curso de Proyecto de Diseño de Software
 * Autores: Jim Navarrete, Diego Silvestre, Jose Avalos, Mathias Medina
 * Fecha: Mayo 2026
 */

import com.tasfb2b.aeropuerto.domain.Aeropuerto;
import com.tasfb2b.aeropuerto.repository.AeropuertoRepository;
import com.tasfb2b.planificador.alns.AdaptiveWeightTracker;
import com.tasfb2b.planificador.alns.operator.*;
import com.tasfb2b.planificador.domain.Route;
import com.tasfb2b.planificador.domain.Solution;
import com.tasfb2b.planificador.simulation.SimulationRunner;
import com.tasfb2b.planificador.simulation.SimulationState;
import com.tasfb2b.superlote.domain.SuperLot;
import com.tasfb2b.vuelo.domain.Vuelo;
import com.tasfb2b.vuelo.repository.VueloRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Implementación del algoritmo Adaptive Large Neighborhood Search (ALNS)
 * para la planificación y replanificación de rutas logísticas en TASF.B2B.
 *
 * <p>Soporta tres modos de operación:
 * <ul>
 *   <li>{@link #plan}: planificación desde cero, usada en experimentación numérica.</li>
 *   <li>{@link #replanificar}: replanificación operativa ante cancelación manual de vuelo,
 *       con warm-start sobre backup routes. Persiste la solución en {@link PlanningSessionHolder}.</li>
 *   <li>{@link #doReplan}: variante sin side-effect, usada por el modo colapso
 *       (PLAN_PERF_COLAPSO.md) para replanificar en paralelo sin race en el holder.</li>
 * </ul>
 *
 * <p>Parámetros del algoritmo:
 * <ul>
 *   <li>INITIAL_TEMP_FACTOR = 0.05</li>
 *   <li>COOLING_FACTOR = 0.997</li>
 *   <li>SEGMENT_SIZE = 100 iteraciones</li>
 *   <li>DESTROY_FRACTION = 0.20</li>
 * </ul>
 */
@Service
@RequiredArgsConstructor
public class ALNSPlannerService {

    private final RouteBuilder          routeBuilder;
    private final FitnessEvaluator      fitnessEval;
    private final AeropuertoRepository  aeropuertoRepo;
    private final SimulationRunner      simulator;
    private final PlanningSessionHolder sessionHolder;
    private final VueloRepository       vueloRepo;

    private static final double INITIAL_TEMP_FACTOR = 0.05;
    private static final double COOLING_FACTOR      = 0.997;
    private static final int    SEGMENT_SIZE        = 100;
    private static final double DESTROY_FRACTION    = 0.20;

    /** Resultado de una evaluación: fitness + state, para evitar el campo compartido lastSimState. */
    private record EvaluationResult(double fitness, SimulationState state) {}

    /**
     * Planificación completa desde cero sobre todos los SuperLots.
     * Equivalente al escenario TIEMPO_REAL para comparación con HGA.
     *
     * @param lots     lotes a planificar
     * @param windowMs ventana de tiempo máxima en milisegundos
     * @return solución optimizada
     */
    public Solution plan(List<SuperLot> lots, long windowMs) {
        if (lots.isEmpty()) return emptySolution();

        Map<String, Aeropuerto> airportMap = loadAirportMap();
        Random rng = new Random();

        List<Route> currentRoutes = buildInitialSolution(lots, airportMap);
        return runAlns(currentRoutes, airportMap, rng, windowMs, null);
    }

    /**
     * Replanifica únicamente los lotes afectados por la cancelación de un vuelo.
     * Usa warm-start con backup routes del HGA para respuesta operativa inmediata.
     * Persiste la solución resultante en {@link PlanningSessionHolder}.
     *
     * @param vueloIdCancelado ID del vuelo cancelado
     * @param windowMs         ventana de tiempo para el ciclo ALNS
     * @return solución actualizada
     */
    public Solution replanificar(Long vueloIdCancelado, long windowMs) {
        Solution sol = doReplan(vueloIdCancelado, windowMs);
        sessionHolder.store(sol);
        return sol;
    }

    /**
     * Variante sin side-effect de {@link #replanificar}, paralela-segura.
     * Usada por el modo colapso (ver PLANES/PLAN_PERF_COLAPSO.md) donde múltiples
     * replans corren en paralelo y no deben competir por escribir en
     * {@link PlanningSessionHolder} (race last-write-wins).
     *
     * @param vueloIdCancelado ID del vuelo cancelado
     * @param windowMs         ventana de tiempo para el ciclo ALNS
     * @return solución calculada, sin persistir en el holder
     */
    Solution doReplan(Long vueloIdCancelado, long windowMs) {
        if (!sessionHolder.hasSolution()) {
            throw new IllegalStateException(
                    "No hay planificación activa. Ejecute /planificador/ejecutar primero.");
        }
        return doReplan(sessionHolder.get(), vueloIdCancelado, windowMs);
    }

    /**
     * Variante que acepta la solución vigente por parámetro. 
     * Ideal para simulaciones en paralelo donde no se depende de sessionHolder.
     */
    public Solution doReplan(Solution current, Long vueloIdCancelado, long windowMs) {
        Map<String, Aeropuerto> airportMap = loadAirportMap();
        Random rng = new Random();

        List<Route> rutasActuales    = new ArrayList<>(current.getRoutes());
        List<Route> rutasNoAfectadas = new ArrayList<>();
        List<SuperLot> afectados     = new ArrayList<>();
        List<SuperLot> sinBackup     = new ArrayList<>();

        for (Route r : rutasActuales) {
            boolean usoVueloCancelado = r.getFlights().stream()
                    .anyMatch(v -> vueloIdCancelado.equals(v.getId()));
            if (usoVueloCancelado) {
                afectados.add(r.getLot());
            } else {
                rutasNoAfectadas.add(r);
            }
        }

        for (SuperLot lot : afectados) {
            Map<Integer, Route> backups = current.getBackupRoutes();
            Route backup = backups != null ? backups.get(lot.getId()) : null;
            if (backup != null && backup.isFeasibleArrival() && !usaVuelo(backup, vueloIdCancelado)) {
                rutasNoAfectadas.add(backup);
            } else {
                sinBackup.add(lot);
            }
        }

        if (sinBackup.isEmpty()) {
            return buildSolution(rutasNoAfectadas, airportMap, System.currentTimeMillis());
        }

        List<Route> partialRoutes = new ArrayList<>(rutasNoAfectadas);
        for (SuperLot lot : sinBackup) {
            partialRoutes.add(routeBuilder.build(lot, airportMap, new HashMap<>(), new HashMap<>()));
        }

        return runAlns(partialRoutes, airportMap, rng, windowMs, vueloIdCancelado);
    }

    private Solution runAlns(List<Route> initialRoutes,
                             Map<String, Aeropuerto> airportMap,
                             Random rng, long windowMs,
                             Long vueloIdCancelado) {

        long start = System.currentTimeMillis();

        List<DestroyOperator> destroyOps = buildDestroyOps(vueloIdCancelado);
        List<RepairOperator>  repairOps  = buildRepairOps();
        AdaptiveWeightTracker tracker    = new AdaptiveWeightTracker(destroyOps, repairOps);

        List<Route> current = new ArrayList<>(initialRoutes);
        List<Route> best    = new ArrayList<>(current);

        EvaluationResult initial = evalFitness(current, airportMap, start);
        double currentFitness = initial.fitness();
        SimulationState iterState = initial.state();
        double bestFitness    = currentFitness;
        double temp           = Math.max(1.0, INITIAL_TEMP_FACTOR * Math.abs(currentFitness));

        int iter = 0;
        boolean primeraIteracion = (vueloIdCancelado != null);

        // Saturación inicial del tracker
        if (iterState != null) {
            tracker.setSaturationLevel(computeSaturationLevel(iterState, airportMap));
        }

        while (System.currentTimeMillis() - start < windowMs) {
            int q = Math.max(1, (int) (current.size() * DESTROY_FRACTION));

            List<Route> candidatePartial = new ArrayList<>(current);

            DestroyOperator dOp;
            if (primeraIteracion) {
                dOp = destroyOps.get(0);
                tracker.forceDestroy(0);
                primeraIteracion = false;
            } else {
                dOp = tracker.selectDestroy(rng);
            }
            RepairOperator rOp = tracker.selectRepair(rng);

            // Destruir modifica candidatePartial (remueve rutas) y devuelve los lotes removidos.
            List<SuperLot> removed = dOp.destroy(candidatePartial, q, rng);
            
            // Las rutas viejas removidas pueden ser recicladas
            List<Route> rutasViejas = new ArrayList<>(current);
            rutasViejas.removeAll(candidatePartial);
            
            Map<Long, Integer> capacidadDisponible = buildCapacidadDisponible(candidatePartial);
            
            // Reparan: devuelve la lista completa (candidatePartial + nuevas rutas)
            List<Route> candidate = rOp.repair(candidatePartial, removed, airportMap, capacidadDisponible);
            resolverConflictosCapacidad(candidate);

            // ── FASE 3: SURROGATE DELTA FITNESS ──
            // Evaluamos solo el fitness de las rutas (O(1) por ruta) sin simular.
            double candidateRouteFitness = fitnessEval.evaluateRoutes(candidate, start);
            double currentRouteFitness = fitnessEval.evaluateRoutes(current, start);
            
            // Aproximamos el delta asumiendo que el estado global (colas) no cambió drásticamente.
            double approxDelta = candidateRouteFitness - currentRouteFitness;
            
            boolean surrogateAccepted = false;
            if (approxDelta > 0) {
                surrogateAccepted = true;
            } else if (acceptarSA(approxDelta, temp, rng)) {
                surrogateAccepted = true;
            }

            double reward = AdaptiveWeightTracker.REWARD_REJECT;
            boolean moveAccepted = false;

            if (surrogateAccepted) {
                // Solo si pasó el filtro rápido, ejecutamos la simulación pesada O(N log N)
                SimulationState candidateState = simulator.run(candidate, airportMap, start, start);
                double candidateStateFitness = fitnessEval.evaluateState(candidateState);
                double candidateFitness = candidateRouteFitness + candidateStateFitness;
                
                double realDelta = candidateFitness - currentFitness;

                if (realDelta > 0) {
                    current        = candidate;
                    currentFitness = candidateFitness;
                    iterState      = candidateState;
                    reward         = AdaptiveWeightTracker.REWARD_IMPROVE;
                    moveAccepted   = true;
                } else if (acceptarSA(realDelta, temp, rng)) {
                    current        = candidate;
                    currentFitness = candidateFitness;
                    iterState      = candidateState;
                    reward         = AdaptiveWeightTracker.REWARD_ACCEPT;
                    moveAccepted   = true;
                }

                if (candidateFitness > bestFitness) {
                    best        = new ArrayList<>(candidate);
                    bestFitness = candidateFitness;
                    reward      = AdaptiveWeightTracker.REWARD_GLOBAL_BEST;
                }
            }

            if (!moveAccepted) {
                // FASE 5: Reciclar las rutas nuevas creadas en esta iteración que no fueron aceptadas
                List<Route> rutasNuevasRechazadas = new ArrayList<>(candidate);
                rutasNuevasRechazadas.removeAll(candidatePartial);
                for (Route r : rutasNuevasRechazadas) {
                    com.tasfb2b.planificador.domain.RoutePool.recycle(r);
                }
            }

            tracker.update(reward);
            temp *= COOLING_FACTOR;

            // Actualizar nivel de saturación para selección adaptativa
            if (iterState != null) {
                tracker.setSaturationLevel(computeSaturationLevel(iterState, airportMap));
            }

            iter++;
            if (iter % SEGMENT_SIZE == 0) tracker.normalizeWeights();
        }

        return buildSolution(best, airportMap, start);
    }

    private List<Route> buildInitialSolution(List<SuperLot> lots, Map<String, Aeropuerto> airportMap) {
        return lots.stream()
                .sorted(Comparator.comparingLong(SuperLot::getDeadline))
                .map(lot -> routeBuilder.build(lot, airportMap, new HashMap<>(), new HashMap<>()))
                .collect(Collectors.toList());
    }

    /**
     * Resuelve conflictos de capacidad por prioridad descendente.
     * Los lotes con mayor prioridad consumen capacidad de vuelo primero.
     */
    private void resolverConflictosCapacidad(List<Route> routes) {
        Map<Long, Integer> cap = new HashMap<>();
        for (Route r : routes) {
            for (Vuelo v : r.getFlights()) cap.putIfAbsent(v.getId(), v.getCapacidadTotal());
        }

        // EDF (Earliest Deadline First) para maximizar tiempo de colapso
        routes.sort(Comparator.comparingLong((Route r) -> r.getLot().getDeadline())
                .thenComparingInt(r -> -r.getLot().getPriority()));

        for (Route r : routes) {
            if (r.getFlights().isEmpty()) continue;
            int capacidadRuta = r.getFlights().stream()
                    .mapToInt(v -> cap.getOrDefault(v.getId(), 0)).min().orElse(0);
            int asignar = Math.min(r.getDemandaTotal(), capacidadRuta);
            r.setCapacidadAsignada(asignar);
            for (Vuelo v : r.getFlights()) cap.merge(v.getId(), -asignar, Integer::sum);
        }
    }

    /**
     * Construye el mapa de capacidad disponible por vuelo dado el estado actual de rutas.
     *
     * @param routes rutas actuales, posiblemente con asignaciones parciales
     * @return mapa {@code vueloId → capacidad restante}
     */
    private Map<Long, Integer> buildCapacidadDisponible(List<Route> routes) {
        Map<Long, Integer> cap = new HashMap<>();
        for (Route r : routes) {
            for (Vuelo v : r.getFlights()) cap.putIfAbsent(v.getId(), v.getCapacidadTotal());
        }
        for (Route r : routes) {
            int asignado = r.getCapacidadAsignada();
            for (Vuelo v : r.getFlights()) cap.merge(v.getId(), -asignado, Integer::sum);
        }
        return cap;
    }

    private EvaluationResult evalFitness(List<Route> routes, Map<String, Aeropuerto> airportMap, long startTime) {
        if (routes.isEmpty()) return new EvaluationResult(0.0, null);
        SimulationState state = simulator.run(routes, airportMap, startTime, startTime);
        double fitness = fitnessEval.evaluate(routes, state);
        return new EvaluationResult(fitness, state);
    }

    private boolean acceptarSA(double delta, double temp, Random rng) {
        if (temp <= 0) return false;
        return rng.nextDouble() < Math.exp(delta / temp);
    }

    private boolean usaVuelo(Route r, Long vueloId) {
        return r.getFlights().stream().anyMatch(v -> vueloId.equals(v.getId()));
    }

    private Map<String, Aeropuerto> loadAirportMap() {
        return aeropuertoRepo.findAll().stream()
                .collect(Collectors.toMap(Aeropuerto::getIcaoCode, a -> a));
    }

    /**
     * Calcula el nivel máximo de saturación de la red (0.0–1.0).
     * Es el ratio máximo de ocupación de cualquier aeropuerto.
     * Usado para alimentar AdaptiveWeightTracker.setSaturationLevel().
     */
    private double computeSaturationLevel(SimulationState state,
                                          Map<String, Aeropuerto> airportMap) {
        double maxRatio = 0.0;
        for (Map.Entry<String, Integer> entry : state.getCargaAeropuerto().entrySet()) {
            Aeropuerto ap = airportMap.get(entry.getKey());
            if (ap == null || ap.getStorageCapacity() <= 0) continue;
            double ratio = (double) entry.getValue() / ap.getStorageCapacity();
            if (ratio > maxRatio) maxRatio = ratio;
        }
        return Math.min(1.0, maxRatio);
    }

    private List<DestroyOperator> buildDestroyOps(Long vueloIdCancelado) {
        List<DestroyOperator> ops = new ArrayList<>();
        ops.add(new AffectedByFlightDestroyOp(vueloIdCancelado != null ? vueloIdCancelado : -1L));
        ops.add(new WorstDestroyOp());
        ops.add(new RelatedDestroyOp());
        return ops;
    }

    private List<RepairOperator> buildRepairOps() {
        return List.of(new GreedyRepairOp(routeBuilder), new RegretRepairOp(routeBuilder));
    }

    private Solution buildSolution(List<Route> routes,
                                   Map<String, Aeropuerto> airportMap,
                                   long startTime) {
        SimulationState state = simulator.run(routes, airportMap, startTime, startTime);
        double fit = fitnessEval.evaluate(routes, state);

        Solution sol = new Solution();
        sol.setRoutes(routes);
        sol.setFitness(fit);
        sol.setRouteCount(routes.size());
        sol.setRoutesValidas((int) routes.stream().filter(Route::isAtendido).count());
        sol.setRoutesFallidas((int) routes.stream().filter(r -> r.isNoAtendido() || r.isTarde()).count());
        sol.setCollapseTime(state.isColapsado() ? state.getCurrentTime() : -1L);
        return sol;
    }

    private Solution emptySolution() {
        Solution sol = new Solution();
        sol.setRoutes(List.of());
        sol.setFitness(0);
        sol.setRouteCount(0);
        sol.setRoutesValidas(0);
        sol.setRoutesFallidas(0);
        sol.setCollapseTime(-1L);
        return sol;
    }
}
