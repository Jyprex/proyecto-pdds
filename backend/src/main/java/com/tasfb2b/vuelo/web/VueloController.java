package com.tasfb2b.vuelo.web;

import com.tasfb2b.vuelo.dto.*;
import com.tasfb2b.vuelo.service.VueloService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/vuelos")
@RequiredArgsConstructor
public class VueloController {

    private final VueloService service;

    @PostMapping("/create")
    public VueloResponse crear(@Valid @RequestBody VueloRequest request) {
        return service.crear(request);
    }

    @GetMapping("/search")
    public List<VueloResponse> buscar(@RequestParam(required = false) String query) {
        return service.buscar(query);
    }

    @PostMapping("/upload")
    public org.springframework.http.ResponseEntity<?> uploadMasivo(@RequestParam("file") org.springframework.web.multipart.MultipartFile file) {
        try {
            return org.springframework.http.ResponseEntity.ok(service.uploadMasivoEnVivo(file));
        } catch (Exception e) {
            return org.springframework.http.ResponseEntity.badRequest().body("Error: " + e.getMessage());
        }
    }

    @DeleteMapping("/{id}")
    public org.springframework.http.ResponseEntity<?> eliminar(@PathVariable Long id) {
        try {
            service.eliminar(id);
            return org.springframework.http.ResponseEntity.ok("Vuelo eliminado correctamente");
        } catch (Exception e) {
            return org.springframework.http.ResponseEntity.badRequest().body("Error: " + e.getMessage());
        }
    }

    @DeleteMapping("/delete-all")
    public org.springframework.http.ResponseEntity<?> eliminarTodos() {
        try {
            service.eliminarTodos();
            return org.springframework.http.ResponseEntity.ok("Todos los vuelos han sido eliminados correctamente.");
        } catch (Exception e) {
            return org.springframework.http.ResponseEntity.badRequest().body("Error: " + e.getMessage());
        }
    }
}