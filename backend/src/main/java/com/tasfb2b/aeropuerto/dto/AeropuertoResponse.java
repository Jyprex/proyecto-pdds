package com.tasfb2b.aeropuerto.dto;

import com.tasfb2b.aeropuerto.domain.Continente;

public record AeropuertoResponse(
        Long id,
        String icaoCode,
        String city,
        String country,
        Continente continent,
        Integer storageCapacity,
        Integer gmtOffset,
        Double latitude,
        Double longitude
) {}