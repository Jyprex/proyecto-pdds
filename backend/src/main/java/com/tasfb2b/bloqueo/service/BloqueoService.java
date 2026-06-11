package com.tasfb2b.bloqueo.service;

import com.tasfb2b.bloqueo.domain.Bloqueo;
import com.tasfb2b.bloqueo.domain.TipoBloqueo;
import com.tasfb2b.bloqueo.dto.BloqueoRequest;
import com.tasfb2b.bloqueo.dto.BloqueoResponse;
import com.tasfb2b.bloqueo.repository.BloqueoRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import java.time.Instant;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Servicio de gestión de bloqueos operacionales.
 * Cubre B05 (tramos), B06 (nodos) y B07-B10 (averías).
 */
@Service
@RequiredArgsConstructor
public class BloqueoService {

    private final BloqueoRepository repository;
    private volatile List<Bloqueo> activeCache = List.of();

    @PostConstruct
    public void init() {
        refreshCache();
    }

    private synchronized void refreshCache() {
        activeCache = repository.findByActivoTrue();
    }

    public BloqueoResponse crear(BloqueoRequest request) {
        Bloqueo bloqueo = Bloqueo.builder()
                .tipo(request.tipo())
                .origenIcao(request.origenIcao())
                .destinoIcao(request.destinoIcao())
                .inicio(request.inicio())
                .fin(request.fin())
                .capacidadReducidaPct(request.capacidadReducidaPct())
                .averiaType(request.averiaType())
                .descripcion(request.descripcion())
                .activo(true)
                .build();
        Bloqueo saved = repository.save(bloqueo);
        refreshCache();
        return toResponse(saved);
    }

    public List<BloqueoResponse> listarActivos() {
        return repository.findByActivoTrue()
                .stream().map(this::toResponse).collect(Collectors.toList());
    }

    public List<BloqueoResponse> listarVigentesAhora() {
        return repository.findVigenteEn(Instant.now())
                .stream().map(this::toResponse).collect(Collectors.toList());
    }

    public List<BloqueoResponse> listarPorTipo(TipoBloqueo tipo) {
        return repository.findByTipoAndActivoTrue(tipo)
                .stream().map(this::toResponse).collect(Collectors.toList());
    }

    public void desactivar(Long id) {
        repository.findById(id).ifPresent(b -> {
            b.setActivo(false);
            repository.save(b);
            refreshCache();
        });
    }

    public void eliminar(Long id) {
        repository.deleteById(id);
        refreshCache();
    }

    /** Comprueba si un tramo está bloqueado en este momento */
    public boolean tramoEstaBloqueado(String origenIcao, String destinoIcao) {
        return tramoEstaBloqueado(origenIcao, destinoIcao, Instant.now());
    }

    public boolean tramoEstaBloqueado(String origenIcao, String destinoIcao, Instant momento) {
        return activeCache.stream().anyMatch(b -> {
            if (momento.isBefore(b.getInicio()) || momento.isAfter(b.getFin())) return false;
            
            boolean esBloqueoTramo = b.getTipo() == TipoBloqueo.TRAMO &&
                                     origenIcao.equals(b.getOrigenIcao()) &&
                                     destinoIcao.equals(b.getDestinoIcao());
            
            boolean esCorteTotal = b.getTipo() == TipoBloqueo.AVERIA &&
                                   Integer.valueOf(4).equals(b.getAveriaType()) &&
                                   origenIcao.equals(b.getOrigenIcao()) &&
                                   destinoIcao.equals(b.getDestinoIcao());
            
            return esBloqueoTramo || esCorteTotal;
        });
    }

    /** Comprueba si un nodo está bloqueado en este momento */
    public boolean nodoEstaBloqueado(String icao) {
        return nodoEstaBloqueado(icao, Instant.now());
    }

    public boolean nodoEstaBloqueado(String icao, Instant momento) {
        return activeCache.stream().anyMatch(b -> {
            if (momento.isBefore(b.getInicio()) || momento.isAfter(b.getFin())) return false;
            
            boolean esBloqueoNodo = b.getTipo() == TipoBloqueo.NODO &&
                                    icao.equals(b.getOrigenIcao());
            
            boolean esCierreOrigen = b.getTipo() == TipoBloqueo.AVERIA &&
                                     Integer.valueOf(2).equals(b.getAveriaType()) &&
                                     icao.equals(b.getOrigenIcao());
            
            return esBloqueoNodo || esCierreOrigen;
        });
    }

    /**
     * Obtiene el porcentaje de capacidad reducida por averías vigentes en un nodo.
     * Si no hay averías, retorna 100 (capacidad plena).
     */
    public int getCapacidadEfectivaPct(String icao) {
        return getCapacidadEfectivaPct(icao, Instant.now());
    }

    public int getCapacidadEfectivaPct(String icao, Instant momento) {
        List<Bloqueo> averias = activeCache.stream()
                .filter(b -> !momento.isBefore(b.getInicio()) && !momento.isAfter(b.getFin()))
                .filter(b -> b.getTipo() == TipoBloqueo.AVERIA &&
                             Integer.valueOf(1).equals(b.getAveriaType()) && // Tipo 1 - Reducción capacidad
                             icao.equals(b.getOrigenIcao()) &&
                             b.getCapacidadReducidaPct() != null)
                .toList();
        if (averias.isEmpty()) return 100;
        return averias.stream()
                .mapToInt(Bloqueo::getCapacidadReducidaPct)
                .min().orElse(100);
    }

    /** Comprueba si hay una avería Tipo 3 (Demora de tránsito) activa para un tramo */
    public boolean tieneDemoraTransito(String origenIcao, String destinoIcao, Instant momento) {
        return activeCache.stream()
                .filter(b -> !momento.isBefore(b.getInicio()) && !momento.isAfter(b.getFin()))
                .anyMatch(b -> b.getTipo() == TipoBloqueo.AVERIA &&
                               Integer.valueOf(3).equals(b.getAveriaType()) &&
                               origenIcao.equals(b.getOrigenIcao()) &&
                               destinoIcao.equals(b.getDestinoIcao()));
    }

    private BloqueoResponse toResponse(Bloqueo b) {
        return new BloqueoResponse(
                b.getId(), b.getTipo(),
                b.getOrigenIcao(), b.getDestinoIcao(),
                b.getInicio(), b.getFin(),
                b.getCapacidadReducidaPct(), b.getAveriaType(),
                b.getDescripcion(), b.isActivo()
        );
    }
}
