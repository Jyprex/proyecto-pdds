package com.tasfb2b.aeropuerto.service;

import com.tasfb2b.aeropuerto.domain.Aeropuerto;
import com.tasfb2b.aeropuerto.domain.Continente;
import com.tasfb2b.aeropuerto.dto.*;
import com.tasfb2b.aeropuerto.repository.AeropuertoRepository;
import com.tasfb2b.shared.exception.AeropuertoNotFoundException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import com.tasfb2b.aeropuerto.util.AeropuertoParser;
import com.tasfb2b.aeropuerto.util.ParsedAeropuerto;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.List;
import java.nio.file.Files;
import java.nio.file.Path;

@Service
@RequiredArgsConstructor
public class AeropuertoService {

    private final AeropuertoRepository repository;

    public AeropuertoResponse crear(AeropuertoRequest request) {
        Aeropuerto aeropuerto = AeropuertoMapper.toEntity(request);
        return AeropuertoMapper.toResponse(repository.save(aeropuerto));
    }

    public AeropuertoResponse obtenerPorId(Long id) {
        Aeropuerto aeropuerto = repository.findById(id)
                .orElseThrow(() -> new AeropuertoNotFoundException(id));
        return AeropuertoMapper.toResponse(aeropuerto);
    }

    public List<AeropuertoResponse> listar() {
        return repository.findAll()
                .stream()
                .map(AeropuertoMapper::toResponse)
                .toList();
    }

    public void eliminar(Long id) {
        if (!repository.existsById(id)) {
            throw new AeropuertoNotFoundException(id);
        }
        repository.deleteById(id);
    }

    public void cargarDesdeArchivo(Path rutaArchivo) {

        try {

            byte[] rawBytes = Files.readAllBytes(rutaArchivo);
            String content = new String(rawBytes, java.nio.charset.StandardCharsets.UTF_16);

            List<Aeropuerto> aeropuertos = new ArrayList<>();

            String[] lines = content.split("\\r?\\n");

            Continente currentContinent=null;

            for (String linea : lines) {

                String trimmed = linea.trim();

                if (trimmed.contains("America"))       { currentContinent = Continente.AMERICA; continue; }
                else if (trimmed.contains("Europa"))   { currentContinent = Continente.EUROPE; continue; }
                else if (trimmed.contains("Asia"))     { currentContinent = Continente.ASIA; continue; }

                if (currentContinent == null) continue;


                ParsedAeropuerto parsed = AeropuertoParser.parse(linea);

                if (parsed == null) continue;

                Aeropuerto aeropuerto = Aeropuerto.builder()
                        .icaoCode(parsed.icao())
                        .city(parsed.ciudad())
                        .country(parsed.pais())
                        .gmtOffset(parsed.gmtOffset())
                        .storageCapacity(parsed.capacidad())
                        .latitude(parsed.latitud())
                        .longitude(parsed.longitud())
                        .continent(currentContinent)
                        .build();

                aeropuertos.add(aeropuerto);
            }

            repository.saveAll(aeropuertos);

        } catch (Exception e) {
            throw new RuntimeException("Error cargando aeropuertos desde: " + rutaArchivo, e);
        }
    }
}