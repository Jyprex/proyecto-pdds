package com.tasfb2b.vuelo.repository;

import com.tasfb2b.vuelo.domain.Vuelo;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface VueloRepository extends JpaRepository<Vuelo, Long> {

    /** Retorna todos los vuelos con cancelación activa (para restaurar al día siguiente). */
    @Query("select v from Vuelo v join fetch v.origen join fetch v.destino where v.cancelled = true")
    List<Vuelo> findByCancelledTrue();

    @Query("select v from Vuelo v join fetch v.origen join fetch v.destino where v.id in :ids")
    List<Vuelo> findAllByIdWithAirports(@Param("ids") List<Long> ids);

    @Query("select v from Vuelo v join fetch v.origen join fetch v.destino")
    List<Vuelo> findAllWithAirports();
}