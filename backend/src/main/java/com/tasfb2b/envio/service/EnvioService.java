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
import com.tasfb2b.envio.dto.EnvioResponse;

import java.time.LocalDateTime;
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

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;

@Service
@RequiredArgsConstructor
@Slf4j
public class EnvioService {

    private final EnvioRepository envioRepo;
    private final AeropuertoRepository aeropuertoRepo;

    @org.springframework.beans.factory.annotation.Autowired
    @org.springframework.context.annotation.Lazy
    private com.tasfb2b.planificador.service.SimulationProgressHolder progressHolder;

    @org.springframework.beans.factory.annotation.Autowired
    @org.springframework.context.annotation.Lazy
    private com.tasfb2b.tracking.service.ShipmentTrackerRegistry trackerRegistry;

    private static final int BATCH_SIZE = 500;

    @Transactional(readOnly = true)
    public Page<EnvioResponse> listar(Pageable pageable) {
        return envioRepo.findAll(pageable)
                .map(this::toResponse);
    }

    @Transactional(readOnly = true)
    public Page<EnvioResponse> buscar(
            String origen,
            String destino,
            String codigo,
            Pageable pageable
    ) {
        origen = (origen == null || origen.isBlank()) ? null : origen;
        destino = (destino == null || destino.isBlank()) ? null : destino;
        codigo = (codigo == null || codigo.isBlank()) ? null : codigo;
        return envioRepo
                .buscar(
                        origen,
                        destino,
                        codigo,
                        pageable
                )
                .map(this::toResponse);
    }

    private EnvioResponse toResponse(Envio e) {
        String estado = "PENDIENTE";
        Long vueloAsignado = null;

        if (progressHolder != null && trackerRegistry != null) {
            List<String> sessions = progressHolder.getAllSessionIds();
            if (!sessions.isEmpty()) {
                var tracker = trackerRegistry.get(sessions.get(0));
                if (tracker != null) {
                    List<com.tasfb2b.tracking.domain.ShipmentState> bags = tracker.getByShipment(e.getCodigoPedido());
                    if (bags != null && !bags.isEmpty()) {
                        com.tasfb2b.tracking.domain.ShipmentState firstBag = bags.get(0);
                        if (firstBag != null) {
                            if (firstBag.getEstado() != null) {
                                estado = firstBag.getEstado().name();
                            }
                            vueloAsignado = firstBag.getVueloActual();
                        }
                    }
                }
            }
        }

        return new EnvioResponse(
                e.getId(),
                e.getCodigoPedido(),
                e.getOrigen().getIcaoCode(),
                e.getOrigen().getCity(),
                e.getOrigen().getCountry(),
                e.getDestino().getIcaoCode(),
                e.getDestino().getCity(),
                e.getDestino().getCountry(),
                e.getCantidadMaletas(),
                e.getFecha(),
                e.getHora(),
                estado,
                vueloAsignado
        );
    }

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

            // Normalización a UTC: Ajustar fecha/hora según GMT offset del origen
            java.time.LocalDateTime localDT = java.time.LocalDateTime.of(
                    LocalDate.parse(parsed.fecha(), DateTimeFormatter.BASIC_ISO_DATE),
                    LocalTime.parse(parsed.hora())
            );
            // Restamos el offset para pasar de local a UTC (ej: -5h offset -> restamos -5 = sumamos 5h)
            java.time.ZonedDateTime utcDT = localDT.atZone(java.time.ZoneId.ofOffset("GMT", 
                    java.time.ZoneOffset.ofHours(origen.getGmtOffset()))).withZoneSameInstant(java.time.ZoneOffset.UTC);

            batch.add(Envio.builder()
                    .codigoPedido(codigo)
                    .fecha(utcDT.toLocalDate())
                    .hora(utcDT.toLocalTime())
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

        java.nio.file.Path folder = java.nio.file.Path.of(dataPath);
        List<java.nio.file.Path> archivos = new ArrayList<>();
        try (java.nio.file.DirectoryStream<java.nio.file.Path> stream =
                     java.nio.file.Files.newDirectoryStream(folder, "_envios_*.txt")) {
            stream.forEach(archivos::add);
        } catch (Exception e) {
            throw new RuntimeException("Error leyendo directorio: " + folder, e);
        }

        Map<String, Aeropuerto> aeropuertoCache = aeropuertoRepo.findAll()
                .stream()
                .collect(Collectors.toMap(Aeropuerto::getIcaoCode, a -> a));

        // Leer en paralelo, altamente IO/CPU bound. Ya NO filtramos por el
        // string crudo del archivo (aaaammdd local) — ese filtro asumía que
        // fecha local == fecha UTC, lo cual es FALSO para cualquier aeropuerto
        // con offset GMT != 0 y horas cercanas a medianoche. Ahora parseamos y
        // convertimos CADA línea a UTC primero, y filtramos por el resultado
        // real. Sin esto, líneas cuya conversión cruza medianoche (ej. fecha
        // local 02/03 00:26 con offset -5 -> UTC 01/03 05:26) se perdían
        // silenciosamente: no calificaban para el día que el texto decía, ni
        // para el día anterior (porque ese día ya se había cargado y marcado
        // como completo antes de que esta línea llegara).
        for (java.nio.file.Path archivo : archivos) {
            String origenIcao = NombreArchivoParser.extraerIcao(archivo.getFileName().toString());
            Aeropuerto origen = aeropuertoCache.get(origenIcao);
            if (origen == null) {
                log.error("[EnvioService] Origen no registrado, se omite: {}", archivo.getFileName());
                continue;
            }

            Set<String> existentes = envioRepo.findCodigosByOrigenIcao(origenIcao);
            Set<String> seenInBatch = new HashSet<>();
            List<Envio> batch = new ArrayList<>(BATCH_SIZE);

            try (java.io.BufferedReader br = java.nio.file.Files.newBufferedReader(archivo)) {
                String linea;
                while ((linea = br.readLine()) != null) {
                    ParsedEnvio parsed;
                    try {
                        parsed = EnvioParser.parse(linea);
                    } catch (Exception e) {
                        continue;
                    }
                    if (parsed == null) continue;

                    String codigo = parsed.codigo();
                    if (existentes.contains(codigo) || !seenInBatch.add(codigo)) continue;

                    Aeropuerto destino = aeropuertoCache.get(parsed.destinoIcao());
                    if (destino == null) continue;

                    LocalDateTime localDT = LocalDateTime.of(
                            LocalDate.parse(parsed.fecha(), DateTimeFormatter.BASIC_ISO_DATE),
                            LocalTime.parse(parsed.hora())
                    );
                    java.time.ZonedDateTime utcDT = localDT.atZone(java.time.ZoneId.ofOffset("GMT",
                            java.time.ZoneOffset.ofHours(origen.getGmtOffset()))).withZoneSameInstant(java.time.ZoneOffset.UTC);

                    // ← Filtro correcto: por la fecha UTC REAL, no por el texto crudo.
                    if (!utcDT.toLocalDate().equals(dia)) continue;

                    batch.add(Envio.builder()
                            .codigoPedido(codigo)
                            .fecha(utcDT.toLocalDate())
                            .hora(utcDT.toLocalTime())
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
            } catch (Exception e) {
                log.error("Error leyendo archivo {}", archivo, e);
            }

            if (!batch.isEmpty()) {
                envioRepo.saveAll(batch);
            }
        }

        log.info("[Memoria] Cargados envíos del día {} a H2 (filtrado por fecha UTC real)", dia);
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

    private LocalDateTime convertirLocalAUtc(
            LocalDate fechaLocal,
            LocalTime horaLocal,
            Aeropuerto origen
    ) {
        LocalDateTime fechaHoraLocal =
                LocalDateTime.of(fechaLocal, horaLocal);

        return fechaHoraLocal.minusHours(origen.getGmtOffset());
    }

    @Transactional
    public void registrarManual(com.tasfb2b.envio.web.UserEnvioRequest req) {
        Aeropuerto origen = aeropuertoRepo.findByIcaoCode(req.getOrigenIcao())
                .orElseThrow(() -> new RuntimeException("Origen no encontrado: " + req.getOrigenIcao()));
        Aeropuerto destino = aeropuertoRepo.findByIcaoCode(req.getDestinoIcao())
                .orElseThrow(() -> new RuntimeException("Destino no encontrado: " + req.getDestinoIcao()));

        LocalDateTime fechaHoraUtc =
                convertirLocalAUtc(
                        req.getFecha(),
                        req.getHora(),
                        origen
                );

        String codigo9 = String.format("%09d", new java.util.Random().nextInt(1000000000));

        envioRepo.save(Envio.builder()
                .codigoPedido(codigo9)
                .fecha(fechaHoraUtc.toLocalDate())
                .hora(fechaHoraUtc.toLocalTime())
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
                LocalDateTime fechaHoraUtc =
                        convertirLocalAUtc(
                                fecha,
                                hora,
                                origen
                        );
                String codigo9 = String.format("%09d", random.nextInt(1000000000));

                batch.add(Envio.builder()
                        .codigoPedido(codigo9)
                        .fecha(fechaHoraUtc.toLocalDate())
                        .hora(fechaHoraUtc.toLocalTime())
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
