package com.tasfb2b.experiment;

import com.tasfb2b.aeropuerto.domain.Aeropuerto;
import com.tasfb2b.aeropuerto.repository.AeropuertoRepository;
import com.tasfb2b.planificador.service.ALNSPlannerService;
import com.tasfb2b.planificador.simulation.SimulationRunner;
import com.tasfb2b.superlote.domain.SuperLot;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.ss.util.CellRangeAddress;
import org.apache.poi.xssf.usermodel.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Slf4j
public class ExcelExportService {

    private final AeropuertoRepository airportRepo;
    private final ALNSPlannerService alnsPlanner;
    private final SimulationRunner simulationRunner;
    private final NumericExperimentService experimentService;

    @Value("${tasf.data.path}")
    private String dataPath;

    private static final int ITERATIONS = 10;
    private static final long ALGO_WINDOW_MS = 5_000L;

    // Sesiones de exportación en memoria
    private final Map<String, ExperimentExportSession> exportSessions = new ConcurrentHashMap<>();

    // ─────────────────────────────────────────────────────────────────────────
    // API Pública
    // ─────────────────────────────────────────────────────────────────────────

    public ExperimentExportSession createExportSession(String algorithm,
                                                       List<ExperimentSession.LevelDefinition> levels) {
        ExperimentExportSession session = new ExperimentExportSession();
        session.setAlgorithm(algorithm);
        session.setTotalWork(ITERATIONS * levels.size());
        exportSessions.put(session.getId(), session);
        log.info("[Export] Sesión creada: {} | Algoritmo: {} | {}it × {}niv = {} trabajos",
                session.getId(), algorithm, ITERATIONS, levels.size(), session.getTotalWork());
        return session;
    }

    public ExperimentExportSession getExportSession(String id) {
        return exportSessions.get(id);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Motor asíncrono: 10 iteraciones × 5 niveles
    // ─────────────────────────────────────────────────────────────────────────

    @Async("simulationExecutor")
    public void runExport(String sessionId, List<ExperimentSession.LevelDefinition> levels) {
        ExperimentExportSession session = exportSessions.get(sessionId);
        if (session == null) return;

        session.setStatus(ExperimentExportSession.Status.RUNNING);
        String algorithm = session.getAlgorithm();

        // Cargar aeropuertos una sola vez
        Map<String, Aeropuerto> airportMap = airportRepo.findAll().stream()
                .collect(Collectors.toMap(Aeropuerto::getIcaoCode, a -> a));

        // Resultados agrupados: levelTag → lista de ExperimentRunResult (una por iteración)
        Map<String, List<ExperimentRunResult>> resultsByLevel = new LinkedHashMap<>();
        for (ExperimentSession.LevelDefinition ld : levels) {
            resultsByLevel.put(ld.getLevelTag(), new ArrayList<>());
        }

        try {
            for (int iter = 1; iter <= ITERATIONS; iter++) {
                session.setCurrentIteration(iter);
                log.info("[Export] Iteración {}/{} | Algoritmo: {}", iter, ITERATIONS, algorithm);

                for (int li = 0; li < levels.size(); li++) {
                    ExperimentSession.LevelDefinition levelDef = levels.get(li);
                    session.setCurrentLevel(li + 1);

                    // Cargar datos de la fecha del nivel
                    LocalDate fecha = LocalDate.parse(levelDef.getFecha());
                    List<SuperLot> lots = experimentService.agruparDiaPublic(fecha, airportMap);

                    // Ejecutar nivel
                    ExperimentRunResult result = experimentService.runSingleLevelPublic(
                            li, levelDef, algorithm, airportMap, lots);

                    resultsByLevel.get(levelDef.getLevelTag()).add(result);

                    session.setCompletedWork(session.getCompletedWork() + 1);
                    log.info("[Export] ✓ Iter {}/{} | Nivel {} ({}) | Score: {}",
                            iter, ITERATIONS, li + 1, levelDef.getLevelTag(), result.getFitnessScore());
                }
            }

            // Generar el Excel
            String fileName = "ResultadoIteraciones" + algorithm + ".xlsx";
            String filePath = Path.of(dataPath, fileName).toString();
            generateExcel(levels, resultsByLevel, algorithm, filePath);

            session.setFileName(fileName);
            session.setFilePath(filePath);
            session.setStatus(ExperimentExportSession.Status.DONE);
            log.info("[Export] Sesión {} completada. Archivo: {}", sessionId, filePath);

        } catch (Exception e) {
            log.error("[Export] Error en sesión {}: {}", sessionId, e.getMessage(), e);
            session.setStatus(ExperimentExportSession.Status.FAILED);
            session.setErrorMessage(e.getMessage());
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Generación del Excel con Apache POI
    // ─────────────────────────────────────────────────────────────────────────

    private void generateExcel(List<ExperimentSession.LevelDefinition> levels,
                                Map<String, List<ExperimentRunResult>> resultsByLevel,
                                String algorithm,
                                String filePath) throws IOException {

        try (XSSFWorkbook wb = new XSSFWorkbook()) {

            String sheetName = "DOE_" + algorithm;
            XSSFSheet sheet = wb.createSheet(sheetName);
            sheet.setDefaultColumnWidth(22);

            // ── Paleta de colores ───────────────────────────────────────────
            XSSFColor darkBg    = xColor(15, 23, 42);
            XSSFColor headerBg  = xColor(30, 41, 59);
            XSSFColor levelBg   = xColor(67, 56, 202);    // indigo
            XSSFColor mediaBg   = xColor(5, 150, 105);    // verde
            XSSFColor desvBg    = xColor(37, 99, 235);    // azul
            XSSFColor rowAlt    = xColor(15, 23, 42);
            XSSFColor rowNormal = xColor(30, 41, 59);
            XSSFColor white     = xColor(241, 245, 249);
            XSSFColor gold      = xColor(251, 191, 36);
            XSSFColor red       = xColor(239, 68, 68);
            XSSFColor green     = xColor(52, 211, 153);

            // ── Estilos ─────────────────────────────────────────────────────
            XSSFCellStyle titleStyle  = makeTitleStyle(wb, darkBg, gold);
            XSSFCellStyle noteStyle   = makeNoteStyle(wb, darkBg, white);
            XSSFCellStyle headerStyle = makeHeaderStyle(wb, headerBg, gold);
            XSSFCellStyle levelStyle  = makeLevelStyle(wb, levelBg, white);
            XSSFCellStyle dataStyleA  = makeDataStyle(wb, rowNormal, white, false);
            XSSFCellStyle dataStyleB  = makeDataStyle(wb, rowAlt, white, true);
            XSSFCellStyle mediaStyle  = makeStatStyle(wb, mediaBg, white, true);
            XSSFCellStyle desvStyle   = makeStatStyle(wb, desvBg, white, true);
            XSSFCellStyle goodNum     = makeDataStyle(wb, rowNormal, green, false);
            XSSFCellStyle badNum      = makeDataStyle(wb, rowNormal, red, false);

            int rowNum = 0;

            // ── Fila 0: Título ──────────────────────────────────────────────
            Row titleRow = sheet.createRow(rowNum++);
            titleRow.setHeightInPoints(28);
            Cell titleCell = titleRow.createCell(0);
            titleCell.setCellValue("DOE — Experimentación Numérica | Algoritmo: " + algorithm
                    + " | " + LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")));
            titleCell.setCellStyle(titleStyle);
            sheet.addMergedRegion(new CellRangeAddress(0, 0, 0, COLS.length - 1));

            // ── Fila 1: Fórmula fitness ─────────────────────────────────────
            Row noteRow = sheet.createRow(rowNum++);
            noteRow.setHeightInPoints(18);
            Cell noteCell = noteRow.createCell(0);
            noteCell.setCellValue("Fitness Score = 10×A  −  0.005×Ecap  −  2×Dh  −  12×Saero   |   10 iteraciones por nivel");
            noteCell.setCellStyle(noteStyle);
            sheet.addMergedRegion(new CellRangeAddress(1, 1, 0, COLS.length - 1));

            // ── Fila 2: Vacía ───────────────────────────────────────────────
            rowNum++;

            // ── Fila 3: Cabecera de columnas ────────────────────────────────
            Row headerRow = sheet.createRow(rowNum++);
            headerRow.setHeightInPoints(22);
            for (int c = 0; c < COLS.length; c++) {
                Cell cell = headerRow.createCell(c);
                cell.setCellValue(COLS[c]);
                cell.setCellStyle(headerStyle);
            }

            // ── Bloques por nivel ────────────────────────────────────────────
            for (ExperimentSession.LevelDefinition ld : levels) {
                List<ExperimentRunResult> iters = resultsByLevel.get(ld.getLevelTag());
                if (iters == null || iters.isEmpty()) continue;

                // Título del nivel (fila fusionada)
                Row lvlRow = sheet.createRow(rowNum++);
                lvlRow.setHeightInPoints(20);
                Cell lvlCell = lvlRow.createCell(0);
                lvlCell.setCellValue("⬛ " + ld.getName()
                        + "  ·  " + ld.getSuitcaseCount() + " maletas  ·  Fecha: " + ld.getFecha());
                lvlCell.setCellStyle(levelStyle);
                sheet.addMergedRegion(new CellRangeAddress(rowNum - 1, rowNum - 1, 0, COLS.length - 1));

                int firstDataRow = rowNum; // para fórmulas (0-indexed → +1 en Excel)

                // 10 filas de datos
                for (int i = 0; i < iters.size(); i++) {
                    ExperimentRunResult r = iters.get(i);
                    Row dr = sheet.createRow(rowNum++);
                    dr.setHeightInPoints(17);

                    XSSFCellStyle rowStyle = (i % 2 == 0) ? dataStyleA : dataStyleB;

                    writeCell(dr, 0, i + 1,                         rowStyle); // Ejecución
                    writeCell(dr, 1, ld.getName(),                   rowStyle); // Nivel
                    writeCell(dr, 2, ld.getSuitcaseCount(),           rowStyle); // Maletas DOE
                    writeCell(dr, 3, r.getTotalProcessed(),           rowStyle); // Maletas reales
                    writeCell(dr, 4, r.getFitnessScore(),             r.getFitnessScore() >= 0 ? goodNum : badNum); // Fitness
                    writeCell(dr, 5, r.getComplianceRate(),           rowStyle); // Cumplimiento %
                    writeCell(dr, 6, r.getOccupancyRate(),            rowStyle); // Ocupación %
                    writeCell(dr, 7, r.getLeadTimeAvg(),              rowStyle); // Lead Time h
                    writeCell(dr, 8, r.getAvgAirportSaturation(),     rowStyle); // Sat. Aero %
                    writeCell(dr, 9, r.getTotalAttended(),            rowStyle); // Maletas Atend.
                    writeCell(dr, 10, r.getTotalEcap(),               rowStyle); // Ecap
                    writeCell(dr, 11, r.getTotalRoutes(),             rowStyle); // Rutas totales
                    writeCell(dr, 12, r.getRoutesServed(),            rowStyle); // Rutas atend.
                    writeCell(dr, 13, r.getRoutesUnserved(),          rowStyle); // Rutas no atend.
                    writeCell(dr, 14, r.getMaxRouteCapacity(),        rowStyle); // Máx cap ruta
                    writeCell(dr, 15, r.getAvgRouteCapacity(),        rowStyle); // Avg cap ruta
                    writeCell(dr, 16, r.getPlanningTimeMs(),          rowStyle); // T. Planif ms
                    writeCell(dr, 17, r.getSimulationTimeMs(),        rowStyle); // T. Sim ms
                    writeCell(dr, 18, r.getExecutionTimeMs(),         rowStyle); // T. Total ms
                    writeCell(dr, 19, r.getCpuUsagePercent(),         rowStyle); // CPU %
                    writeCell(dr, 20, r.getMemoryUsedMb(),            rowStyle); // Memoria MB
                }

                // Fila MEDIA con fórmulas de Excel
                Row mediaRow = sheet.createRow(rowNum++);
                mediaRow.setHeightInPoints(18);
                writeCell(mediaRow, 0, "MEDIA", mediaStyle);
                writeCell(mediaRow, 1, ld.getName(), mediaStyle);
                // Columnas con fórmula PROMEDIO (columnas 2-20 → D-V en Excel, pero offset +1 para 1-based)
                int excelFirstRow = firstDataRow + 1; // Excel es 1-based
                int excelLastRow  = firstDataRow + ITERATIONS;
                for (int c = 2; c <= 20; c++) {
                    String colLetter = colLetter(c);
                    Cell fc = mediaRow.createCell(c);
                    fc.setCellFormula("AVERAGE(" + colLetter + excelFirstRow + ":" + colLetter + excelLastRow + ")");
                    fc.setCellStyle(mediaStyle);
                }

                // Fila DESV. EST con fórmulas de Excel
                Row desvRow = sheet.createRow(rowNum++);
                desvRow.setHeightInPoints(18);
                writeCell(desvRow, 0, "DESV. EST.", desvStyle);
                writeCell(desvRow, 1, ld.getName(), desvStyle);
                for (int c = 2; c <= 20; c++) {
                    String colLetter = colLetter(c);
                    Cell fc = desvRow.createCell(c);
                    fc.setCellFormula("STDEV.P(" + colLetter + excelFirstRow + ":" + colLetter + excelLastRow + ")");
                    fc.setCellStyle(desvStyle);
                }

                // Fila separadora
                rowNum++;
            }

            // Anchos específicos para columnas clave
            sheet.setColumnWidth(0, 14 * 256);   // Ejecución
            sheet.setColumnWidth(1, 30 * 256);   // Nivel
            sheet.setColumnWidth(4, 18 * 256);   // Fitness Score
            sheet.setColumnWidth(16, 20 * 256);  // T. Planif.

            // Congelar primera fila (cabecera de columnas, row 3)
            sheet.createFreezePane(0, 4);

            // Guardar
            try (FileOutputStream fos = new FileOutputStream(filePath)) {
                wb.write(fos);
            }
            log.info("[Export] Excel generado en: {}", filePath);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Columnas del Excel
    // ─────────────────────────────────────────────────────────────────────────
    private static final String[] COLS = {
        "Ejecución", "Nivel", "Maletas DOE", "Maletas Reales",
        "Fitness Score", "Cumplimiento %", "Ocupación %", "Lead Time (h)", "Sat. Aero %",
        "Maletas Atend.", "Ecap", "Rutas Totales", "Rutas Atend.", "Rutas No Atend.",
        "Máx. Cap. Ruta", "Avg Cap. Ruta",
        "T. Planificación (ms)", "T. Simulación (ms)", "T. Total (ms)",
        "CPU %", "Memoria (MB)"
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Utilidades de estilo y escritura
    // ─────────────────────────────────────────────────────────────────────────

    private static XSSFColor xColor(int r, int g, int b) {
        return new XSSFColor(new byte[]{(byte) r, (byte) g, (byte) b}, null);
    }

    private static XSSFCellStyle makeTitleStyle(XSSFWorkbook wb, XSSFColor bg, XSSFColor fg) {
        XSSFCellStyle s = wb.createCellStyle();
        s.setFillForegroundColor(bg); s.setFillPattern(FillPatternType.SOLID_FOREGROUND);
        XSSFFont f = wb.createFont(); f.setBold(true); f.setFontHeightInPoints((short) 14);
        f.setColor(fg); s.setFont(f);
        s.setAlignment(HorizontalAlignment.CENTER);
        s.setVerticalAlignment(VerticalAlignment.CENTER);
        return s;
    }

    private static XSSFCellStyle makeNoteStyle(XSSFWorkbook wb, XSSFColor bg, XSSFColor fg) {
        XSSFCellStyle s = wb.createCellStyle();
        s.setFillForegroundColor(bg); s.setFillPattern(FillPatternType.SOLID_FOREGROUND);
        XSSFFont f = wb.createFont(); f.setItalic(true); f.setFontHeightInPoints((short) 10);
        f.setColor(fg); s.setFont(f);
        s.setAlignment(HorizontalAlignment.CENTER);
        return s;
    }

    private static XSSFCellStyle makeHeaderStyle(XSSFWorkbook wb, XSSFColor bg, XSSFColor fg) {
        XSSFCellStyle s = wb.createCellStyle();
        s.setFillForegroundColor(bg); s.setFillPattern(FillPatternType.SOLID_FOREGROUND);
        XSSFFont f = wb.createFont(); f.setBold(true); f.setFontHeightInPoints((short) 11);
        f.setColor(fg); s.setFont(f);
        s.setAlignment(HorizontalAlignment.CENTER);
        s.setBorderBottom(BorderStyle.MEDIUM);
        setBorderColor(s, fg);
        return s;
    }

    private static XSSFCellStyle makeLevelStyle(XSSFWorkbook wb, XSSFColor bg, XSSFColor fg) {
        XSSFCellStyle s = wb.createCellStyle();
        s.setFillForegroundColor(bg); s.setFillPattern(FillPatternType.SOLID_FOREGROUND);
        XSSFFont f = wb.createFont(); f.setBold(true); f.setFontHeightInPoints((short) 11);
        f.setColor(fg); s.setFont(f);
        s.setAlignment(HorizontalAlignment.LEFT);
        s.setVerticalAlignment(VerticalAlignment.CENTER);
        return s;
    }

    private static XSSFCellStyle makeDataStyle(XSSFWorkbook wb, XSSFColor bg, XSSFColor fg, boolean altRow) {
        XSSFCellStyle s = wb.createCellStyle();
        s.setFillForegroundColor(bg); s.setFillPattern(FillPatternType.SOLID_FOREGROUND);
        XSSFFont f = wb.createFont(); f.setFontHeightInPoints((short) 10);
        f.setColor(fg); s.setFont(f);
        s.setAlignment(HorizontalAlignment.CENTER);
        s.setBorderBottom(BorderStyle.THIN);
        return s;
    }

    private static XSSFCellStyle makeStatStyle(XSSFWorkbook wb, XSSFColor bg, XSSFColor fg, boolean bold) {
        XSSFCellStyle s = wb.createCellStyle();
        s.setFillForegroundColor(bg); s.setFillPattern(FillPatternType.SOLID_FOREGROUND);
        XSSFFont f = wb.createFont(); f.setBold(bold); f.setFontHeightInPoints((short) 10);
        f.setColor(fg); s.setFont(f);
        s.setAlignment(HorizontalAlignment.CENTER);
        s.setBorderTop(BorderStyle.MEDIUM);
        s.setBorderBottom(BorderStyle.MEDIUM);
        return s;
    }

    private static void setBorderColor(XSSFCellStyle s, XSSFColor c) {
        s.setBottomBorderColor(c);
    }

    private static void writeCell(Row row, int col, Object value, XSSFCellStyle style) {
        Cell cell = row.createCell(col);
        if (value instanceof Number) {
            cell.setCellValue(((Number) value).doubleValue());
        } else {
            cell.setCellValue(value != null ? value.toString() : "");
        }
        cell.setCellStyle(style);
    }

    /** Convierte índice 0-based de columna a letra(s) de Excel: 0→A, 25→Z, 26→AA */
    private static String colLetter(int colIndex) {
        StringBuilder sb = new StringBuilder();
        colIndex++;
        while (colIndex > 0) {
            int rem = (colIndex - 1) % 26;
            sb.insert(0, (char) ('A' + rem));
            colIndex = (colIndex - 1) / 26;
        }
        return sb.toString();
    }
}
