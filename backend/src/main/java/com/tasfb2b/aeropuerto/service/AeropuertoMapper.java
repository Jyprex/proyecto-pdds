package com.tasfb2b.aeropuerto.service;

import com.tasfb2b.aeropuerto.domain.Aeropuerto;
import com.tasfb2b.aeropuerto.dto.*;

public class AeropuertoMapper {

    public static Aeropuerto toEntity(AeropuertoRequest request) {
        return Aeropuerto.builder()
                .icaoCode(request.icaoCode())
                .city(request.city())
                .country(request.country())
                .continent(request.continent())
                .storageCapacity(request.storageCapacity())
                .gmtOffset(request.gmtOffset())
                .latitude(request.latitude())
                .longitude(request.longitude())
                .build();
    }

    public static AeropuertoResponse toResponse(Aeropuerto entity) {
        return new AeropuertoResponse(
                entity.getId(),
                entity.getIcaoCode(),
                entity.getCity(),
                entity.getCountry(),
                entity.getContinent(),
                entity.getStorageCapacity(),
                entity.getGmtOffset(),
                entity.getLatitude(),
                entity.getLongitude()
        );
    }
}