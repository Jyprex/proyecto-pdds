package com.tasfb2b.bloqueo.repository;

import com.tasfb2b.bloqueo.domain.Bloqueo;
import com.tasfb2b.bloqueo.domain.TipoBloqueo;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;

public interface BloqueoRepository extends JpaRepository<Bloqueo, Long> {

    List<Bloqueo> findByActivoTrue();

    List<Bloqueo> findByTipoAndActivoTrue(TipoBloqueo tipo);

    @Query("SELECT b FROM Bloqueo b WHERE b.activo = true " +
           "AND b.inicio <= :momento AND b.fin >= :momento")
    List<Bloqueo> findVigenteEn(@Param("momento") Instant momento);

    @Query("SELECT b FROM Bloqueo b WHERE b.activo = true " +
           "AND b.tipo = 'TRAMO' " +
           "AND b.origenIcao = :origen AND b.destinoIcao = :destino " +
           "AND b.inicio <= :momento AND b.fin >= :momento")
    List<Bloqueo> findTramoVigenteEn(@Param("origen") String origen,
                                     @Param("destino") String destino,
                                     @Param("momento") Instant momento);

    @Query("SELECT b FROM Bloqueo b WHERE b.activo = true " +
           "AND b.tipo = 'NODO' " +
           "AND b.origenIcao = :icao " +
           "AND b.inicio <= :momento AND b.fin >= :momento")
    List<Bloqueo> findNodoVigenteEn(@Param("icao") String icao,
                                    @Param("momento") Instant momento);
}
