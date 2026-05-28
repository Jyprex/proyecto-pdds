package com.tasfb2b.experiment;

/*
 * Sistema TASF.B2B — Motor de Optimización Logística
 * Grupo 4D — Curso de Proyecto de Diseño de Software
 * Autores: Jim Navarrete, Diego Silvestre, Jose Avalos, Mathias Medina
 * Fecha: Mayo 2026
 */

import com.tasfb2b.aeropuerto.domain.Aeropuerto;
import com.tasfb2b.aeropuerto.repository.AeropuertoRepository;
import com.tasfb2b.planificador.domain.Route;
import com.tasfb2b.planificador.domain.Solution;
import com.tasfb2b.planificador.service.ALNSPlannerService;
import com.tasfb2b.planificador.simulation.SimulationRunner;
import com.tasfb2b.planificador.simulation.SimulationState;
import com.tasfb2b.superlote.domain.SuperLot;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.lang.management.ManagementFactory;
import com.sun.management.OperatingSystemMXBean;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * Servicio de experimentación numérica DOE (Design of Experiments) sobre el dataset TASF.B2B.
 *
 * <p>Calcula 5 niveles de demanda (MIN, MID_LOW, AVG, MID_HIGH, MAX) a partir de los archivos
 * históricos de envíos, ejecuta el algoritmo seleccionado (HGA o ALNS) sobre cada nivel y
 * produce métricas de eficiencia logística para comparación estadística.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class NumericExperimentService {

    private final AeropuertoRepository airportRepo;
    private final ALNSPlannerService alnsPlanner;
    private final SimulationRunner simulationRunner;

    @Value("${tasf.data.path}")
    private String dataPath;

    /** Ventana de ejecución ALNS — escenario TIEMPO_REAL (~6.5 s). */
    private static final long ALNS_WINDOW_MS  = 6_500L;
    /**
     * Umbral de colapso computacional (Sa). Si {@code planningTimeMs >= SA_THRESHOLD_MS},
     * el algoritmo excedió la ventana operativa antes del siguiente despegue crítico.
     */
    private static final long SA_THRESHOLD_MS     = 15_000L;
    private static final int  CAPACIDAD_AVIONES_DIA = 946_000;

    private final Map<String, ExperimentSession> activeSessions = new ConcurrentHashMap<>();

    // ─────────────────────────────────────────────────────────────────────────
    // 1. CÁLCULO DOE DINÁMICO DESDE ARCHIVOS PLANOS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Escanea TODOS los archivos _envios_*.txt y calcula los 5 niveles estadísticos DOE.
     * Usa lectura de stream línea a línea (sin cargar todo en RAM).
     * No toca la base de datos.
     */
    public List<ExperimentSession.LevelDefinition> calculateDOELevels() {
        Map<String, Long> resumenDiario = new LinkedHashMap<>();
        Path folder = Path.of(dataPath);

        try (DirectoryStream<Path> stream = Files.newDirectoryStream(folder, "_envios_*.txt")) {
            for (Path archivo : stream) {
                try (BufferedReader br = Files.newBufferedReader(archivo)) {
                    String linea;
                    while ((linea = br.readLine()) != null) {
                        // Filtro rápido: extrae fecha (YYYYMMDD) del campo [1] sin parsear todo
                        int guion = linea.indexOf('-');
                        if (guion < 0 || linea.length() <= guion + 8) continue;
                        String fechaRaw = linea.substring(guion + 1, guion + 9); // YYYYMMDD

                        String[] partes = linea.split("-");
                        if (partes.length < 6) continue;
                        try {
                            long cantidad = Long.parseLong(partes[5].trim());
                            resumenDiario.merge(fechaRaw, cantidad, Long::sum);
                        } catch (NumberFormatException ignored) {}
                    }
                }
            }
        } catch (Exception e) {
            log.error("Error calculando niveles DOE desde archivos", e);
            return Collections.emptyList();
        }

        if (resumenDiario.size() < 2) {
            log.warn("Datos insuficientes para DOE: solo {} días encontrados", resumenDiario.size());
            return Collections.emptyList();
        }

        // ── Estadísticas ─────────────────────────────────────────────────────
        long minVal = Long.MAX_VALUE, maxVal = Long.MIN_VALUE;
        String fechaMin = null, fechaMax = null;
        double suma = 0;

        for (Map.Entry<String, Long> entry : resumenDiario.entrySet()) {
            long v = entry.getValue();
            suma += v;
            if (v < minVal) { minVal = v; fechaMin = entry.getKey(); }
            if (v > maxVal) { maxVal = v; fechaMax = entry.getKey(); }
        }

        double avg    = suma / resumenDiario.size();
        double midLow = (minVal + avg) / 2.0;
        double midHigh = (avg + maxVal) / 2.0;

        // Para nivel 2, 3 y 4 buscamos la fecha cuyo total es más cercano al valor objetivo
        // Excluimos las fechas ya asignadas para que no se repitan
        Set<String> usadas = new HashSet<>(Arrays.asList(fechaMin, fechaMax));
        String fechaMidLow  = findClosestDate(resumenDiario, midLow,  usadas);
        usadas.add(fechaMidLow);
        String fechaAvg     = findClosestDate(resumenDiario, avg,     usadas);
        usadas.add(fechaAvg);
        String fechaMidHigh = findClosestDate(resumenDiario, midHigh, usadas);

        log.info("[DOE] Días escaneados: {} | Min: {} ({}) | Max: {} ({}) | Avg: {}",
                resumenDiario.size(), minVal, fechaMin, maxVal, fechaMax, (long) avg);

        // ── Construir lista de 5 LevelDefinitions ────────────────────────────
        List<ExperimentSession.LevelDefinition> levels = new ArrayList<>();

        levels.add(ExperimentSession.LevelDefinition.builder()
                .name("Caso Mínimo de Envíos")
                .levelTag("MIN")
                .fecha(toIsoDate(fechaMin))
                .suitcaseCount(minVal)
                .build());

        levels.add(ExperimentSession.LevelDefinition.builder()
                .name("Caso Intermedio Inferior")
                .levelTag("MID_LOW")
                .fecha(toIsoDate(fechaMidLow))
                .suitcaseCount(resumenDiario.getOrDefault(fechaMidLow, (long) midLow))
                .build());

        levels.add(ExperimentSession.LevelDefinition.builder()
                .name("Caso Operación Promedio")
                .levelTag("AVG")
                .fecha(toIsoDate(fechaAvg))
                .suitcaseCount(resumenDiario.getOrDefault(fechaAvg, (long) avg))
                .build());

        levels.add(ExperimentSession.LevelDefinition.builder()
                .name("Caso Intermedio Superior")
                .levelTag("MID_HIGH")
                .fecha(toIsoDate(fechaMidHigh))
                .suitcaseCount(resumenDiario.getOrDefault(fechaMidHigh, (long) midHigh))
                .build());

        levels.add(ExperimentSession.LevelDefinition.builder()
                .name("Caso Máximo Estrés")
                .levelTag("MAX")
                .fecha(toIsoDate(fechaMax))
                .suitcaseCount(maxVal)
                .build());

        return levels;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. GESTIÓN DE SESIONES
    // ─────────────────────────────────────────────────────────────────────────

    public ExperimentSession createSession(String algorithm, List<ExperimentSession.LevelDefinition> levels) {
        ExperimentSession session = new ExperimentSession();
        session.setAlgorithm(algorithm);
        session.setLevels(levels);
        activeSessions.put(session.getId(), session);
        log.info("[Experiment] Sesión creada: {} | Algoritmo: {} | Niveles: {}",
                session.getId(), algorithm, levels.size());
        return session;
    }

    public ExperimentSession getSession(String id) {
        return activeSessions.get(id);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. MOTOR DE EJECUCIÓN ASÍNCRONO
    // ─────────────────────────────────────────────────────────────────────────

    @Async("simulationExecutor")
    public void runExperiment(String sessionId) {
        ExperimentSession session = activeSessions.get(sessionId);
        if (session == null) return;

        session.setStatus(ExperimentSession.Status.RUNNING);

        // Cargar mapa de aeropuertos una sola vez para toda la batería
        Map<String, Aeropuerto> airportMap = airportRepo.findAll().stream()
                .collect(Collectors.toMap(Aeropuerto::getIcaoCode, a -> a));

        try {
            List<ExperimentSession.LevelDefinition> levels = session.getLevels();

            for (int i = 0; i < levels.size(); i++) {
                session.setCurrentLevelIndex(i);
                session.setProgressPercent((i * 100) / levels.size());

                ExperimentSession.LevelDefinition levelDef = levels.get(i);

                // Cada nivel carga sus propios datos de SU fecha histórica real
                LocalDate fechaDelNivel = LocalDate.parse(levelDef.getFecha());
                List<SuperLot> lots = agruparDia(fechaDelNivel, airportMap);
                log.info("[Experiment] Nivel {}/{}: {} | Fecha: {} | {} SuperLots | {} maletas",
                        i + 1, levels.size(), levelDef.getName(),
                        levelDef.getFecha(), lots.size(),
                        lots.stream().mapToLong(SuperLot::getTotalMaletas).sum());

                ExperimentRunResult result = runSingleLevel(i, levelDef, session.getAlgorithm(),
                        airportMap, lots);
                session.getResults().add(result);
            }

            session.setProgressPercent(100);
            session.setCurrentLevelIndex(-1); // Completado
            session.setStatus(ExperimentSession.Status.DONE);
            log.info("[Experiment] Sesión {} completada exitosamente.", sessionId);

        } catch (Exception e) {
            log.error("[Experiment] Error en sesión {}: {}", sessionId, e.getMessage(), e);
            session.setStatus(ExperimentSession.Status.FAILED);
            session.setErrorMessage(e.getMessage());
        }
    }

    /**
     * Punto de entrada pública para {@link com.tasfb2b.experiment.ExcelExportService}.
     * Delega en la implementación privada del ciclo de experimentación por nivel.
     */
    public ExperimentRunResult runSingleLevelPublic(int levelIndex,
                                                    ExperimentSession.LevelDefinition levelDef,
                                                    String algorithm,
                                                    Map<String, Aeropuerto> airportMap,
                                                    List<SuperLot> lots) {
        return runSingleLevel(levelIndex, levelDef, algorithm, airportMap, lots);
    }

    private ExperimentRunResult runSingleLevel(int levelIndex,
                                               ExperimentSession.LevelDefinition levelDef,
                                               String algorithm,
                                               Map<String, Aeropuerto> airportMap,
                                               List<SuperLot> lots) {
        LocalDate fecha = LocalDate.parse(levelDef.getFecha());
        long totalMaletasDia = lots.stream().mapToLong(SuperLot::getTotalMaletas).sum();

        OperatingSystemMXBean osBean =
                (OperatingSystemMXBean) ManagementFactory.getOperatingSystemMXBean();
        Runtime runtime = Runtime.getRuntime();
        long loadingTimeMs = 0;

        long t1 = System.currentTimeMillis();
        Solution sol = alnsPlanner.plan(lots, ALNS_WINDOW_MS);
        long planningTimeMs = System.currentTimeMillis() - t1;

        boolean colapsoComputacional = planningTimeMs >= SA_THRESHOLD_MS;
        if (colapsoComputacional) {
            log.warn("[COLAPSO COMPUTACIONAL] Nivel {} | Algoritmo: {} | Ta={}ms >= Sa={}ms",
                    levelDef.getLevelTag(), algorithm, planningTimeMs, SA_THRESHOLD_MS);
        }

        long t2 = System.currentTimeMillis();
        long epochStart = LocalDateTime.of(fecha, LocalTime.MIN)
                .toInstant(ZoneOffset.UTC).toEpochMilli();
        SimulationState state = simulationRunner.run(sol.getRoutes(), airportMap, epochStart, epochStart);
        long simulationTimeMs = System.currentTimeMillis() - t2;

        long totalTimeMs = loadingTimeMs + planningTimeMs + simulationTimeMs;
        double cpuLoad   = osBean.getSystemCpuLoad() * 100.0;
        double memUsed   = (runtime.totalMemory() - runtime.freeMemory()) / (1024.0 * 1024.0);

        long totalAtendidas   = 0;
        double totalDelayHoras = 0;
        int lotesAtendidos    = 0;
        int lotesNoAtendidos  = 0;
        long maxCapRuta       = 0;
        long capAeroTotal = airportMap.values().stream()
                .mapToLong(a -> a.getStorageCapacity() != null ? a.getStorageCapacity() : 0L)
                .sum();

        for (Route r : sol.getRoutes()) {
            if (!r.isNoAtendido()) {
                long cap = r.getCapacidadAsignada();
                totalAtendidas += cap;
                lotesAtendidos++;
                maxCapRuta = Math.max(maxCapRuta, cap);
                if (r.getArrivalTime() > 0) {
                    totalDelayHoras += (r.getArrivalTime() - r.getLot().getReadyTime()) / 3_600_000.0;
                }
            } else {
                lotesNoAtendidos++;
            }
        }

        double avgCapRuta = lotesAtendidos > 0 ? (double) totalAtendidas / lotesAtendidos : 0;
        int totalRutas    = sol.getRoutes().size();

        long ecap       = Math.max(0, (totalMaletasDia - totalAtendidas) - capAeroTotal);
        double compliance = totalMaletasDia > 0 ? (totalAtendidas * 100.0) / totalMaletasDia : 0;
        double satAero    = state.getSaturacionAeropuerto();

        double score = (10.0 * lotesAtendidos)
                     - (0.005 * ecap)
                     - (2.0  * totalDelayHoras)
                     - (12.0 * satAero);

        log.info("[Experiment] Nivel {} ({}) → Rutas: {}/{} atendidas | Max ruta: {} | Tiempo: {}ms (plan:{}ms sim:{}ms)",
                levelIndex + 1, levelDef.getLevelTag(), lotesAtendidos, totalRutas, maxCapRuta,
                totalTimeMs, planningTimeMs, simulationTimeMs);

        return ExperimentRunResult.builder()
                .levelIndex(levelIndex)
                .levelName(levelDef.getName())
                .levelTag(levelDef.getLevelTag())
                .fecha(levelDef.getFecha())
                .targetSuitcases(totalMaletasDia)
                .status("COMPLETED")
                // KPIs Logísticos
                .occupancyRate(round1(compliance > 0 ? (totalAtendidas * 100.0) / CAPACIDAD_AVIONES_DIA : 0))
                .leadTimeAvg(round1(lotesAtendidos > 0 ? totalDelayHoras / lotesAtendidos : 0))
                .complianceRate(round1(totalMaletasDia > 0 ? (totalAtendidas * 100.0) / totalMaletasDia : 0))
                .fitnessScore(round2(score))
                .totalProcessed(totalMaletasDia)
                .totalAttended(totalAtendidas)
                .totalEcap(ecap)
                .totalRoutes(totalRutas)
                .routesServed(lotesAtendidos)
                .routesUnserved(lotesNoAtendidos)
                .maxRouteCapacity(maxCapRuta)
                .avgRouteCapacity(round1(avgCapRuta))
                .loadingTimeMs(loadingTimeMs)
                .planningTimeMs(planningTimeMs)
                .simulationTimeMs(simulationTimeMs)
                .executionTimeMs(totalTimeMs)
                .memoryUsedMb(round1(memUsed))
                .cpuUsagePercent(round1(cpuLoad))
                .avgAirportSaturation(round1(satAero))
                .algorithmWindowMs(ALNS_WINDOW_MS)
                .colapsoComputacional(colapsoComputacional)
                .build();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. LECTURA DE ARCHIVOS PARA UNA FECHA ESPECÍFICA
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Lee todos los archivos _envios_*.txt y agrupa los envíos de la fecha dada
     * en SuperLots por par (origen, destino). Usa filtro rápido por posición de string.
     */
    /** API pública para ExcelExportService */
    public List<SuperLot> agruparDiaPublic(LocalDate fecha, Map<String, Aeropuerto> airportMap) {
        return agruparDia(fecha, airportMap);
    }

    private List<SuperLot> agruparDia(LocalDate fecha, Map<String, Aeropuerto> airportMap) {
        String fechaStr = fecha.toString().replace("-", ""); // YYYYMMDD
        Map<String, DailyAccumulator> acum = new HashMap<>();
        Path folder = Path.of(dataPath);

        Map<String, Integer> continents = airportMap.entrySet().stream()
                .collect(Collectors.toMap(Map.Entry::getKey,
                        e -> e.getValue().getContinent() != null ? e.getValue().getContinent().ordinal() : 0));

        try (DirectoryStream<Path> stream = Files.newDirectoryStream(folder, "_envios_*.txt")) {
            for (Path archivo : stream) {
                // Extraer ICAO del nombre: _envios_XXXX_.txt
                String nombre = archivo.getFileName().toString();
                String origenIcao = nombre.replaceAll("_envios_|_\\.txt", "").replace(".txt", "");

                try (BufferedReader br = Files.newBufferedReader(archivo)) {
                    String linea;
                    while ((linea = br.readLine()) != null) {
                        // Filtro rápido por fecha (sin split completo)
                        int guion = linea.indexOf('-');
                        if (guion < 0 || linea.length() <= guion + 8) continue;
                        if (!linea.substring(guion + 1, guion + 9).equals(fechaStr)) continue;

                        String[] p = linea.split("-");
                        if (p.length < 6) continue;

                        String destinoIcao = p[4].trim();
                        int cantidad;
                        try { cantidad = Integer.parseInt(p[5].trim()); }
                        catch (NumberFormatException e) { continue; }

                        String key = origenIcao + "-" + destinoIcao;
                        acum.computeIfAbsent(key, k -> new DailyAccumulator(origenIcao, destinoIcao))
                            .add(cantidad);
                    }
                }
            }
        } catch (Exception e) {
            log.error("Error agrupando día {} desde archivos planos", fecha, e);
        }

        long readyTime = LocalDateTime.of(fecha, LocalTime.MIN)
                .toInstant(ZoneOffset.UTC).toEpochMilli();

        List<SuperLot> lotes = new ArrayList<>();
        int idSeq = 0;
        for (DailyAccumulator acc : acum.values()) {
            int oc = continents.getOrDefault(acc.origen, 0);
            int dc = continents.getOrDefault(acc.destino, 0);
            boolean inter = (oc != dc);
            long sla = inter ? 48L * 3_600_000 : 24L * 3_600_000;
            lotes.add(new SuperLot(idSeq++, acc.origen, acc.destino,
                    acc.totalMaletas, readyTime, sla, inter, 0));
        }

        log.info("[Experiment] Fecha {} → {} SuperLots cargados desde archivos", fecha, lotes.size());
        return lotes;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 6. UTILIDADES
    // ─────────────────────────────────────────────────────────────────────────

    /** Encuentra la fecha cuyo total es más cercano al objetivo, excluyendo las ya usadas. */
    private String findClosestDate(Map<String, Long> data, double target, Set<String> excluidas) {
        String best = null;
        double bestDiff = Double.MAX_VALUE;
        for (Map.Entry<String, Long> e : data.entrySet()) {
            if (excluidas.contains(e.getKey())) continue;
            double diff = Math.abs(e.getValue() - target);
            if (diff < bestDiff) {
                bestDiff = diff;
                best = e.getKey();
            }
        }
        // Fallback: si todos están excluidos, usar el primero disponible
        if (best == null) {
            best = data.keySet().stream()
                    .filter(k -> !excluidas.contains(k))
                    .findFirst()
                    .orElse(data.keySet().iterator().next());
        }
        return best;
    }

    /** Convierte YYYYMMDD → YYYY-MM-DD */
    private String toIsoDate(String yyyymmdd) {
        if (yyyymmdd == null || yyyymmdd.length() != 8) return yyyymmdd;
        return yyyymmdd.substring(0, 4) + "-"
             + yyyymmdd.substring(4, 6) + "-"
             + yyyymmdd.substring(6, 8);
    }

    private double round1(double v) { return Math.round(v * 10.0) / 10.0; }
    private double round2(double v) { return Math.round(v * 100.0) / 100.0; }

    // ─────────────────────────────────────────────────────────────────────────
    // 7. CLASE INTERNA DE ACUMULACIÓN
    // ─────────────────────────────────────────────────────────────────────────

    private static class DailyAccumulator {
        final String origen, destino;
        int totalMaletas;
        DailyAccumulator(String o, String d) { this.origen = o; this.destino = d; }
        void add(int b) { totalMaletas += b; }
    }
}
