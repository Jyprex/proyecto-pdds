package com.tasfb2b.planificador.web;

import com.tasfb2b.planificador.domain.Solution;
import com.tasfb2b.planificador.service.PlanningService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/**
 * Controlador REST para el planificador de rutas.
 *
 * <p>Endpoints:
 * <ul>
 *   <li>POST /planificador/ejecutar          → planificación inicial con ALNS</li>
 *   <li>POST /planificador/replanificar      → replanificación operativa por cancelación</li>
 *   <li>GET  /planificador/solucion-actual   → estado del plan vigente</li>
 * </ul>
 */
@RestController
@RequestMapping("/planificador")
@RequiredArgsConstructor
public class PlanningController {

    private final PlanningService planningService;

    // ── ALNS: Planificación inicial ───────────────────────────────

    /**
     * Ejecuta el ALNS sobre todos los SuperLots.
     *
     * @param windowMs tiempo máximo de ejecución en ms (default 5000)
     */
    @PostMapping("/ejecutar")
    public Solution ejecutarALNS(
            @RequestParam(defaultValue = "5000") long windowMs) {
        return planningService.ejecutarALNS(windowMs);
    }

    // ── ALNS: Replanificación operativa ───────────────────────────

    /**
     * Replanifica las rutas afectadas por la cancelación de un vuelo.
     *
     * <p>El vuelo es marcado como cancelled=true en BD antes de ejecutar el ALNS.
     * Al día siguiente, un scheduler lo restaura a false automáticamente.
     *
     * <p>Retorna 409 si no hay planificación activa en memoria.
     *
     * @param vueloId  ID del vuelo a cancelar
     * @param windowMs tiempo máximo de ejecución ALNS en ms (default 3000)
     */
    @PostMapping("/replanificar")
    public ResponseEntity<Solution> replanificar(
            @RequestParam Long vueloId,
            @RequestParam(defaultValue = "3000") long windowMs) {

        try {
            Solution sol = planningService.replanificar(vueloId, windowMs);
            return ResponseEntity.ok(sol);
        } catch (IllegalStateException ex) {
            // No hay plan activo → pedir al usuario que planifique primero
            throw new ResponseStatusException(HttpStatus.CONFLICT, ex.getMessage());
        }
    }

    // ── Estado actual ─────────────────────────────────────────────

    /**
     * Retorna la solución actualmente en memoria (último plan ALNS).
     * Retorna 204 No Content si no hay ningún plan activo.
     */
    @GetMapping("/solucion-actual")
    public ResponseEntity<Solution> getSolucionActual() {
        Solution sol = planningService.getSolucionActual();
        return sol != null
                ? ResponseEntity.ok(sol)
                : ResponseEntity.noContent().build();
    }
}