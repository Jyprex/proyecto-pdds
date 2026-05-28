package com.tasfb2b.vuelo.domain;

import com.tasfb2b.aeropuerto.domain.Aeropuerto;
import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "vuelos")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Vuelo {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    // ── RELACIONES ─────────────────────────────────────

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "origen_id", nullable = false)
    private Aeropuerto origen;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "destino_id", nullable = false)
    private Aeropuerto destino;

    // ── DATOS DE NEGOCIO (INMUTABLES EN SIMULACIÓN) ─────

    @Column(nullable = false)
    private Integer capacidadTotal;

    /**
     * Minutos desde 00:00 (0 - 1439)
     */
    @Column(nullable = false)
    private Integer departureMinute;

    /**
     * Minutos desde 00:00 (0 - 1439)
     */
    @Column(nullable = false)
    private Integer arrivalMinute;

    /**
     * Flag precalculado (opcional pero útil)
     */
    @Column(nullable = false)
    private Boolean intercontinental;

    /**
     * Indica si el vuelo está cancelado
     */
    @Column(nullable = false)
    private Boolean cancelled;

    @Version
    private Long version;

    // ── MÉTODOS DE NEGOCIO ─────────────────────────────

    /**
     * Duración del vuelo en minutos.
     * Maneja cruce de medianoche.
     */
    public int getDuracionMinutos() {

        int depLocal = departureMinute;
        int arrLocal = arrivalMinute;

        int depUtc = depLocal - (origen.getGmtOffset() * 60);
        int arrUtc = arrLocal - (destino.getGmtOffset() * 60);

        // Normalizar a rango positivo (0–1440)
        depUtc = (depUtc + 1440) % 1440;
        arrUtc = (arrUtc + 1440) % 1440;

        if (arrUtc >= depUtc) {
            return arrUtc - depUtc;
        } else {
            // cruza medianoche en UTC
            return (1440 - depUtc) + arrUtc;
        }
    }

    /**
     * Duración en milisegundos.
     */
    public long getDuracionMs() {
        return getDuracionMinutos() * 60_000L;
    }

    /**
     * Calcula el siguiente departureTime válido en base a un tiempo actual.
     */
    public long calcularSiguienteSalida(long currentTimeMs) {

        long dayMs = 24L * 60 * 60 * 1000;

        long baseDay = (currentTimeMs / dayMs) * dayMs;

        long departure = baseDay + departureMinute * 60_000L;

        if (departure < currentTimeMs) {
            departure += dayMs; // siguiente día
        }

        return departure;
    }

    /**
     * Calcula el arrivalTime real en base a un tiempo actual.
     */
    public long calcularArrivalDesde(long currentTimeMs) {
        long departure = calcularSiguienteSalida(currentTimeMs);
        return departure + getDuracionMs();
    }

    /**
     * Validación básica del dominio.
     */
    public void validar() {

        if (departureMinute == null || arrivalMinute == null) {
            throw new IllegalStateException("Los tiempos no pueden ser null");
        }

        if (departureMinute < 0 || departureMinute >= 1440) {
            throw new IllegalStateException("departureMinute fuera de rango");
        }

        if (arrivalMinute < 0 || arrivalMinute >= 1440) {
            throw new IllegalStateException("arrivalMinute fuera de rango");
        }

        if (capacidadTotal == null || capacidadTotal <= 0) {
            throw new IllegalStateException("Capacidad inválida");
        }

        if (cancelled == null) {
            throw new IllegalStateException("cancelled no puede ser null");
        }
    }

    /**
     * Verifica si este vuelo puede ser usado dado un tiempo actual.
     */
    public boolean esFactibleDesde(long currentTimeMs) {
        long departure = calcularSiguienteSalida(currentTimeMs);
        return departure >= currentTimeMs;
    }

    /**
     * Epoch UTC del departure en el día de simulación dado.
     *
     * @param dayStartEpochMs epoch UTC del inicio del día simulado
     *   (calculado por SimulationService como
     *   {@code fechaInicio.plusDays(day).atStartOfDay(ZoneOffset.UTC).toEpochMilli()}).
     *   No tiene relación con el reloj del servidor.
     */
    public long getDepartureEpoch(long dayStartEpochMs) {
        int depUtc = (departureMinute - origen.getGmtOffset() * 60 + 1440) % 1440;
        return dayStartEpochMs + (depUtc * 60_000L);
    }

    /**
     * Epoch UTC del arrival en el día de simulación dado.
     * Maneja cruce de medianoche UTC: si el arrival cae antes del departure
     * en el mismo día (UTC), se suma 24 h para posicionarlo en el día siguiente.
     *
     * @param dayStartEpochMs epoch UTC del inicio del día simulado.
     */
    public long getArrivalEpoch(long dayStartEpochMs) {
        int depUtc = (departureMinute - origen.getGmtOffset()  * 60 + 1440) % 1440;
        int arrUtc = (arrivalMinute   - destino.getGmtOffset() * 60 + 1440) % 1440;
        long dep = dayStartEpochMs + (depUtc * 60_000L);
        long arr = dayStartEpochMs + (arrUtc * 60_000L);
        // Cruce de medianoche UTC: el avión llega al día siguiente
        if (arr <= dep) arr += 24L * 60 * 60_000L;
        return arr;
    }

}