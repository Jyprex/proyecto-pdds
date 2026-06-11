package com.tasfb2b.bloqueo.dto;

import com.tasfb2b.bloqueo.domain.TipoBloqueo;

import java.time.Instant;

public record BloqueoResponse(
        Long id,
        TipoBloqueo tipo,
        String origenIcao,
        String destinoIcao,
        Instant inicio,
        Instant fin,
        Integer capacidadReducidaPct,
        Integer averiaType,
        String descripcion,
        boolean activo
) {}
