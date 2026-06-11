package com.tasfb2b.bloqueo.service;

import com.tasfb2b.bloqueo.domain.Bloqueo;
import com.tasfb2b.bloqueo.domain.TipoBloqueo;
import com.tasfb2b.bloqueo.dto.BloqueoRequest;
import com.tasfb2b.bloqueo.dto.BloqueoResponse;
import com.tasfb2b.bloqueo.repository.BloqueoRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

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
        return toResponse(repository.save(bloqueo));
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
        });
    }

    public void eliminar(Long id) {
        repository.deleteById(id);
    }

    /** Comprueba si un tramo está bloqueado en este momento */
    public boolean tramoEstaBloqueado(String origenIcao, String destinoIcao) {
        return tramoEstaBloqueado(origenIcao, destinoIcao, Instant.now());
    }

    public boolean tramoEstaBloqueado(String origenIcao, String destinoIcao, Instant momento) {
        // Un tramo está bloqueado si hay un bloqueo de TRAMO activo o una avería Tipo 4 (corte total)
        boolean tieneBloqueoTramo = !repository.findTramoVigenteEn(origenIcao, destinoIcao, momento).isEmpty();
        if (tieneBloqueoTramo) return true;

        // Verificar avería Tipo 4 (Corte total de tramo)
        return repository.findVigenteEn(momento).stream()
                .anyMatch(b -> b.getTipo() == TipoBloqueo.AVERIA &&
                               Integer.valueOf(4).equals(b.getAveriaType()) &&
                               origenIcao.equals(b.getOrigenIcao()) &&
                               destinoIcao.equals(b.getDestinoIcao()));
    }

    /** Comprueba si un nodo está bloqueado en este momento */
    public boolean nodoEstaBloqueado(String icao) {
        return nodoEstaBloqueado(icao, Instant.now());
    }

    public boolean nodoEstaBloqueado(String icao, Instant momento) {
        // Un nodo está bloqueado si hay un bloqueo de NODO activo o una avería Tipo 2 (Cierre de origen/nodo)
        boolean tieneBloqueoNodo = !repository.findNodoVigenteEn(icao, momento).isEmpty();
        if (tieneBloqueoNodo) return true;

        // Verificar avería Tipo 2 (Cierre de Origen - bloquea salidas de vuelos)
        return repository.findVigenteEn(momento).stream()
                .anyMatch(b -> b.getTipo() == TipoBloqueo.AVERIA &&
                               Integer.valueOf(2).equals(b.getAveriaType()) &&
                               icao.equals(b.getOrigenIcao()));
    }

    /**
     * Obtiene el porcentaje de capacidad reducida por averías vigentes en un nodo.
     * Si no hay averías, retorna 100 (capacidad plena).
     */
    public int getCapacidadEfectivaPct(String icao) {
        return getCapacidadEfectivaPct(icao, Instant.now());
    }

    public int getCapacidadEfectivaPct(String icao, Instant momento) {
        List<Bloqueo> averias = repository.findVigenteEn(momento)
                .stream()
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
        return repository.findVigenteEn(momento).stream()
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
