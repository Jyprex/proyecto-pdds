    package com.tasfb2b.vuelo.service;

import com.tasfb2b.aeropuerto.domain.Aeropuerto;
import com.tasfb2b.aeropuerto.repository.AeropuertoRepository;
import com.tasfb2b.shared.exception.AeropuertoNotFoundException;
import com.tasfb2b.vuelo.domain.Vuelo;
import com.tasfb2b.vuelo.dto.*;
import com.tasfb2b.vuelo.repository.VueloRepository;
import com.tasfb2b.vuelo.util.VueloParser;
import com.tasfb2b.planificador.strategy.NetworkAdapter;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import com.tasfb2b.vuelo.util.ParsedVuelo;
import com.tasfb2b.aeropuerto.repository.AeropuertoRepository;
import java.io.BufferedReader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class VueloService {

    private final VueloRepository vueloRepo;
    private final AeropuertoRepository aeropuertoRepo;
    private final NetworkAdapter networkAdapter;

    @org.springframework.beans.factory.annotation.Autowired
    @org.springframework.context.annotation.Lazy
    private com.tasfb2b.planificador.service.SimulationService simulationService;

    @org.springframework.beans.factory.annotation.Autowired
    @org.springframework.context.annotation.Lazy
    private com.tasfb2b.planificador.service.SimulationProgressHolder progressHolder;

    private int getCurrentMinute() {
        if (progressHolder != null) {
            List<String> sessions = progressHolder.getAllSessionIds();
            if (!sessions.isEmpty()) {
                var state = progressHolder.get(sessions.get(0));
                if (state != null && state.getCurrentEpochTime() != null) {
                    java.time.ZonedDateTime simTime = java.time.Instant.ofEpochMilli(state.getCurrentEpochTime())
                            .atZone(java.time.ZoneOffset.UTC);
                    return simTime.getHour() * 60 + simTime.getMinute();
                }
            }
        }
        java.time.ZonedDateTime now = java.time.ZonedDateTime.now(java.time.ZoneOffset.UTC);
        return now.getHour() * 60 + now.getMinute();
    }

    public VueloResponse crear(VueloRequest request) {
        Map<String, Aeropuerto> aeropuertoCache = aeropuertoRepo.findAll()
                .stream()
                .collect(Collectors.toMap(Aeropuerto::getIcaoCode, a -> a));

        Aeropuerto origen = aeropuertoCache.get(request.origenIcao());
        Aeropuerto destino = aeropuertoCache.get(request.destinoIcao());

        if (origen == null) {
            throw new AeropuertoNotFoundException(request.origenIcao());
        }
        if (destino == null) {
            throw new AeropuertoNotFoundException(request.destinoIcao());
        }

        boolean intercontinental = !origen.getContinent().equals(destino.getContinent());

        int depUtc = (request.departureMinute() - (origen.getGmtOffset() * 60) + 1440) % 1440;
        int arrUtc = (request.arrivalMinute() - (destino.getGmtOffset() * 60) + 1440) % 1440;

        Vuelo vuelo = Vuelo.builder()
                .origen(origen)
                .destino(destino)
                .capacidadTotal(request.capacity())
                .departureMinute(depUtc)
                .arrivalMinute(arrUtc)
                .intercontinental(intercontinental)
                .cancelled(false)
                .reagendado(false)
                .build();

        vueloRepo.save(vuelo);
        
        try {
            simulationService.inyectarVueloEnVivo(vuelo);
        } catch(Exception ignored) {}

        return new VueloResponse(
                vuelo.getId(),
                vuelo.getOrigen().getIcaoCode(),
                vuelo.getDestino().getIcaoCode(),
                vuelo.getCapacidadTotal(),
                vuelo.getCancelled(),
                vuelo.getReagendado(),
                vuelo.getDepartureMinute(),
                vuelo.getArrivalMinute()
        );
    }

    public void cargarDesdeArchivo(Path rutaArchivo) {

        try (BufferedReader reader = Files.newBufferedReader(rutaArchivo)) {

            List<Vuelo> vuelos = new ArrayList<>();

            String linea;

            while ((linea = reader.readLine()) != null) {

                ParsedVuelo parsed = VueloParser.parse(linea);

                Aeropuerto origen = aeropuertoRepo
                        .findByIcaoCode(parsed.origenIcao())
                        .orElseThrow(() ->
                                new RuntimeException("Origen no encontrado: " + parsed.origenIcao()));

                Aeropuerto destino = aeropuertoRepo
                        .findByIcaoCode(parsed.destinoIcao())
                        .orElseThrow(() ->
                                new RuntimeException("Destino no encontrado: " + parsed.destinoIcao()));

                // Normalización a UTC: Restar el GMT offset (local -> UTC)
                // Usamos (minutos + 1440) % 1440 para manejar resultados negativos
                int depUtc = (parsed.departureMinute() - (origen.getGmtOffset() * 60) + 1440) % 1440;
                int arrUtc = (parsed.arrivalMinute() - (destino.getGmtOffset() * 60) + 1440) % 1440;

                boolean intercontinental = origen.getContinent() != destino.getContinent();

                Vuelo vuelo = Vuelo.builder()
                        .origen(origen)
                        .destino(destino)
                        .capacidadTotal(parsed.capacidad())
                        .departureMinute(depUtc)
                        .arrivalMinute(arrUtc)
                        .intercontinental(intercontinental)
                        .cancelled(false)
                        .build();

                vuelos.add(vuelo);
            }

            vueloRepo.saveAll(vuelos);

        } catch (Exception e) {
            throw new RuntimeException("Error cargando vuelos desde: " + rutaArchivo, e);
        }
    }

    public void cancelarVuelo(Long vueloId) {
        Vuelo vuelo = vueloRepo.findById(vueloId)
                .orElseThrow(() -> new RuntimeException("Vuelo no encontrado: " + vueloId));

        vuelo.setCancelled(true);
        vueloRepo.save(vuelo);

        // Invalidar el caché del grafo para que Dijkstra no vuelva a usarlo
        networkAdapter.invalidateGraph();
    }

    public List<VueloResponse> buscar(String query) {
        List<Vuelo> todos = vueloRepo.findAllWithAirports();
        String q = query != null ? query.toUpperCase() : "";
        
        return todos.stream()
                .filter(v -> q.isEmpty()
                        || v.getOrigen().getIcaoCode().contains(q)
                        || v.getDestino().getIcaoCode().contains(q)
                        || v.getId().toString().startsWith(q))
                .map(v -> new VueloResponse(
                        v.getId(),
                        v.getOrigen().getIcaoCode(),
                        v.getDestino().getIcaoCode(),
                        v.getCapacidadTotal(),
                        v.getCancelled(),
                        v.getReagendado(),
                        v.getDepartureMinute(),
                        v.getArrivalMinute()
                ))
                .limit(5000)
                .collect(Collectors.toList());
    }

    public List<VueloResponse> uploadMasivoEnVivo(org.springframework.web.multipart.MultipartFile file) {
        try (BufferedReader reader = new BufferedReader(new java.io.InputStreamReader(file.getInputStream()))) {
            List<VueloResponse> responses = new ArrayList<>();
            String linea;
            int agregados = 0;

            Map<String, Aeropuerto> aeropuertoCache = aeropuertoRepo.findAll()
                    .stream()
                    .collect(Collectors.toMap(Aeropuerto::getIcaoCode, a -> a));

            while ((linea = reader.readLine()) != null) {
                if (linea.trim().isEmpty()) continue;
                
                ParsedVuelo parsed = VueloParser.parse(linea);
                Aeropuerto origen = aeropuertoCache.get(parsed.origenIcao());
                Aeropuerto destino = aeropuertoCache.get(parsed.destinoIcao());

                if (origen == null || destino == null) continue;

                int depUtc = (parsed.departureMinute() - (origen.getGmtOffset() * 60) + 1440) % 1440;
                int arrUtc = (parsed.arrivalMinute() - (destino.getGmtOffset() * 60) + 1440) % 1440;
                boolean intercontinental = !origen.getContinent().equals(destino.getContinent());

                Vuelo vuelo = Vuelo.builder()
                        .origen(origen)
                        .destino(destino)
                        .capacidadTotal(parsed.capacidad())
                        .departureMinute(depUtc)
                        .arrivalMinute(arrUtc)
                        .intercontinental(intercontinental)
                        .cancelled(false)
                        .reagendado(false)
                        .build();

                vuelo = vueloRepo.save(vuelo);
                
                responses.add(new VueloResponse(
                        vuelo.getId(),
                        origen.getIcaoCode(),
                        destino.getIcaoCode(),
                        vuelo.getCapacidadTotal(),
                        vuelo.getCancelled(),
                        vuelo.getReagendado(),
                        vuelo.getDepartureMinute(),
                        vuelo.getArrivalMinute()
                ));
                
                try {
                    simulationService.inyectarVueloEnVivo(vuelo);
                } catch(Exception ignored) {}
                
                agregados++;
            }
            return responses;
        } catch (Exception e) {
            throw new RuntimeException("Error procesando archivo de vuelos: " + e.getMessage());
        }
    }

    public Vuelo obtenerVuelo(Long id) {
        return vueloRepo.findById(id)
                .orElseThrow(() -> new RuntimeException("Vuelo no encontrado: " + id));
    }

    public void eliminar(Long id) {
        if (!vueloRepo.existsById(id)) {
            throw new RuntimeException("Vuelo no encontrado con ID: " + id);
        }
        vueloRepo.deleteById(id);
    }

    public void eliminarTodos() {
        vueloRepo.deleteAll();
    }
}