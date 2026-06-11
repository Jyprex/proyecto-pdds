package com.tasfb2b.bloqueo.domain;

public enum TipoBloqueo {
    /** B05: Bloqueo de un tramo origen→destino */
    TRAMO,
    /** B06: Bloqueo de un nodo (aeropuerto completo) */
    NODO,
    /** B07–B10: Avería con efecto sobre capacidad o vuelos */
    AVERIA
}
