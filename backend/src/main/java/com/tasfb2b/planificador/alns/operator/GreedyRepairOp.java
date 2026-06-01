package com.tasfb2b.planificador.alns.operator;

import com.tasfb2b.aeropuerto.domain.Aeropuerto;
import com.tasfb2b.planificador.domain.Route;
import com.tasfb2b.planificador.service.RouteBuilder;
import com.tasfb2b.superlote.domain.SuperLot;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Operador de reparación greedy.
 * Ordena los lotes removidos por urgencia (SLA ascendente) y para cada uno
 * reconstruye la mejor ruta usando Dijkstra (RouteBuilder.build).
 * Los vuelos cancelados ya son ignorados automáticamente por NetworkAdapterImpl.
 */
public class GreedyRepairOp implements RepairOperator {

    private final RouteBuilder routeBuilder;

    public GreedyRepairOp(RouteBuilder routeBuilder) {
        this.routeBuilder = routeBuilder;
    }

    @Override
    public List<Route> repair(List<Route> partialRoutes,
                              List<SuperLot> removed,
                              Map<String, Aeropuerto> airportMap,
                              Map<Long, Integer> capacidadDisponible) {

        List<Route> result = new ArrayList<>(partialRoutes);

        // Insertar primero los más urgentes (menor SLA = deadline más próximo).
        // Pasamos capacidadDisponible real: Dijkstra sabrá qué vuelos están llenos.
        // Paralelizar la construcción de rutas para los lotes removidos
        List<Route> repairedRoutes = removed.parallelStream()
                .map(lot -> routeBuilder.build(lot, airportMap, new HashMap<>(), capacidadDisponible))
                .toList();

        // Ordenar las rutas reparadas por SLA y añadirlas
        repairedRoutes.stream()
                .sorted(Comparator.comparingLong((Route r) -> r.getLot().getSla()))
                .forEach(result::add);

        return result;
    }

    @Override
    public String name() {
        return "GreedyRepair";
    }
}
