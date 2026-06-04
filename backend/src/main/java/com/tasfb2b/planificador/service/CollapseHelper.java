package com.tasfb2b.planificador.service;

import com.tasfb2b.aeropuerto.domain.Aeropuerto;
import com.tasfb2b.planificador.domain.CollapseEndCondition;
import com.tasfb2b.planificador.domain.Route;
import com.tasfb2b.planificador.domain.SimulationDayReport;
import com.tasfb2b.planificador.domain.Solution;
import com.tasfb2b.planificador.simulation.SimulationState;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;

/**
 * Delegado que encapsula toda la lógica de inyección de colapso
 * y verificación de condiciones de terminación.
 *
 * <p>Extraído de SimulationService para mantener la clase principal manejable.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class CollapseHelper {

    private final ALNSPlannerService alnsPlanner;

    @Qualifier("replanExecutor")
    private final Executor replanExecutor;

    /** Ventana de ALNS para cada replan en modo colapso (ms). */
    private static final long REPLAN_WINDOW_MS = 500L;

    @Value("${tasf.sim.collapse.slaThreshold:30.0}")
    private double collapseSlaThreshold;

    @Value("${tasf.sim.collapse.consecutiveDays:2}")
    private int collapseConsecutiveDays;

    /**
     * Aplica inyecciones de cancelación del modo colapso con replanificación PARALELA.
     *
     * @param session   estado de la sesión (para stressFactor)
     * @param routes    rutas del ciclo actual
     * @param algorithm algoritmo en uso ("HGA"/"ALNS")
     * @return número de rutas rescatadas
     */
    public int applyCollapseInjections(
            SimulationProgressHolder.SimulationSessionState session,
            List<Route> routes,
            String algorithm) {

        if (routes == null || routes.isEmpty()) return 0;

        double cancelFraction = session.getStressFactor() * 0.03;
        int cancelCount = (int) Math.max(1, routes.size() * cancelFraction);
        log.info("[Colapso] Estrés ×{} → cancelando {} rutas ({} %)",
                session.getStressFactor(), cancelCount,
                Math.round(cancelFraction * 100));

        List<Route> rutasModificables = new ArrayList<>(routes);
        Collections.shuffle(rutasModificables);

        // Recolectar vueloIds únicos a cancelar
        Set<Long> uniqueVueloIds = new LinkedHashSet<>();
        for (int i = 0; i < cancelCount && i < rutasModificables.size(); i++) {
            Route r = rutasModificables.get(i);
            if (!r.getFlights().isEmpty()) {
                uniqueVueloIds.add(r.getFlights().get(0).getId());
            }
        }

        if (!"alns".equalsIgnoreCase(algorithm) || uniqueVueloIds.isEmpty()) {
            markCancelled(rutasModificables, cancelCount, Collections.emptySet());
            return 0;
        }

        // Ventana dinámica: menos tiempo por replan si hay muchos vuelos
        long calculatedWindow = Math.max(100L, 10000L / uniqueVueloIds.size());
        final long dynamicWindowMs = Math.min(calculatedWindow, REPLAN_WINDOW_MS);

        // Lanzar replans en PARALELO con replanExecutor
        List<CompletableFuture<Set<Long>>> futures = new ArrayList<>(uniqueVueloIds.size());
        for (Long vueloId : uniqueVueloIds) {
            CompletableFuture<Set<Long>> f = CompletableFuture
                    .supplyAsync(() -> {
                        try {
                            Solution replanned = alnsPlanner.replanificar(vueloId, dynamicWindowMs);
                            if (replanned != null && !replanned.getRoutes().isEmpty()) {
                                return Set.of(vueloId);
                            }
                        } catch (Exception ex) {
                            log.warn("Fallo en replan ALNS para vuelo {}: {}", vueloId, ex.getMessage());
                        }
                        return Collections.<Long>emptySet();
                    }, replanExecutor);
            futures.add(f);
        }

        // Esperar todos y unir los vueloIds rescatados
        Set<Long> rescuedVueloIds = new HashSet<>();
        for (CompletableFuture<Set<Long>> f : futures) {
            rescuedVueloIds.addAll(f.join());
        }

        markCancelled(rutasModificables, cancelCount, rescuedVueloIds);

        // Conteo de rutas efectivamente rescatadas
        int rescued = 0;
        for (int i = 0; i < cancelCount && i < rutasModificables.size(); i++) {
            if ("rescued".equals(rutasModificables.get(i).getStatus())) {
                rescued++;
            }
        }
        return rescued;
    }

    /**
     * Reduce la capacidad de almacenamiento de aeropuertos hub para simular estrés.
     * Solo se aplica UNA VEZ al inicio del modo colapso.
     */
    public void reduceHubCapacity(Map<String, Aeropuerto> airportMap) {
        for (String hub : Arrays.asList("SKBO", "LEMD", "VIDP")) {
            Aeropuerto a = airportMap.get(hub);
            if (a != null) a.setStorageCapacity(a.getStorageCapacity() / 2);
        }
    }

    /**
     * Evalúa la condición de terminación del modo colapso al fin de un día simulado.
     */
    public record CollapseCheckResult(boolean terminated, String reason) {}

    public CollapseCheckResult checkEndCondition(
            SimulationProgressHolder.SimulationSessionState session,
            SimulationDayReport report,
            SimulationState endOfDayState,
            Map<String, Aeropuerto> airportMap) {

        return switch (session.getEndCondition()) {
            case SLA_BELOW_THRESHOLD -> {
                int streak = report.getSlaPercent() < collapseSlaThreshold
                        ? session.getSlaStreak() + 1 : 0;
                session.setSlaStreak(streak);
                yield new CollapseCheckResult(
                        streak >= collapseConsecutiveDays,
                        String.format("SLA < %.1f%% por %d días consecutivos (actual %.1f%%)",
                                collapseSlaThreshold, collapseConsecutiveDays, report.getSlaPercent()));
            }
            case ALL_AIRPORTS_CRITICAL -> {
                final int total = airportMap.size();
                long critical = airportMap.keySet().stream()
                        .filter(icao -> endOfDayState.getOccupancyPercent(icao, airportMap) >= 90)
                        .count();
                yield new CollapseCheckResult(
                        critical >= total,
                        String.format("Todos los aeropuertos críticos (%d/%d)", critical, total));
            }
            case NONE -> new CollapseCheckResult(false, "NONE");
        };
    }

    private void markCancelled(List<Route> rutasModificables,
                               int cancelCount,
                               Set<Long> rescuedVueloIds) {
        for (int i = 0; i < cancelCount && i < rutasModificables.size(); i++) {
            Route r = rutasModificables.get(i);
            if (!r.getFlights().isEmpty()
                    && rescuedVueloIds.contains(r.getFlights().get(0).getId())) {
                r.setStatus("rescued");
            } else {
                r.setStatus("cancelled");
                r.setCapacidadAsignada(0);
            }
        }
    }
}
