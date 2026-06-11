package com.tasfb2b.planificador.web;

/*
 * Sistema TASF.B2B — Motor de Optimización Logística
 * Grupo 4D — Curso de Proyecto de Diseño de Software
 * Autores: Jim Navarrete, Diego Silvestre, Jose Avalos, Mathias Medina
 * Fecha: Mayo 2026
 */

import com.tasfb2b.planificador.service.SimulationExcelService;
import com.tasfb2b.planificador.domain.CollapseEndCondition;
import com.tasfb2b.planificador.domain.SimulationDayReport;
import com.tasfb2b.planificador.service.SimulationProgressHolder;
import com.tasfb2b.planificador.service.SimulationService;
import com.tasfb2b.planificador.service.FlightCancellationService;
import com.tasfb2b.envio.service.EnvioService;
import com.tasfb2b.planificador.service.SimulationWsPublisher;
import com.tasfb2b.vuelo.domain.Vuelo;
import com.tasfb2b.planificador.domain.Route;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.List;
import java.util.stream.Collectors;
import java.util.LinkedHashMap;

/**
 * Controlador REST para la simulación multi-día de TASF.B2B.
 */
@RestController
@RequestMapping("/api/v1/simulation")
@RequiredArgsConstructor
@lombok.extern.slf4j.Slf4j
public class SimulationController {

    private final SimulationService          service;
    private final SimulationProgressHolder   progressHolder;
    private final SimulationExcelService     excelService;
    private final EnvioService               envioService;
    private final FlightCancellationService  flightCancellationService;
    private final SimulationWsPublisher      wsPublisher;

    @PostMapping("/run/{dias}")
    public ResponseEntity<Map<String, String>> startSimulation(
            @PathVariable(required = false) Integer dias,
            @RequestParam(required = false, defaultValue = "ALNS") String algorithm,
            @RequestParam(required = false) String startDate,
            @RequestParam(required = false, defaultValue = "60") int playbackMinutes,
            @RequestParam(required = false) String preCancelledFlightIds,
            @RequestParam(required = false) String startTime) {

        int totalDays = (dias != null && dias > 0) ? dias : 5;
        String sessionId = UUID.randomUUID().toString();

        java.time.LocalDate fechaInicio = null;
        if (startDate != null && !startDate.isBlank()) {
            try { fechaInicio = java.time.LocalDate.parse(startDate); } catch (Exception ignored) {}
        }

        SimulationProgressHolder.SimulationSessionState session = progressHolder.create(sessionId, totalDays);
        session.setAlgorithm(algorithm);
        
        service.runAsync(sessionId, totalDays, algorithm, fechaInicio, playbackMinutes, preCancelledFlightIds, startTime);

        Map<String, String> response = new HashMap<>();
        response.put("sessionId", sessionId);
        response.put("totalDays", String.valueOf(totalDays));
        response.put("startDate", fechaInicio != null ? fechaInicio.toString() : "2026-01-01");
        response.put("message", "Simulación iniciada. Use /status/" + sessionId + " para seguir el progreso.");

        return ResponseEntity.accepted().body(response);
    }

    @PostMapping("/run-collapse/{dias}")
    public ResponseEntity<Map<String, String>> startCollapseSimulation(
            @PathVariable(required = false) Integer dias,
            @RequestParam(required = false, defaultValue = "ALNS") String algorithm,
            @RequestParam(required = false) String startDate,
            @RequestParam(required = false, defaultValue = "5.0") double stressFactor,
            @RequestParam(required = false, defaultValue = "NONE") String endCondition,
            @RequestParam(required = false, defaultValue = "60") int playbackMinutes,
            @RequestParam(required = false) String preCancelledFlightIds,
            @RequestParam(required = false, defaultValue = "00:00:00") String startTime) {

        int totalDays = (dias != null && dias > 0) ? dias : 5;
        double clampedStress = Math.max(1.0, Math.min(10.0, stressFactor)); 
        String sessionId = UUID.randomUUID().toString();

        java.time.LocalDate fechaInicio = null;
        if (startDate != null && !startDate.isBlank()) {
            try { fechaInicio = java.time.LocalDate.parse(startDate); } catch (Exception ignored) {}
        }

        CollapseEndCondition cond;
        try {
            cond = CollapseEndCondition.valueOf(endCondition.toUpperCase());
        } catch (IllegalArgumentException e) {
            log.warn("[run-collapse] endCondition '{}' inválida; usando NONE", endCondition);
            cond = CollapseEndCondition.NONE;
        }

        SimulationProgressHolder.SimulationSessionState session = progressHolder.create(sessionId, totalDays);
        session.setCollapseMode(true);
        session.setStressFactor(clampedStress);
        session.setAlgorithm(algorithm);
        session.setEndCondition(cond);

        service.runAsync(sessionId, totalDays, algorithm, fechaInicio, playbackMinutes, preCancelledFlightIds, startTime);

        Map<String, String> response = new HashMap<>();
        response.put("sessionId", sessionId);
        response.put("totalDays", String.valueOf(totalDays));
        response.put("stressFactor", String.valueOf(clampedStress));
        response.put("endCondition", cond.name());
        response.put("message", "Simulación de colapso iniciada.");

        return ResponseEntity.accepted().body(response);
    }



    // ── GET /status/{sessionId} ─────────────────────────────────────────────

    @GetMapping("/status/{sessionId}")
    public ResponseEntity<SimulationStatusDTO> getStatus(
            @PathVariable String sessionId) {

        SimulationProgressHolder.SimulationSessionState session =
                progressHolder.get(sessionId);

        if (session == null) {
            return ResponseEntity.notFound().build();
        }

        double globalOccupancy = 0;
        if (session.getAirportLoads() != null && !session.getAirportLoads().isEmpty()) {
            globalOccupancy = session.getAirportLoads().values().stream()
                    .mapToInt(data -> (Integer) data.getOrDefault("occupancy", 0))
                    .average()
                    .orElse(0);
        }

        java.util.List<java.util.Map<String, Object>> reportsList = session.getReports().stream()
                .map(r -> {
                    java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
                    m.put("dayIndex",           r.getDayIndex());
                    m.put("totalMaletas",       r.getTotalMaletas());
                    m.put("malatetasAtendidas", r.getMalatetasAtendidas());
                    m.put("slaPercent",         Math.round(r.getSlaPercent() * 10.0) / 10.0);
                    m.put("airportSaturation",  r.getAirportSaturation());
                    m.put("colapsed",           r.isColapsed());
                    return m;
                })
                .collect(java.util.stream.Collectors.toList());

        SimulationStatusDTO.SimulationStatusDTOBuilder builder = SimulationStatusDTO.builder()
                .sessionId(sessionId)
                .status(session.getStatus().name())
                .percent(session.getPercent())
                .currentDay(session.getCurrentDay())
                .totalDays(session.getTotalDays())
                .slaPercent(Math.round(session.getSlaPercent() * 10.0) / 10.0)
                .globalOccupancy(Math.round(globalOccupancy * 10.0) / 10.0)
                .criticalNodes(session.getCriticalNodes())
                .activeRoutes(session.getActiveRoutes())
                .airportLoads(session.getAirportLoads())
                .simulatedTime(session.getSimulatedTime())
                .currentEpochTime(session.getCurrentEpochTime())
                .totalBagsWaiting(session.getTotalBagsWaiting())
                .eventLog(session.getEventLog())
                .totalAttended(session.getTotalAttended())
                .totalMissed(session.getTotalMissed())
                .slaFinal(session.getSlaFinal())
                .isCollapseMode(session.isCollapseMode())
                .rescuedFlights(session.getRescuedFlights())
                .stressFactor(session.getStressFactor())
                .startEpoch(session.getStartEpoch())
                .algorithm(session.getAlgorithm())
                .endCondition(session.getEndCondition() != null ? session.getEndCondition().name() : "NONE")
                .collapseDayIndex(session.getCollapseDayIndex())
                .collapseReason(session.getCollapseReason())
                .comparisonResults(progressHolder.getComparisonResults())
                .errorMessage(session.getErrorMessage())
                .reports(reportsList)
                .taMs(session.getLastTaMs())
                .saMinutes(session.getCurrentSaMinutes());

        if ("DONE".equals(session.getStatus().name()) && session.getStartEpoch() != null) {
            try {
                java.time.LocalDate inicio = java.time.Instant
                        .ofEpochMilli(session.getStartEpoch())
                        .atZone(java.time.ZoneOffset.UTC).toLocalDate();
                java.time.LocalDate fin = inicio.plusDays(session.getTotalDays() - 1);
                java.util.Map<String, Long> demanda = envioService.getDemandaRealPorFecha(inicio, fin);
                builder.dailyRealDemand(demanda);
            } catch (Exception ex) {
                log.warn("No se pudo calcular demanda real: {}", ex.getMessage());
            }
        }

        return ResponseEntity.ok(builder.build());
    }

    /**
     * Búsqueda profunda de trazabilidad para un envío o maleta específica.
     * Consulta el historial completo de rutas de la sesión.
     */
    @GetMapping("/shipment/{sessionId}/{shipmentId}")
    public ResponseEntity<Map<String, Object>> getShipmentTraceability(
            @PathVariable String sessionId,
            @PathVariable String shipmentId) {

        SimulationProgressHolder.SimulationSessionState session = progressHolder.get(sessionId);
        if (session == null) return ResponseEntity.notFound().build();

        // Buscar en el reporte de todos los días simulados hasta el momento
        for (SimulationDayReport report : session.getReports()) {
            if (report.getRoutes() == null) continue;
            for (Route r : report.getRoutes()) {
                if (String.valueOf(r.getLot().getId()).equals(shipmentId)) {
                    return ResponseEntity.ok(buildShipmentTraceMap(r));
                }
            }
        }

        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(Map.of("message", "Envío no encontrado en el historial de esta sesión"));
    }

    private Map<String, Object> buildShipmentTraceMap(Route r) {
        Map<String, Object> trace = new LinkedHashMap<>();
        trace.put("id", r.getLot().getId());
        trace.put("origin", r.getLot().getOrigenIcao());
        trace.put("destination", r.getLot().getDestinoIcao());
        trace.put("totalBags", r.getLot().getTotalMaletas());
        trace.put("departure", r.getLot().getReadyTime());
        trace.put("arrival", r.getArrivalTime());
        trace.put("deadline", r.getLot().getDeadline());
        trace.put("status", r.getStatus());
        
        List<Map<String, Object>> hops = r.getFlights().stream().map(v -> {
            Map<String, Object> h = new HashMap<>();
            h.put("id", v.getId());
            h.put("from", v.getOrigen().getIcaoCode());
            h.put("to", v.getDestino().getIcaoCode());
            h.put("dep", v.getDepartureMinute());
            h.put("arr", v.getArrivalMinute());
            return h;
        }).collect(Collectors.toList());
        
        trace.put("route", hops);
        return trace;
    }

    // ── POST /export-excel/{sessionId} ─────────────────────────────────────

    @PostMapping("/export-excel/{sessionId}")
    public ResponseEntity<byte[]> exportExcel(
            @PathVariable String sessionId,
            @RequestParam(required = false, defaultValue = "ALNS") String algorithm) {

        SimulationProgressHolder.SimulationSessionState session =
                progressHolder.get(sessionId);

        if (session == null) {
            return ResponseEntity.notFound().build();
        }
        if (session.getStatus() == SimulationProgressHolder.Status.RUNNING) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body("La simulación aún está en curso.".getBytes());
        }

        try {
            long startEpoch = session.getStartEpoch() != null
                    ? session.getStartEpoch()
                    : java.time.LocalDate.of(2026, 1, 1).atStartOfDay()
                          .toInstant(java.time.ZoneOffset.UTC).toEpochMilli();

            byte[] xlsx = excelService.generateExcel(
                    sessionId, algorithm, startEpoch, session.getReports());

            String fileName = "Simulacion_" + algorithm + "_" + sessionId.substring(0, 8) + ".xlsx";
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.parseMediaType(
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));
            headers.setContentDispositionFormData("attachment", fileName);

            return ResponseEntity.ok().headers(headers).body(xlsx);

        } catch (Exception e) {
            log.error("[Excel] Error generando Excel de simulación {}: {}", sessionId, e.getMessage());
            return ResponseEntity.internalServerError().build();
        }
    }


    @GetMapping("/export/{sessionId}")
    public ResponseEntity<byte[]> exportCsv(@PathVariable String sessionId) {

        SimulationProgressHolder.SimulationSessionState session =
                progressHolder.get(sessionId);

        if (session == null) {
            return ResponseEntity.notFound().build();
        }

        if (session.getStatus() == SimulationProgressHolder.Status.RUNNING) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body("La simulación aún está en curso. Espere a que finalice.".getBytes());
        }

        String csv = buildCsv(sessionId, session);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType("text/csv; charset=UTF-8"));
        headers.setContentDispositionFormData("attachment",
                "tasf_simulation_" + sessionId.substring(0, 8) + ".csv");

        return ResponseEntity.ok()
                .headers(headers)
                .body(csv.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }

    private String buildCsv(String sessionId,
                             SimulationProgressHolder.SimulationSessionState session) {

        StringBuilder sb = new StringBuilder();

        sb.append("sessionId,dayIndex,startTime,endTime,")
          .append("totalMaletas,malatetasAtendidas,slaPercent,")
          .append("airportSaturation,colapsed,collapseTime,pendingLots\n");

        for (SimulationDayReport report : session.getReports()) {
            sb.append(sessionId).append(",")
              .append(report.getDayIndex()).append(",")
              .append(report.getStartTime()).append(",")
              .append(report.getEndTime()).append(",")
              .append(report.getTotalMaletas()).append(",")
              .append(report.getMalatetasAtendidas()).append(",")
              .append(String.format("%.2f", report.getSlaPercent())).append(",")
              .append(report.getAirportSaturation()).append(",")
              .append(report.isColapsed()).append(",")
              .append(report.getCollapseTime()).append(",")
              .append(report.getPendingLots() != null ? report.getPendingLots().size() : 0)
              .append("\n");
        }

        if (!session.getReports().isEmpty()) {
            double avgSla = session.getReports().stream()
                    .mapToDouble(SimulationDayReport::getSlaPercent)
                    .average().orElse(0);
            int totalMaletas = session.getReports().stream()
                    .mapToInt(SimulationDayReport::getTotalMaletas).sum();
            int totalAtendidas = session.getReports().stream()
                    .mapToInt(SimulationDayReport::getMalatetasAtendidas).sum();

            sb.append("\n# Resumen\n");
            sb.append("# Días simulados: ").append(session.getReports().size()).append("\n");
            sb.append("# Total maletas procesadas: ").append(totalMaletas).append("\n");
            sb.append("# Total maletas atendidas: ").append(totalAtendidas).append("\n");
            sb.append(String.format("# SLA promedio: %.2f%%\n", avgSla));
        }

        return sb.toString();
    }
/**
     * Cancela manualmente un vuelo durante una simulación en curso.
     * Dispara replanificación ALNS automática si hay sesión activa.
     */
    @PostMapping("/cancel-flight/{vueloId}")
    public ResponseEntity<Map<String, String>> cancelFlight(
            @PathVariable Long vueloId,
            @RequestParam(required = false) String sessionId) {
        return handleCancelFlight(vueloId, sessionId);
    }

    @PostMapping("/cancel-flight/{sessionId}/{vueloId}")
    public ResponseEntity<Map<String, String>> cancelFlightPath(
            @PathVariable String sessionId,
            @PathVariable Long vueloId) {
        return handleCancelFlight(vueloId, sessionId);
    }

    private ResponseEntity<Map<String, String>> handleCancelFlight(Long vueloId, String sessionId) {
        try {
            flightCancellationService.cancelarVuelo(vueloId, sessionId);
            if (sessionId != null) {
                SimulationProgressHolder.SimulationSessionState session = progressHolder.get(sessionId);
                if (session != null) {
                    wsPublisher.pushImmediate(sessionId, session);
                }
            }
            return ResponseEntity.ok(Map.of(
                    "status", "ok",
                    "message", "Vuelo " + vueloId + " cancelado exitosamente"
            ));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of(
                    "status", "error",
                    "message", e.getMessage()
            ));
        }
    }

    /**
     * Genera un reporte detallado en Markdown de todas las operaciones,
     * incluyendo desglose de rutas por día, cancelaciones y reacomodación,
     * y ocupación acumulada de vuelos físicos.
     */
    @GetMapping("/export-details/{sessionId}")
    public ResponseEntity<byte[]> exportDetailedReport(@PathVariable String sessionId) {
        SimulationProgressHolder.SimulationSessionState session = progressHolder.get(sessionId);

        if (session == null) {
            return ResponseEntity.notFound().build();
        }

        if (session.getStatus() == SimulationProgressHolder.Status.RUNNING) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body("La simulación aún está en curso. Espere a que finalice.".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        }

        String report = buildDetailedReport(sessionId, session);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType("text/markdown; charset=UTF-8"));
        headers.setContentDispositionFormData("attachment",
                "reporte_detallado_vuelos_" + sessionId.substring(0, 8) + ".md");

        return ResponseEntity.ok()
                .headers(headers)
                .body(report.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }

    private String buildDetailedReport(String sessionId, SimulationProgressHolder.SimulationSessionState session) {
        StringBuilder sb = new StringBuilder();

        sb.append("# 📋 Reporte Detallado de Operaciones y Flujo de Equipaje\n\n");
        sb.append("> **Documento operativo de trazabilidad completa generado por TASF-B2B.**\n\n");

        sb.append("## ⚙️ Metadatos de la Corrida\n");
        sb.append("- **ID de Sesión**: `").append(sessionId).append("`\n");
        sb.append("- **Algoritmo de Optimización**: **").append(session.getAlgorithm() != null ? session.getAlgorithm().toUpperCase() : "ALNS").append("**\n");
        sb.append("- **SLA Final Alcanzado**: `").append(String.format("%.2f", session.getSlaFinal())).append("%`\n");
        sb.append("- **Total de Días Simulados**: ").append(session.getTotalDays()).append(" días\n");
        sb.append("- **Maletas Atendidas (A tiempo)**: ").append(String.format("%,d", session.getTotalAttended())).append("\n");
        sb.append("- **Maletas No Atendidas (Ecap)**: ").append(String.format("%,d", session.getTotalMissed())).append("\n");
        if (session.isCollapseMode()) {
            sb.append("- **Modo de Simulación**: 🚨 Colapso / Estrés de Red (Factor de estrés: ×").append(session.getStressFactor()).append(")\n");
            sb.append("- **Vuelos Replanificados/Rescatados**: ").append(session.getRescuedFlights()).append("\n");
        } else {
            sb.append("- **Modo de Simulación**: 🟢 Operación Día a Día (Normal)\n");
        }
        sb.append("\n---\n\n");

        sb.append("## 🚨 Registro de Cancelaciones e Incidentes\n");
        List<String> cancelLog = session.getEventLog().stream()
                .filter(l -> l.contains("CANCELADO") || l.contains("Cancelado") || l.contains("cancelado"))
                .collect(Collectors.toList());

        if (cancelLog.isEmpty()) {
            sb.append("*No se registraron cancelaciones ni incidentes de vuelos durante esta sesión de simulación.*\n\n");
        } else {
            sb.append("| Momento / Fase | Detalle de la Disrupción / Medida Logística |\n");
            sb.append("| :--- | :--- |\n");
            for (String logLine : cancelLog) {
                sb.append("| Evento Log | ").append(logLine).append(" |\n");
            }
            sb.append("\n");
        }

        sb.append("## ✈️ Ocupación Acumulada de Vuelos Físicos\n");
        sb.append("Detalle del equipaje transportado por cada vuelo programado que participó en el traslado de lotes:\n\n");
        
        Map<Long, Integer> flightLoads = new LinkedHashMap<>();
        Map<Long, Vuelo> flightObjects = new LinkedHashMap<>();

        for (SimulationDayReport report : session.getReports()) {
            if (report.getRoutes() == null) continue;
            for (Route r : report.getRoutes()) {
                if (r.getFlights() == null || r.getCapacidadAsignada() <= 0) continue;
                for (Vuelo v : r.getFlights()) {
                    flightLoads.put(v.getId(), flightLoads.getOrDefault(v.getId(), 0) + r.getCapacidadAsignada());
                    flightObjects.put(v.getId(), v);
                }
            }
        }

        if (flightLoads.isEmpty()) {
            sb.append("*No se registraron asignaciones de equipaje a ningún vuelo físico en esta corrida.*\n\n");
        } else {
            sb.append("| ID Vuelo | Origen | Destino | Tipo | Capacidad Total | Equipaje Asignado | % Ocupación | Estado |\n");
            sb.append("| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n");
            for (Map.Entry<Long, Integer> entry : flightLoads.entrySet()) {
                Long flightId = entry.getKey();
                int load = entry.getValue();
                Vuelo v = flightObjects.get(flightId);
                if (v == null) continue;

                double occupancy = (load * 100.0) / v.getCapacidadTotal();
                String status = v.getCancelled() ? "🚨 Cancelado" : "🟢 Activo";
                String type = v.getIntercontinental() ? "Intercontinental" : "Nacional";

                sb.append("| ").append(v.getId())
                  .append(" | ").append(v.getOrigen().getIcaoCode())
                  .append(" | ").append(v.getDestino().getIcaoCode())
                  .append(" | ").append(type)
                  .append(" | ").append(String.format("%,d", v.getCapacidadTotal()))
                  .append(" | ").append(String.format("%,d", load))
                  .append(" | ").append(String.format("%.1f%%", occupancy))
                  .append(" | ").append(status).append(" |\n");
            }
            sb.append("\n");
        }

        sb.append("## 📅 Desglose de Rutas y Reacomodación por Día\n");
        for (SimulationDayReport report : session.getReports()) {
            sb.append("### 📆 Día ").append(report.getDayIndex() + 1).append("\n");
            sb.append("- **SLA del Día**: `").append(String.format("%.2f", report.getSlaPercent())).append("%`\n");
            sb.append("- **Maletas Totales (Demanda)**: ").append(String.format("%,d", report.getTotalMaletas())).append("\n");
            sb.append("- **Maletas Atendidas**: ").append(String.format("%,d", report.getMalatetasAtendidas())).append("\n");
            if (report.isColapsed()) {
                sb.append("- **Estado**: 🚨 Colapsado (Saturación: ").append(report.getAirportSaturation()).append("%)\n");
            } else {
                sb.append("- **Estado**: 🟢 Estable\n");
            }
            sb.append("\n");

            if (report.getRoutes() == null || report.getRoutes().isEmpty()) {
                sb.append("*No hay rutas detalladas disponibles para este día.*\n\n");
            } else {
                sb.append("| Lote ID | Origen ➔ Destino | Tipo | Demanda | Atendidas | Ecap | Estado | Ruta Tomada |\n");
                sb.append("| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :--- |\n");
                for (Route r : report.getRoutes()) {
                    List<String> hops = r.getHops();
                    String routePath = (hops != null && !hops.isEmpty()) ? String.join(" ➔ ", hops) : "Sin Ruta Directa";

                    String state = "A tiempo";
                    if (r.isNoAtendido()) state = "❌ No atendido";
                    else if (r.isTarde()) state = "⚠️ Retrasado";
                    else if ("cancelled".equals(r.getStatus())) state = "🚨 Afectado Cancelación";

                    sb.append("| ").append(r.getLot().getId())
                      .append(" | ").append(r.getLot().getOrigenIcao()).append(" ➔ ").append(r.getLot().getDestinoIcao())
                      .append(" | ").append(r.isIntercontinental() ? "Intercon." : "Nacional")
                      .append(" | ").append(String.format("%,d", r.getDemandaTotal()))
                      .append(" | ").append(String.format("%,d", r.getCapacidadAsignada()))
                      .append(" | ").append(String.format("%,d", r.getDemandaNoAtendida()))
                      .append(" | ").append(state)
                      .append(" | `").append(routePath).append("` |\n");
                }
                sb.append("\n");
            }
        }

        sb.append("\n---\n> Reporte detallado generado dinámicamente por **TASF-B2B Control Tower**.");
        return sb.toString();
    }

}
