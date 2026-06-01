package com.tasfb2b.envio.service;

import com.tasfb2b.aeropuerto.domain.Aeropuerto;
import com.tasfb2b.aeropuerto.repository.AeropuertoRepository;
import com.tasfb2b.envio.domain.Envio;
import com.tasfb2b.envio.repository.EnvioRepository;
import com.tasfb2b.envio.util.EnvioParser;
import com.tasfb2b.envio.util.NombreArchivoParser;
import com.tasfb2b.envio.util.ParsedEnvio;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Set;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
@Slf4j
public class EnvioService {

    private final EnvioRepository envioRepo;
    private final AeropuertoRepository aeropuertoRepo;

    private static final int BATCH_SIZE = 500;

    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.REQUIRES_NEW)
    public void cargarDesdeLineasArchivo(String nombreArchivo, List<String> lineas) {

        Map<String, Aeropuerto> aeropuertoCache = aeropuertoRepo.findAll()
                .stream()
                .collect(Collectors.toMap(Aeropuerto::getIcaoCode, a -> a));

        String origenIcao = NombreArchivoParser.extraerIcao(nombreArchivo);
        Aeropuerto origen = aeropuertoCache.get(origenIcao);
        if (origen == null) {
            System.err.println("[EnvioService] Origen no registrado, se omite: " + nombreArchivo);
            return;
        }

        // Pre-cargar los códigos ya existentes para este origen — evita excepciones de Hibernate
        java.util.Set<String> existentes = envioRepo.findCodigosByOrigenIcao(origenIcao);
        Set<String> seenInBatch = new HashSet<>();
        List<Envio> batch = new ArrayList<>(BATCH_SIZE);

        for (String linea : lineas) {
            ParsedEnvio parsed;
            try {
                parsed = EnvioParser.parse(linea);
            } catch (Exception e) {
                continue;
            }
            if (parsed == null) continue;

            String codigo = parsed.codigo();
            // Saltar si ya existe en BD o si ya lo vimos en este mismo lote de carga
            if (existentes.contains(codigo) || !seenInBatch.add(codigo)) {
                continue;
            }

            Aeropuerto destino = aeropuertoCache.get(parsed.destinoIcao());
            if (destino == null) {
                System.err.println("Destino no encontrado: " + parsed.destinoIcao());
                continue;
            }

            batch.add(Envio.builder()
                    .codigoPedido(codigo)
                    .fecha(LocalDate.parse(parsed.fecha(), DateTimeFormatter.BASIC_ISO_DATE))
                    .hora(LocalTime.parse(parsed.hora()))
                    .origen(origen)
                    .destino(destino)
                    .cantidadMaletas(parsed.cantidad())
                    .clienteId(parsed.cliente())
                    .build());

            if (batch.size() == BATCH_SIZE) {
                envioRepo.saveAll(batch);
                batch.clear();
            }
        }

        if (!batch.isEmpty()) {
            envioRepo.saveAll(batch);
        }
    }
    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.REQUIRES_NEW)
    public synchronized void cargarPorFecha(LocalDate inicio, LocalDate fin, String dataPath) {
        // Delegamos a carga diaria para no subir todo a RAM de golpe
        for (LocalDate d = inicio; !d.isAfter(fin); d = d.plusDays(1)) {
            cargarPorDia(d, dataPath);
        }
    }

    /**
     * Carga envíos de un SOLO día a H2 — Patrón Ventana Deslizante.
     * Si ya están cargados, no-op (idempotente).
     * Diseñado para ser llamado desde el loop diario de SimulationService,
     * cargando solo el día necesario justo antes de procesarlo.
     */
    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.REQUIRES_NEW)
    public synchronized void cargarPorDia(LocalDate dia, String dataPath) {
        if (envioRepo.existsByFecha(dia)) {
            return; // Ya cargado, evitar duplicados
        }

        String diaStr = dia.format(DateTimeFormatter.BASIC_ISO_DATE);
        java.nio.file.Path folder = java.nio.file.Path.of(dataPath);

        try (java.nio.file.DirectoryStream<java.nio.file.Path> stream =
                     java.nio.file.Files.newDirectoryStream(folder, "_envios_*.txt")) {
            for (java.nio.file.Path archivo : stream) {
                List<String> lineasFecha = new ArrayList<>();
                try (java.io.BufferedReader br = java.nio.file.Files.newBufferedReader(archivo)) {
                    String linea;
                    while ((linea = br.readLine()) != null) {
                        int guion = linea.indexOf('-');
                        if (guion < 0 || linea.length() <= guion + 8) continue;
                        String f = linea.substring(guion + 1, guion + 9);
                        if (f.equals(diaStr)) {
                            lineasFecha.add(linea);
                        }
                    }
                }
                if (!lineasFecha.isEmpty()) {
                    cargarDesdeLineasArchivo(archivo.getFileName().toString(), lineasFecha);
                }
            }
        } catch (Exception e) {
            throw new RuntimeException("Error en carga diaria para " + dia, e);
        }

        log.info("[Memoria] Cargados envíos del día {} a H2", dia);
    }

    /**
     * Purga envíos anteriores a una fecha de H2 para liberar heap.
     * Llamar desde SimulationService al terminar cada día: purgar días ya procesados
     * que no necesitan reconsulta (ventana deslizante de 3 días de retención).
     */
    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.REQUIRES_NEW)
    public void purgarAntesDe(LocalDate fecha) {
        envioRepo.deleteByFechaBefore(fecha);
        log.info("[Memoria] Purgados envíos anteriores a {}", fecha);
    }

    /**
     * Devuelve la demanda REAL de maletas por día en el rango dado.
     * Fuente: tabla Envio en BD (cargada previamente con cargarPorFecha).
     * Clave del mapa: "YYYYMMDD", valor: suma de cantidadMaletas de todos los aeropuertos.
     */
    @Transactional(readOnly = true)
    public java.util.Map<String, Long> getDemandaRealPorFecha(LocalDate inicio, LocalDate fin) {
        return envioRepo.findDailyTotalsByRange(inicio, fin).stream()
                .collect(java.util.stream.Collectors.toMap(
                        dt -> dt.getFecha().format(DateTimeFormatter.BASIC_ISO_DATE),
                        EnvioRepository.DailyTotal::getTotal,
                        Long::sum,
                        java.util.TreeMap::new
                ));
    }
}
