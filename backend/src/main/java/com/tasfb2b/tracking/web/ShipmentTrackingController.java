package com.tasfb2b.tracking.web;

import com.tasfb2b.tracking.service.ShipmentTracker;
import com.tasfb2b.tracking.domain.ShipmentState;
import com.tasfb2b.tracking.service.ShipmentTrackerRegistry;
import com.tasfb2b.planificador.simulation.EventEngine;
import com.tasfb2b.tracking.domain.ShipmentStatus;
import org.springframework.web.bind.annotation.*;
import lombok.RequiredArgsConstructor;

import java.util.Collection;
import java.util.List;
import java.util.HashMap;
import java.util.Map;
import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/shipments")
@RequiredArgsConstructor
public class ShipmentTrackingController {

    private final ShipmentTrackerRegistry trackerRegistry;

    @GetMapping("/{sessionId}/bag/{bagId}")
    public ShipmentState getByBagId(@PathVariable String sessionId,@PathVariable String bagId) {
        ShipmentTracker tracker = trackerRegistry.get(sessionId);
        return tracker != null ? tracker.getBag(bagId) : null;
    }

    @GetMapping("/{sessionId}/shipment/{codigo}")
    public List<ShipmentState> getByShipment(@PathVariable String sessionId,@PathVariable String codigo) {
        ShipmentTracker tracker = trackerRegistry.get(sessionId);
        return tracker != null ? tracker.getByShipment(codigo) : List.of();
    }

    @GetMapping("/{sessionId}/flight-instance/{instanceKey}")
    public List<ShipmentState> getByFlightInstance(@PathVariable String sessionId, @PathVariable String instanceKey) {
        ShipmentTracker tracker = trackerRegistry.get(sessionId);
        List<ShipmentState> result = tracker != null ? tracker.getByFlightInstance(instanceKey) : List.of();

        if (instanceKey.startsWith(EventEngine.DEBUG_VUELO_ID + "-")) {
            System.out.println(String.format(
                    "[CONTROLLER] sessionId=%s instanceKey=%s resultados=%d",
                    sessionId, instanceKey, result.size()
            ));
        }
        return result;
    }

    @GetMapping("/{sessionId}/airport/{icao}")
    public List<ShipmentState> getByAirport(@PathVariable String sessionId,@PathVariable String icao) {
        ShipmentTracker tracker = trackerRegistry.get(sessionId);
        return tracker != null ? tracker.getByAirport(icao) : List.of();
    }

    @GetMapping("/{sessionId}")
    public Collection<ShipmentState> getAll(@PathVariable String sessionId) {
        ShipmentTracker tracker = trackerRegistry.get(sessionId);
        return tracker != null ? tracker.getAll() : List.of();
    }

    @DeleteMapping("/{sessionId}")
    public void clearSession(@PathVariable String sessionId) {
        trackerRegistry.remove(sessionId);
    }

    @PostMapping("/{sessionId}/status-batch")
    public Map<String, List<ShipmentState>> getStatusBatch(
            @PathVariable String sessionId,
            @RequestBody List<String> codigos) {
        ShipmentTracker tracker = trackerRegistry.get(sessionId);
        if (tracker == null) return Map.of();

        Map<String, List<ShipmentState>> result = new HashMap<>();
        for (String codigo : codigos) {
            result.put(codigo, tracker.getByShipment(codigo));
        }
        return result;
    }

    @GetMapping("/{sessionId}/bag/{bagId}/hops")
    public List<ShipmentTracker.HopInfo> getBagHops(@PathVariable String sessionId, @PathVariable String bagId) {
        ShipmentTracker tracker = trackerRegistry.get(sessionId);
        return tracker != null ? tracker.getHops(bagId) : List.of();
    }

    @GetMapping("/{sessionId}/shipment/{codigo}/hops")
    public Map<String, List<ShipmentTracker.HopInfo>> getShipmentHops(@PathVariable String sessionId, @PathVariable String codigo) {
        ShipmentTracker tracker = trackerRegistry.get(sessionId);
        return tracker != null ? tracker.getShipmentHops(codigo) : Map.of();
    }



    @GetMapping("/{sessionId}/codes-by-status/{status}")
    public List<String> getCodesByStatus(@PathVariable String sessionId, @PathVariable String status) {
        ShipmentTracker tracker = trackerRegistry.get(sessionId);
        if (tracker == null) return List.of();
        try {
            com.tasfb2b.tracking.domain.ShipmentStatus s =
                    com.tasfb2b.tracking.domain.ShipmentStatus.valueOf(status);
            return tracker.getAll().stream()
                    .filter(b -> b.getEstado() == s)
                    .map(b -> b.getShipmentCode())
                    .distinct().sorted()
                    .collect(java.util.stream.Collectors.toList());
        } catch (IllegalArgumentException e) { return List.of(); }
    }

    /** Planificación por aeropuerto — SOLO maletas YA registradas en almacén
     *  origen/intermedio de este aeropuerto, con su cadena de hops RESTANTE
     *  desde este punto (no el historial ya volado). El histórico completo
     *  de cada envío sigue disponible en el panel de envíos vía getHops(). */
    @GetMapping("/{sessionId}/airport-plan/{icao}")
    public Map<String, Object> getAirportPlan(@PathVariable String sessionId, @PathVariable String icao) {
        ShipmentTracker tracker = trackerRegistry.get(sessionId);
        String icaoUpper = icao.toUpperCase();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("icao", icaoUpper);

        if (tracker == null) {
            result.put("bags", List.of());
            result.put("totalBags", 0);
            return result;
        }

        List<Map<String, Object>> bagsOut = new ArrayList<>();
        for (ShipmentState s : tracker.getByAirport(icaoUpper)) {
            // Solo origen e intermedio tienen "próximo vuelo" que mostrar.
            if (s.getEstado() == ShipmentStatus.EN_ALMACEN_DESTINO) continue;

            List<ShipmentTracker.HopInfo> allHops = tracker.getHops(s.getBagId());
            // Recorta al primer hop cuyo ORIGEN coincide con la posición actual
            // de la maleta — así en un almacén intermedio no se repite el
            // tramo ya volado, solo lo que falta por delante.
            List<ShipmentTracker.HopInfo> remaining = new ArrayList<>();
            boolean started = false;
            for (ShipmentTracker.HopInfo hop : allHops) {
                if (!started && icaoUpper.equals(hop.origenIcao())) started = true;
                if (started) remaining.add(hop);
            }

            Map<String, Object> bagOut = new LinkedHashMap<>();
            bagOut.put("bagId", s.getBagId());
            bagOut.put("shipmentCode", s.getShipmentCode());
            bagOut.put("estado", s.getEstado().name());
            bagOut.put("remainingHops", remaining.stream().map(h -> {
                Map<String, Object> hm = new LinkedHashMap<>();
                hm.put("vueloId", h.vueloId());
                hm.put("from", h.origenIcao());
                hm.put("to", h.destinoIcao());
                hm.put("departureTime", h.departureTime());
                hm.put("arrivalTime", h.arrivalTime());
                return hm;
            }).collect(Collectors.toList()));
            bagsOut.add(bagOut);
        }

        bagsOut.sort(Comparator.comparing(b -> (String) b.get("shipmentCode")));

        result.put("bags", bagsOut);
        result.put("totalBags", bagsOut.size());
        return result;
    }

}