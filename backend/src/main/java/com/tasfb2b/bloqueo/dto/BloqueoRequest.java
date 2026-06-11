package com.tasfb2b.bloqueo.dto;

import com.tasfb2b.bloqueo.domain.TipoBloqueo;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.Instant;

/**
 * DTO para crear o actualizar un bloqueo operacional.
 * Cubre B05 (TRAMO), B06 (NODO), B07-B10 (AVERIA).
 */
public record BloqueoRequest(
        @NotNull TipoBloqueo tipo,
        @NotBlank String origenIcao,
        String destinoIcao,           // solo para TRAMO
        @NotNull Instant inicio,
        @NotNull Instant fin,
        Integer capacidadReducidaPct, // solo para AVERIA
        Integer averiaType,           // 1-4, solo para AVERIA
        String descripcion
) {}
