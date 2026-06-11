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
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

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
            @RequestParam(required = false) String preCancelledFlightIds) {

        int totalDays = (dias != null && dias > 0) ? dias : 5;
        String sessionId = UUID.randomUUID().toString();

        java.time.LocalDate fechaInicio = null;
        if (startDate != null && !startDate.isBlank()) {
            try { fechaInicio = java.time.LocalDate.parse(startDate); } catch (Exception ignored) {}
        }

        SimulationProgressHolder.SimulationSessionState session = progressHolder.create(sessionId, totalDays);
        session.setAlgorithm(algorithm);
        
        service.runAsync(sessionId, totalDays, algorithm, fechaInicio, playbackMinutes, preCancelledFlightIds);

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
            @RequestParam(required = false) String preCancelledFlightIds) {

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

        service.runAsync(sessionId, totalDays, algorithm, fechaInicio, playbackMinutes, preCancelledFlightIds);

        Map<String, String> response = new HashMap<>();
        response.put("sessionId", sessionId);
        response.put("totalDays", String.valueOf(totalDays));
        response.put("stressFactor", String.valueOf(clampedStress));
        response.put("endCondition", cond.name());
        response.put("message", "Simulación de colapso iniciada.");

        return ResponseEntity.accepted().body(response);
    }

    // ── CANCELAR VUELO (MANUAL) ─────────────────────────────────────────────
    @PostMapping("/cancel-flight/{sessionId}/{vueloId}")
    public ResponseEntity<Map<String, String>> cancelFlight(
            @PathVariable String sessionId,
            @PathVariable Long vueloId) {
            
        flightCancellationService.cancelarVuelo(vueloId, sessionId);
        
        Map<String, String> response = new HashMap<>();
        response.put("message", "Vuelo " + vueloId + " cancelado y replanificación disparada.");
        response.put("status", "SUCCESS");
        
        return ResponseEntity.ok(response);
    }

    @PostMapping("/cancel-flight/{vueloId}")
    public ResponseEntity<Map<String, String>> cancelFlightNoSession(
            @PathVariable Long vueloId,
            @RequestParam(required = false) String sessionId) {
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
                .reports(reportsList);

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
}
