package com.tasfb2b.bloqueo.domain;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;

/**
 * Representa un bloqueo operacional sobre la red logística.
 *
 * <p>Cubre los ítems de la rúbrica:
 * <ul>
 *   <li>B05 — Bloqueo de tramo (TRAMO): bloquea un par origen-destino</li>
 *   <li>B06 — Bloqueo de nodo (NODO): bloquea un aeropuerto completo</li>
 *   <li>B07–B10 — Averías tipo 1–4: efectos especiales sobre la red</li>
 * </ul>
 */
@Entity
@Table(name = "bloqueos")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Bloqueo {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** Tipo de bloqueo: TRAMO, NODO o AVERIA */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private TipoBloqueo tipo;

    /**
     * Para TRAMO y AVERIA: ICAO del aeropuerto origen del tramo bloqueado.
     * Para NODO: ICAO del aeropuerto bloqueado.
     */
    @Column(nullable = false)
    private String origenIcao;

    /**
     * Solo para TRAMO: ICAO del aeropuerto destino del tramo bloqueado.
     * Null para NODO.
     */
    private String destinoIcao;

    /** Inicio del periodo de bloqueo (UTC) */
    @Column(nullable = false)
    private Instant inicio;

    /** Fin del periodo de bloqueo (UTC) */
    @Column(nullable = false)
    private Instant fin;

    /**
     * Solo para AVERIA: porcentaje de capacidad restante (0–100).
     * Ej: 50 significa que el almacén opera al 50% de su capacidad.
     * Null si tipo != AVERIA.
     */
    private Integer capacidadReducidaPct;

    /**
     * Sub-tipo de avería (1, 2, 3, 4).
     * Null si tipo != AVERIA.
     */
    private Integer averiaType;

    /** Descripción libre del motivo del bloqueo */
    private String descripcion;

    /** true si el bloqueo está actualmente activo */
    @Column(nullable = false)
    @Builder.Default
    private boolean activo = true;

    /** Comprueba si el bloqueo está vigente en un instante dado */
    public boolean estaVigenteEn(Instant momento) {
        return activo && !momento.isBefore(inicio) && !momento.isAfter(fin);
    }
}
