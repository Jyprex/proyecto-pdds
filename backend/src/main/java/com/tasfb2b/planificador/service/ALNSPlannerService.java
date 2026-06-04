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
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Implementación del algoritmo Adaptive Large Neighborhood Search (ALNS)
 * para la planificación y replanificación de rutas logísticas en TASF.B2B.
 */
@Service
@RequiredArgsConstructor
@Slf4j
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

    private record EvaluationResult(double fitness, SimulationState state) {}

    /**
     * Planificación completa desde cero sobre todos los SuperLots.
     */
    public Solution plan(List<SuperLot> lots, long windowMs) {
        return plan(lots, windowMs, new HashMap<>(), new HashMap<>());
    }

    /**
     * Planificación consciente del estado actual de la red (State-Aware).
     * Evita el double-booking al respetar capacidades ya consumidas.
     */
    public Solution plan(List<SuperLot> lots, long windowMs,
                         Map<Long, Integer> baseFlightCapacity,
                         Map<String, Integer> baseAirportLoad) {
        if (lots.isEmpty()) return emptySolution();

        Map<String, Aeropuerto> airportMap = loadAirportMap();
        Random rng = new Random();

        List<Route> currentRoutes = buildInitialSolution(lots, airportMap, baseAirportLoad, baseFlightCapacity);
        return runAlns(currentRoutes, airportMap, rng, windowMs, null, baseFlightCapacity, baseAirportLoad);
    }

    public Solution replanificar(Long vueloIdCancelado, long windowMs) {
        Solution sol = doReplan(vueloIdCancelado, windowMs);
        sessionHolder.store(sol);
        return sol;
    }

    Solution doReplan(Long vueloIdCancelado, long windowMs) {
        if (!sessionHolder.hasSolution()) {
            throw new IllegalStateException("No hay planificación activa.");
        }
        return doReplan(sessionHolder.get(), vueloIdCancelado, windowMs);
    }

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
            if (usoVueloCancelado) afectados.add(r.getLot());
            else rutasNoAfectadas.add(r);
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

        return runAlns(partialRoutes, airportMap, rng, windowMs, vueloIdCancelado, new HashMap<>(), new HashMap<>());
    }

    private Solution runAlns(List<Route> initialRoutes,
                             Map<String, Aeropuerto> airportMap,
                             Random rng, long windowMs,
                             Long vueloIdCancelado,
                             Map<Long, Integer> baseFlightCapacity,
                             Map<String, Integer> baseAirportLoad) {

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
        int surrogatePasses = 0;
        int acceptanceCount = 0;
        int simulationCalls = 0;
        
        long totalDestroyNanos = 0;
        long totalRepairNanos = 0;
        long totalSimNanos = 0;
        long totalEvalNanos = 0;

        boolean primeraIteracion = (vueloIdCancelado != null);

        if (iterState != null) tracker.setSaturationLevel(computeSaturationLevel(iterState, airportMap));

        while (System.currentTimeMillis() - start < windowMs) {
            int q = Math.max(1, (int) (current.size() * DESTROY_FRACTION));
            List<Route> candidatePartial = new ArrayList<>(current);

            DestroyOperator dOp;
            if (primeraIteracion) { dOp = destroyOps.get(0); tracker.forceDestroy(0); primeraIteracion = false; }
            else { dOp = tracker.selectDestroy(rng); }
            RepairOperator rOp = tracker.selectRepair(rng);

            long tD0 = System.nanoTime();
            List<SuperLot> removed = dOp.destroy(candidatePartial, q, rng);
            totalDestroyNanos += (System.nanoTime() - tD0);
            
            Map<Long, Integer> capacidadDisponible = buildCapacidadDisponible(candidatePartial, baseFlightCapacity);
            
            long tR0 = System.nanoTime();
            List<Route> candidate = rOp.repair(candidatePartial, removed, airportMap, capacidadDisponible);
            totalRepairNanos += (System.nanoTime() - tR0);
            
            resolverConflictosCapacidad(candidate, baseFlightCapacity);

            long tE0 = System.nanoTime();
            double candidateRouteFitness = fitnessEval.evaluateRoutes(candidate, start);
            double currentRouteFitness = fitnessEval.evaluateRoutes(current, start);
            double approxDelta = candidateRouteFitness - currentRouteFitness;
            
            boolean surrogateAccepted = approxDelta > 0 || acceptarSA(approxDelta, temp, rng);
            totalEvalNanos += (System.nanoTime() - tE0);

            double reward = AdaptiveWeightTracker.REWARD_REJECT;
            boolean moveAccepted = false;

            if (surrogateAccepted) {
                surrogatePasses++;
                long tS0 = System.nanoTime();
                SimulationState candidateState = simulator.run(candidate, airportMap, start, start);
                simulationCalls++;
                totalSimNanos += (System.nanoTime() - tS0);
                
                long tE1 = System.nanoTime();
                double candidateFitness = candidateRouteFitness + fitnessEval.evaluateState(candidateState);
                totalEvalNanos += (System.nanoTime() - tE1);
                
                double realDelta = candidateFitness - currentFitness;

                if (realDelta > 0 || acceptarSA(realDelta, temp, rng)) {
                    current = candidate; currentFitness = candidateFitness; iterState = candidateState;
                    reward = realDelta > 0 ? AdaptiveWeightTracker.REWARD_IMPROVE : AdaptiveWeightTracker.REWARD_ACCEPT;
                    moveAccepted = true; acceptanceCount++;
                }

                if (candidateFitness > bestFitness) {
                    best = new ArrayList<>(candidate); bestFitness = candidateFitness;
                    reward = AdaptiveWeightTracker.REWARD_GLOBAL_BEST;
                }
            }

            if (!moveAccepted) {
                List<Route> rejected = new ArrayList<>(candidate);
                rejected.removeAll(candidatePartial);
                for (Route r : rejected) com.tasfb2b.planificador.domain.RoutePool.recycle(r);
            }

            tracker.update(reward);
            temp *= COOLING_FACTOR;
            if (iterState != null) tracker.setSaturationLevel(computeSaturationLevel(iterState, airportMap));

            iter++;
            if (iter % SEGMENT_SIZE == 0) tracker.normalizeWeights();
        }
        
        return buildSolution(best, airportMap, start);
    }

    private List<Route> buildInitialSolution(List<SuperLot> lots, 
                                             Map<String, Aeropuerto> airportMap,
                                             Map<String, Integer> baseAirportLoad,
                                             Map<Long, Integer> baseFlightCapacity) {
        return lots.stream()
                .sorted(Comparator.comparingLong(SuperLot::getDeadline))
                .map(lot -> routeBuilder.build(lot, airportMap, baseAirportLoad, baseFlightCapacity))
                .collect(Collectors.toList());
    }

    private void resolverConflictosCapacidad(List<Route> routes, Map<Long, Integer> baseFlightCapacity) {
        Map<Long, Integer> cap = new HashMap<>(baseFlightCapacity);
        for (Route r : routes) {
            for (Vuelo v : r.getFlights()) cap.putIfAbsent(v.getId(), v.getCapacidadTotal());
        }

        routes.sort(Comparator.comparingLong((Route r) -> r.getLot().getDeadline())
                .thenComparingInt(r -> -r.getLot().getPriority()));

        for (Route r : routes) {
            if (r.getFlights().isEmpty()) continue;
            int capacidadRuta = r.getFlights().stream().mapToInt(v -> cap.getOrDefault(v.getId(), 0)).min().orElse(0);
            int asignar = Math.min(r.getDemandaTotal(), capacidadRuta);
            r.setCapacidadAsignada(asignar);
            for (Vuelo v : r.getFlights()) cap.merge(v.getId(), -asignar, Integer::sum);
        }
    }

    private Map<Long, Integer> buildCapacidadDisponible(List<Route> routes, Map<Long, Integer> baseFlightCapacity) {
        Map<Long, Integer> cap = new HashMap<>(baseFlightCapacity);
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
        return aeropuertoRepo.findAll().stream().collect(Collectors.toMap(Aeropuerto::getIcaoCode, a -> a));
    }

    private double computeSaturationLevel(SimulationState state, Map<String, Aeropuerto> airportMap) {
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

    private Solution buildSolution(List<Route> routes, Map<String, Aeropuerto> airportMap, long startTime) {
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
