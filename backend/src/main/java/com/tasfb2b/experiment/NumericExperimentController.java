package com.tasfb2b.experiment;

import lombok.RequiredArgsConstructor;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.File;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/numeric-experiment")
@RequiredArgsConstructor
public class NumericExperimentController {

    private final NumericExperimentService experimentService;
    private final ExcelExportService excelExportService;

    /**
     * Calcula los 5 niveles DOE escaneando TODOS los archivos planos.
     * No usa SQL, solo lectura directa de archivos .txt.
     */
    @GetMapping("/doe")
    public ResponseEntity<?> getDOELevels() {
        List<ExperimentSession.LevelDefinition> levels = experimentService.calculateDOELevels();
        if (levels.isEmpty()) {
            return ResponseEntity.status(503).body(
                Map.of("error", "No se encontraron archivos de envíos en la ruta configurada.")
            );
        }
        return ResponseEntity.ok(Map.of("levels", levels, "totalLevels", levels.size()));
    }

    /**
     * Inicia el experimento global (1 corrida de 5 niveles).
     * Body: { "algorithm": "ALNS" | "HGA" }
     */
    @PostMapping("/start")
    public ResponseEntity<?> startExperiment(@RequestBody Map<String, String> payload) {
        String algorithm = payload.getOrDefault("algorithm", "ALNS").toUpperCase();

        List<ExperimentSession.LevelDefinition> levels = experimentService.calculateDOELevels();
        if (levels.isEmpty()) {
            return ResponseEntity.status(503).body(
                Map.of("error", "No hay datos históricos disponibles para calcular los niveles DOE.")
            );
        }

        ExperimentSession session = experimentService.createSession(algorithm, levels);
        experimentService.runExperiment(session.getId());

        return ResponseEntity.accepted().body(Map.of("sessionId", session.getId()));
    }

    /**
     * Consulta el progreso y resultados parciales de una sesión de experimento simple.
     */
    @GetMapping("/status/{sessionId}")
    public ResponseEntity<?> getStatus(@PathVariable String sessionId) {
        ExperimentSession session = experimentService.getSession(sessionId);
        if (session == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(session);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EXPORTACIÓN EXCEL: 10 iteraciones × 5 niveles → .xlsx
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Inicia la suite de 10 iteraciones y devuelve un exportSessionId para tracking.
     * Body: { "algorithm": "ALNS" | "HGA" }
     */
    @PostMapping("/export/start")
    public ResponseEntity<?> startExport(@RequestBody Map<String, String> payload) {
        String algorithm = payload.getOrDefault("algorithm", "ALNS").toUpperCase();

        List<ExperimentSession.LevelDefinition> levels = experimentService.calculateDOELevels();
        if (levels.isEmpty()) {
            return ResponseEntity.status(503).body(
                Map.of("error", "No hay datos históricos para exportar.")
            );
        }

        ExperimentExportSession session = excelExportService.createExportSession(algorithm, levels);
        excelExportService.runExport(session.getId(), levels);

        return ResponseEntity.accepted().body(Map.of(
            "exportSessionId", session.getId(),
            "algorithm", algorithm,
            "iterations", 10,
            "levels", levels.size(),
            "totalWork", session.getTotalWork()
        ));
    }

    /**
     * Polling del progreso de la exportación.
     */
    @GetMapping("/export/status/{exportSessionId}")
    public ResponseEntity<?> getExportStatus(@PathVariable String exportSessionId) {
        ExperimentExportSession session = excelExportService.getExportSession(exportSessionId);
        if (session == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(Map.of(
            "status",            session.getStatus().name(),
            "progressPercent",   session.getProgressPercent(),
            "currentIteration",  session.getCurrentIteration(),
            "currentLevel",      session.getCurrentLevel(),
            "totalWork",         session.getTotalWork(),
            "completedWork",     session.getCompletedWork(),
            "fileName",          session.getFileName() != null ? session.getFileName() : "",
            "errorMessage",      session.getErrorMessage() != null ? session.getErrorMessage() : ""
        ));
    }

    /**
     * Descarga el archivo Excel generado.
     * El navegador recibe el archivo directamente como descarga.
     */
    @GetMapping("/export/download/{exportSessionId}")
    public ResponseEntity<Resource> downloadExport(@PathVariable String exportSessionId) {
        ExperimentExportSession session = excelExportService.getExportSession(exportSessionId);
        if (session == null || session.getStatus() != ExperimentExportSession.Status.DONE) {
            return ResponseEntity.notFound().build();
        }

        File file = new File(session.getFilePath());
        if (!file.exists()) {
            return ResponseEntity.notFound().build();
        }

        Resource resource = new FileSystemResource(file);
        return ResponseEntity.ok()
            .header(HttpHeaders.CONTENT_DISPOSITION,
                    "attachment; filename=\"" + session.getFileName() + "\"")
            .contentType(MediaType.parseMediaType(
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
            .body(resource);
    }
}
