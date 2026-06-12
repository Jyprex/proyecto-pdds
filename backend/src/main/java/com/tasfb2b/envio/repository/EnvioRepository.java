package com.tasfb2b.envio.repository;

import com.tasfb2b.envio.domain.Envio;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.CrudRepository;
import org.springframework.data.repository.query.Param;
import java.util.List;
import java.util.Set;
import java.util.stream.Stream;

public interface EnvioRepository extends CrudRepository<Envio, Long> {

    @org.springframework.transaction.annotation.Transactional
    void deleteByFechaBetween(java.time.LocalDate inicio, java.time.LocalDate fin);

    boolean existsByFechaBetween(java.time.LocalDate inicio, java.time.LocalDate fin);

    /** Verifica si existe al menos un envío para una fecha específica. */
    boolean existsByFecha(java.time.LocalDate fecha);

    @Query("""
    SELECT
        e.origen.icaoCode       AS origenIcao,
        e.destino.icaoCode      AS destinoIcao,
        e.cantidadMaletas       AS cantidadMaletas,
        e.origen.continent      AS origenContinente,
        e.destino.continent     AS destinoContinente,
        e.origen.gmtOffset      AS origenGmtOffset,
        e.fecha                 AS fecha,
        e.hora                  AS hora
    FROM Envio e
""")
    Stream<EnvioResumen> streamResumenes();

    /** Igual que streamResumenes pero filtrado por fecha — para el loop diario */
    @Query("""
    SELECT
        e.origen.icaoCode       AS origenIcao,
        e.destino.icaoCode      AS destinoIcao,
        e.cantidadMaletas       AS cantidadMaletas,
        e.origen.continent      AS origenContinente,
        e.destino.continent     AS destinoContinente,
        e.origen.gmtOffset      AS origenGmtOffset,
        e.fecha                 AS fecha,
        e.hora                  AS hora
    FROM Envio e
    WHERE e.fecha = :fecha
""")
    Stream<EnvioResumen> streamResumenesPorFecha(@org.springframework.data.repository.query.Param("fecha") java.time.LocalDate fecha);

    @Query("""
    SELECT
        e.origen.icaoCode       AS origenIcao,
        e.destino.icaoCode      AS destinoIcao,
        e.cantidadMaletas       AS cantidadMaletas,
        e.origen.continent      AS origenContinente,
        e.destino.continent     AS destinoContinente,
        e.origen.gmtOffset      AS origenGmtOffset,
        e.fecha                 AS fecha,
        e.hora                  AS hora
    FROM Envio e
    WHERE e.fecha >= :inicio AND e.fecha <= :fin
""")
    Stream<EnvioResumen> streamResumenesPorRangoFechas(
        @org.springframework.data.repository.query.Param("inicio") java.time.LocalDate inicio,
        @org.springframework.data.repository.query.Param("fin") java.time.LocalDate fin
    );

    /** Total real de maletas por día dentro de un rango (para el reporte de demanda) */
    @Query("SELECT e.fecha as fecha, SUM(e.cantidadMaletas) as total FROM Envio e WHERE e.fecha BETWEEN :inicio AND :fin GROUP BY e.fecha ORDER BY e.fecha ASC")
    List<DailyTotal> findDailyTotalsByRange(
        @org.springframework.data.repository.query.Param("inicio") java.time.LocalDate inicio,
        @org.springframework.data.repository.query.Param("fin") java.time.LocalDate fin);

    @Query("SELECT e.fecha as fecha, SUM(e.cantidadMaletas) as total FROM Envio e GROUP BY e.fecha ORDER BY SUM(e.cantidadMaletas) ASC")
    List<DailyTotal> findDailyTotals();

    /** Devuelve los codigoPedido ya registrados para un origen, para pre-filtrar duplicados. */
    @Query("SELECT e.codigoPedido FROM Envio e WHERE e.origen.icaoCode = :icao")
    Set<String> findCodigosByOrigenIcao(@Param("icao") String icao);

    /** Elimina envíos con fecha anterior a la dada (sliding window para liberar heap). */
    @org.springframework.transaction.annotation.Transactional
    @org.springframework.data.jpa.repository.Modifying
    @Query("DELETE FROM Envio e WHERE e.fecha < :antes")
    void deleteByFechaBefore(@Param("antes") java.time.LocalDate antes);

    interface DailyTotal {
        java.time.LocalDate getFecha();
        Long getTotal();
    }
}
