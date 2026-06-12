package com.tasfb2b.planificador.service;

import com.tasfb2b.planificador.domain.SimulationDayReport;
import lombok.extern.slf4j.Slf4j;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.ss.util.CellRangeAddress;
import org.apache.poi.xssf.usermodel.*;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.List;

/**
 * Genera un archivo Excel (.xlsx) con los resultados detallados
 * de una simulación multi-día. Usa el mismo estilo visual dark-theme
 * que ExcelExportService para coherencia visual.
 *
 * <p>El archivo incluye:
 * <ul>
 *   <li>Cabecera con algoritmo, fechas y parámetros de la corrida</li>
 *   <li>Una fila por día simulado</li>
 *   <li>Fila de totales acumulados y promedios diarios</li>
 *   <li>Fila de Fitness Score desglosado</li>
 * </ul>
 */
@Service
@Slf4j
public class SimulationExcelService {

    private static final double CAPACIDAD_AVIONES_DIA = 946_000.0;
    private static final DateTimeFormatter FMT = DateTimeFormatter
            .ofPattern("yyyy-MM-dd").withZone(ZoneOffset.UTC);

    // ── Columnas ──────────────────────────────────────────────────────────────
    private static final String[] COLS = {
        "Día", "Fecha Simulada", "Demanda (Maletas)",
        "Atendidas", "Ecap (No Atend.)", "SLA %",
        "Ocupación %", "Rutas Totales", "Vuelos Activos",
        "Saturación Aero.", "¿Colapso?"
    };

    /**
     * Construye el Excel en memoria y lo retorna como byte[].
     *
     * @param sessionId   UUID de la sesión (para el nombre interno)
     * @param algorithm   Nombre del algoritmo usado (HGA / ALNS)
     * @param startEpoch  Epoch ms del primer día
     * @param reports     Lista de reportes diarios en orden
     * @return bytes del archivo .xlsx
     */
    public byte[] generateExcel(String sessionId,
                                 String algorithm,
                                 long startEpoch,
                                 List<SimulationDayReport> reports) throws IOException {

        try (XSSFWorkbook wb = new XSSFWorkbook();
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {

            XSSFSheet sheet = wb.createSheet("Simulación_" + algorithm);
            sheet.setDefaultColumnWidth(20);

            // ── Estilos ─────────────────────────────────────────────────────
            XSSFColor dark    = xc(15, 23, 42);
            XSSFColor header  = xc(30, 41, 59);
            XSSFColor accent  = xc(99, 102, 241);  // indigo
            XSSFColor green   = xc(5, 150, 105);
            XSSFColor blue    = xc(37, 99, 235);
            XSSFColor red     = xc(239, 68, 68);
            XSSFColor white   = xc(241, 245, 249);
            XSSFColor gold    = xc(251, 191, 36);
            XSSFColor rowA    = xc(30, 41, 59);
            XSSFColor rowB    = xc(15, 23, 42);

            XSSFCellStyle titleSt  = makeStyle(wb, dark, gold, 14, true, true);
            XSSFCellStyle infoSt   = makeStyle(wb, dark, white, 10, false, true);
            XSSFCellStyle headerSt = makeStyle(wb, header, gold, 11, true, true);
            XSSFCellStyle dataASt  = makeStyle(wb, rowA, white, 10, false, true);
            XSSFCellStyle dataBSt  = makeStyle(wb, rowB, white, 10, false, true);
            XSSFCellStyle totalSt  = makeStyle(wb, green, white, 10, true, true);
            XSSFCellStyle avgSt    = makeStyle(wb, blue, white, 10, true, true);
            XSSFCellStyle fitSt    = makeStyle(wb, accent, gold, 11, true, true);
            XSSFCellStyle redSt    = makeStyle(wb, red, white, 10, false, true);

            int row = 0;

            // ── Título ───────────────────────────────────────────────────────
            Row r0 = sheet.createRow(row++);
            r0.setHeightInPoints(28);
            Cell t = r0.createCell(0);
            t.setCellValue("TASF.B2B — Reporte de Simulación · Algoritmo: " + algorithm.toUpperCase());
            t.setCellStyle(titleSt);
            sheet.addMergedRegion(new CellRangeAddress(0, 0, 0, COLS.length - 1));

            // ── Info de la corrida ────────────────────────────────────────────
            String inicioStr = FMT.format(Instant.ofEpochMilli(startEpoch));
            Row r1 = sheet.createRow(row++);
            r1.setHeightInPoints(18);
            Cell info = r1.createCell(0);
            info.setCellValue("Fecha inicio: " + inicioStr
                    + "  |  Días simulados: " + reports.size()
                    + "  |  Sesión: " + sessionId.substring(0, 8) + "...");
            info.setCellStyle(infoSt);
            sheet.addMergedRegion(new CellRangeAddress(1, 1, 0, COLS.length - 1));

            // Fila fórmula fitness
            Row r2 = sheet.createRow(row++);
            r2.setHeightInPoints(16);
            Cell fi = r2.createCell(0);
            fi.setCellValue("Score = 10×A  −  0.005×Ecap  −  2×Dh  −  12×Saero");
            fi.setCellStyle(infoSt);
            sheet.addMergedRegion(new CellRangeAddress(2, 2, 0, COLS.length - 1));

            row++; // separador

            // ── Cabecera de columnas ─────────────────────────────────────────
            Row rh = sheet.createRow(row++);
            rh.setHeightInPoints(22);
            for (int c = 0; c < COLS.length; c++) {
                Cell hc = rh.createCell(c);
                hc.setCellValue(COLS[c]);
                hc.setCellStyle(headerSt);
            }

            // ── Datos por día ─────────────────────────────────────────────────
            long epochMs = startEpoch;
            long diaMs = 24L * 3600 * 1000;

            long sumDemanda = 0, sumAtendidas = 0;
            double sumSla = 0, sumSat = 0;
            int sumRutas = 0;
            int diasCol = 0;

            for (SimulationDayReport rep : reports) {
                diasCol++;
                int demanda    = rep.getTotalMaletas();
                int atendidas  = rep.getMalatetasAtendidas();
                int ecap       = demanda - atendidas;
                double sla     = rep.getSlaPercent();
                double ocp     = (atendidas / CAPACIDAD_AVIONES_DIA) * 100.0;
                int atendidos = rep.getMalatetasAtendidas();
                int invalidos = rep.getTotalMaletas() - atendidos;

                sumDemanda  += demanda;
                sumAtendidas += atendidas;
                sumSla      += sla;
                sumSat      += rep.getAirportSaturation();
                sumRutas    += 0;
                double satAero = rep.getAirportSaturation();
                boolean col    = rep.isColapsed();

                XSSFCellStyle rowSt = (diasCol % 2 == 0) ? dataBSt : dataASt;
                XSSFCellStyle colSt = col ? redSt : rowSt;

                Row dr = sheet.createRow(row++);
                dr.setHeightInPoints(17);
                wc(dr, 0, diasCol,                            rowSt);
                wc(dr, 1, FMT.format(Instant.ofEpochMilli(epochMs)), rowSt);
                wc(dr, 2, demanda,                            rowSt);
                wc(dr, 3, atendidas,                          rowSt);
                wc(dr, 4, ecap,                               ecap > 0 ? redSt : rowSt);
                wcd(dr, 5, sla,                               rowSt);
                wcd(dr, 6, ocp,                               rowSt);
                wc(dr, 7, 0,                                  rowSt);
                wc(dr, 8, 0 /* activeFlights snapshot */,     rowSt);
                wcd(dr, 9, satAero,                           satAero > 100 ? redSt : rowSt);
                wc(dr, 10, col ? "⚠️ SÍ" : "No",             colSt);

                epochMs += diaMs;
            }

            // ── Fila TOTALES ──────────────────────────────────────────────────
            long ecapTotal = sumDemanda - sumAtendidas;
            Row rt = sheet.createRow(row++);
            rt.setHeightInPoints(18);
            wc(rt, 0, "TOTAL",            totalSt);
            wc(rt, 1, diasCol + " días",  totalSt);
            wc(rt, 2, sumDemanda,         totalSt);
            wc(rt, 3, sumAtendidas,       totalSt);
            wc(rt, 4, ecapTotal,          totalSt);
            for (int c = 5; c < COLS.length; c++) wc(rt, c, "", totalSt);

            // ── Fila PROMEDIOS ────────────────────────────────────────────────
            double avgDemanda   = diasCol > 0 ? (double) sumDemanda  / diasCol : 0;
            double avgAtendidas = diasCol > 0 ? (double) sumAtendidas / diasCol : 0;
            double avgEcap      = avgDemanda - avgAtendidas;
            double avgSlaFinal  = diasCol > 0 ? sumSla / diasCol : 0;
            double avgOcp       = (avgAtendidas / CAPACIDAD_AVIONES_DIA) * 100.0;
            double avgSatFinal  = diasCol > 0 ? sumSat / diasCol : 0;

            Row ra = sheet.createRow(row++);
            ra.setHeightInPoints(18);
            wc(ra,  0, "PROM/DÍA",       avgSt);
            wc(ra,  1, "",               avgSt);
            wcd(ra, 2, avgDemanda,       avgSt);
            wcd(ra, 3, avgAtendidas,     avgSt);
            wcd(ra, 4, avgEcap,          avgSt);
            wcd(ra, 5, avgSlaFinal,      avgSt);
            wcd(ra, 6, avgOcp,           avgSt);
            for (int c = 7; c < COLS.length; c++) wc(ra, c, "", avgSt);

            // ── Fila FITNESS SCORE ────────────────────────────────────────────
            // Score = 10×A − 0.005×Ecap − 2×Dh − 12×Saero
            // A = lotes atendidos (≈ reportes con malatetasAtendidas > 0 total)
            // Para la vista de simulación diaria, usamos las métricas acumuladas
            long lotsA = reports.stream()
                    .filter(r -> r.getMalatetasAtendidas() > 0).count();
            double dh     = 0.0; // Lead Time no está en el report base — se muestra 0
            double saero  = avgSatFinal;
            double score  = 10.0 * lotsA
                          - 0.005 * ecapTotal
                          - 2.0 * dh
                          - 12.0 * saero;

            row++; // separador
            Row rf = sheet.createRow(row++);
            rf.setHeightInPoints(22);
            Cell scoreCell = rf.createCell(0);
            scoreCell.setCellValue(String.format(
                "Fitness Score = 10×%d − 0.005×%d − 2×%.1f − 12×%.2f  =  %.1f",
                lotsA, ecapTotal, dh, saero, score));
            scoreCell.setCellStyle(fitSt);
            sheet.addMergedRegion(new CellRangeAddress(row - 1, row - 1, 0, COLS.length - 1));

            // ── Ajustes de ancho ──────────────────────────────────────────────
            sheet.setColumnWidth(0, 10 * 256);
            sheet.setColumnWidth(1, 18 * 256);
            sheet.setColumnWidth(2, 22 * 256);
            sheet.setColumnWidth(3, 18 * 256);
            sheet.setColumnWidth(4, 20 * 256);
            sheet.createFreezePane(0, 5);

            wb.write(out);
            return out.toByteArray();
        }
    }

    // ── Helpers estilo ────────────────────────────────────────────────────────

    private static XSSFColor xc(int r, int g, int b) {
        return new XSSFColor(new byte[]{(byte) r, (byte) g, (byte) b}, null);
    }

    private static XSSFCellStyle makeStyle(XSSFWorkbook wb,
                                            XSSFColor bg, XSSFColor fg,
                                            int fontSize, boolean bold, boolean center) {
        XSSFCellStyle s = wb.createCellStyle();
        s.setFillForegroundColor(bg);
        s.setFillPattern(FillPatternType.SOLID_FOREGROUND);
        XSSFFont f = wb.createFont();
        f.setBold(bold);
        f.setFontHeightInPoints((short) fontSize);
        f.setColor(fg);
        s.setFont(f);
        if (center) s.setAlignment(HorizontalAlignment.CENTER);
        s.setVerticalAlignment(VerticalAlignment.CENTER);
        s.setBorderBottom(BorderStyle.THIN);
        return s;
    }

    private static void wc(Row row, int col, Object value, XSSFCellStyle style) {
        Cell c = row.createCell(col);
        if (value instanceof Number) {
            c.setCellValue(((Number) value).doubleValue());
        } else {
            c.setCellValue(value != null ? value.toString() : "");
        }
        c.setCellStyle(style);
    }

    private static void wcd(Row row, int col, double value, XSSFCellStyle style) {
        Cell c = row.createCell(col);
        c.setCellValue(Math.round(value * 100.0) / 100.0);
        c.setCellStyle(style);
    }
}
