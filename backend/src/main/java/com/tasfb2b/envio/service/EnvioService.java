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
        if (envioRepo.existsByFechaBetween(inicio, fin)) {
            return; // Ya está cargado en H2, evitamos SQL Error 23505 (Unique Constraint)
        }

        java.nio.file.Path folder = java.nio.file.Path.of(dataPath);
        String startStr = inicio.format(DateTimeFormatter.BASIC_ISO_DATE);
        String endStr = fin.format(DateTimeFormatter.BASIC_ISO_DATE);

        try (java.nio.file.DirectoryStream<java.nio.file.Path> stream = java.nio.file.Files.newDirectoryStream(folder, "_envios_*.txt")) {
            for (java.nio.file.Path archivo : stream) {
                List<String> lineasFecha = new java.util.ArrayList<>();
                try (java.io.BufferedReader br = java.nio.file.Files.newBufferedReader(archivo)) {
                    String linea;
                    while ((linea = br.readLine()) != null) {
                        int guion = linea.indexOf('-');
                        if (guion < 0 || linea.length() <= guion + 8) continue;
                        String f = linea.substring(guion + 1, guion + 9);
                        if (f.compareTo(startStr) >= 0 && f.compareTo(endStr) <= 0) {
                            lineasFecha.add(linea);
                        }
                    }
                }
                if (!lineasFecha.isEmpty()) {
                    cargarDesdeLineasArchivo(archivo.getFileName().toString(), lineasFecha);
                }
            }
        } catch (Exception e) {
            throw new RuntimeException("Error en carga bajo demanda", e);
        }
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
