package com.tasfb2b.bloqueo.web;

import com.tasfb2b.bloqueo.domain.TipoBloqueo;
import com.tasfb2b.bloqueo.dto.BloqueoRequest;
import com.tasfb2b.bloqueo.dto.BloqueoResponse;
import com.tasfb2b.bloqueo.service.BloqueoService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * Controlador REST para gestión de bloqueos operacionales.
 *
 * <p>Cubre los ítems de la rúbrica:
 * <ul>
 *   <li>B05 — POST/DELETE bloqueos de tipo TRAMO</li>
 *   <li>B06 — POST/DELETE bloqueos de tipo NODO</li>
 *   <li>B07–B10 — POST/DELETE bloqueos de tipo AVERIA (averiaType 1–4)</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/v1/bloqueos")
@RequiredArgsConstructor
public class BloqueoController {

    private final BloqueoService service;

    /** Crear bloqueo (TRAMO, NODO o AVERIA) */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public BloqueoResponse crear(@Valid @RequestBody BloqueoRequest request) {
        return service.crear(request);
    }

    /** Listar todos los bloqueos activos */
    @GetMapping
    public List<BloqueoResponse> listarActivos() {
        return service.listarActivos();
    }

    /** Listar bloqueos vigentes en este momento */
    @GetMapping("/vigentes")
    public List<BloqueoResponse> listarVigentes() {
        return service.listarVigentesAhora();
    }

    /** Listar por tipo: TRAMO, NODO, AVERIA */
    @GetMapping("/tipo/{tipo}")
    public List<BloqueoResponse> listarPorTipo(@PathVariable TipoBloqueo tipo) {
        return service.listarPorTipo(tipo);
    }

    /** Desactivar un bloqueo (sin eliminarlo) */
    @PatchMapping("/{id}/desactivar")
    public void desactivar(@PathVariable Long id) {
        service.desactivar(id);
    }

    /** Eliminar definitivamente un bloqueo */
    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void eliminar(@PathVariable Long id) {
        service.eliminar(id);
    }
}
