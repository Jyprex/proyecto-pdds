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
            log.error("[EnvioService] Origen no registrado, se omite: {}", nombreArchivo);
            return;
        }

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
            if (existentes.contains(codigo) || !seenInBatch.add(codigo)) {
                continue;
            }

            Aeropuerto destino = aeropuertoCache.get(parsed.destinoIcao());
            if (destino == null) {
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
        for (LocalDate d = inicio; !d.isAfter(fin); d = d.plusDays(1)) {
            cargarPorDia(d, dataPath);
        }
    }

    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.REQUIRES_NEW)
    public synchronized void cargarPorDia(LocalDate dia, String dataPath) {
        if (envioRepo.existsByFecha(dia)) {
            return;
        }

        String diaStr = dia.format(DateTimeFormatter.BASIC_ISO_DATE);
        java.nio.file.Path folder = java.nio.file.Path.of(dataPath);

        List<java.nio.file.Path> archivos = new ArrayList<>();
        try (java.nio.file.DirectoryStream<java.nio.file.Path> stream =
                     java.nio.file.Files.newDirectoryStream(folder, "_envios_*.txt")) {
            stream.forEach(archivos::add);
        } catch (Exception e) {
            throw new RuntimeException("Error leyendo directorio: " + folder, e);
        }

        // Leer en paralelo, altamente IO/CPU bound
        Map<String, List<String>> lineasPorArchivo = archivos.parallelStream()
            .map(archivo -> {
                List<String> lineasFecha = new ArrayList<>();
                try (java.io.BufferedReader br = java.nio.file.Files.newBufferedReader(archivo)) {
                    String linea;
                    while ((linea = br.readLine()) != null) {
                        int guion = linea.indexOf('-');
                        if (guion < 0 || linea.length() <= guion + 8) continue;
                        // Usar regionMatches es más rápido que substring() y no crea nuevos objetos String
                        if (linea.regionMatches(guion + 1, diaStr, 0, 8)) {
                            lineasFecha.add(linea);
                        }
                    }
                } catch (Exception e) {
                    log.error("Error leyendo archivo {}", archivo, e);
                }
                return Map.entry(archivo.getFileName().toString(), lineasFecha);
            })
            .filter(entry -> !entry.getValue().isEmpty())
            .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));

        // Insertar secuencialmente para evitar bloqueos concurrentes en la DB H2
        for (Map.Entry<String, List<String>> entry : lineasPorArchivo.entrySet()) {
            cargarDesdeLineasArchivo(entry.getKey(), entry.getValue());
        }

        log.info("[Memoria] Cargados envíos del día {} a H2 (Multi-hilo)", dia);
    }

    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.REQUIRES_NEW)
    public void purgarAntesDe(LocalDate fecha) {
        envioRepo.deleteByFechaBefore(fecha);
        log.info("[Memoria] Purgados envíos anteriores a {}", fecha);
    }

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

    @Transactional
    public void registrarManual(com.tasfb2b.envio.web.UserEnvioRequest req) {
        Aeropuerto origen = aeropuertoRepo.findByIcaoCode(req.getOrigenIcao())
                .orElseThrow(() -> new RuntimeException("Origen no encontrado: " + req.getOrigenIcao()));
        Aeropuerto destino = aeropuertoRepo.findByIcaoCode(req.getDestinoIcao())
                .orElseThrow(() -> new RuntimeException("Destino no encontrado: " + req.getDestinoIcao()));

        String codigo9 = String.format("%09d", new java.util.Random().nextInt(1000000000));

        envioRepo.save(Envio.builder()
                .codigoPedido(codigo9)
                .fecha(req.getFecha())
                .hora(req.getHora())
                .origen(origen)
                .destino(destino)
                .cantidadMaletas(req.getCantidadMaletas())
                .clienteId(req.getClienteId())
                .build());
    }

    @Transactional
    public void registrarLoteUsuario(List<String> lineas) {
        Map<String, Aeropuerto> aeropuertoCache = aeropuertoRepo.findAll()
                .stream()
                .collect(Collectors.toMap(Aeropuerto::getIcaoCode, a -> a));

        List<Envio> batch = new ArrayList<>();
        java.util.Random random = new java.util.Random();

        for (String linea : lineas) {
            String[] parts = linea.split(",");
            if (parts.length < 6) continue;

            try {
                LocalDate fecha = LocalDate.parse(parts[0].trim()); // ISO-8601 (yyyy-MM-dd)
                LocalTime hora = LocalTime.parse(parts[1].trim());
                String origenIcao = parts[2].trim();
                String destinoIcao = parts[3].trim();
                Integer cantidad = Integer.parseInt(parts[4].trim());
                String clienteId = parts[5].trim();

                Aeropuerto origen = aeropuertoCache.get(origenIcao);
                Aeropuerto destino = aeropuertoCache.get(destinoIcao);

                if (origen == null || destino == null) continue;

                String codigo9 = String.format("%09d", random.nextInt(1000000000));

                batch.add(Envio.builder()
                        .codigoPedido(codigo9)
                        .fecha(fecha)
                        .hora(hora)
                        .origen(origen)
                        .destino(destino)
                        .cantidadMaletas(cantidad)
                        .clienteId(clienteId)
                        .build());

            } catch (Exception e) {
                log.warn("[EnvioService] Error parseando linea de usuario: {}", linea);
            }
        }

        if (!batch.isEmpty()) {
            envioRepo.saveAll(batch);
        }
    }
}
