package com.tasfb2b.aeropuerto.web;

import com.tasfb2b.aeropuerto.dto.*;
import com.tasfb2b.aeropuerto.service.AeropuertoService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/aeropuertos")
@RequiredArgsConstructor
public class AeropuertoController {

    private final AeropuertoService service;

    @PostMapping
    public AeropuertoResponse crear(@Valid @RequestBody AeropuertoRequest request) {
        return service.crear(request);
    }

    @GetMapping("/{id}")
    public AeropuertoResponse obtener(@PathVariable Long id) {
        return service.obtenerPorId(id);
    }

    @GetMapping
    public List<AeropuertoResponse> listar() {
        return service.listar();
    }

    @DeleteMapping("/{id}")
    public void eliminar(@PathVariable Long id) {
        service.eliminar(id);
    }

    /** B02: Actualizar atributos de un almacén/aeropuerto */
    @PutMapping("/{id}")
    public AeropuertoResponse actualizar(@PathVariable Long id,
                                          @Valid @RequestBody AeropuertoRequest request) {
        return service.actualizar(id, request);
    }
}