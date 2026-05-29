package com.tasfb2b.planificador.domain;

public enum EventType {
    LOT_ARRIVAL,
    FLIGHT_DEPARTURE,
    FLIGHT_ARRIVAL,
    /**
     * El cliente recoge sus maletas del almacén destino.
     * Ocurre en un instante aleatorio (semilla fija por lote) dentro de la
     * ventana [arrivalTime, deadline] del SLA contractual de Tasf.B2B.
     * Este evento reduce la carga del aeropuerto destino, evitando el colapso.
     */
    BAGGAGE_PICKUP,
    /**
     * Salida del almacén por permanencia de 24h en hora local del aeropuerto.
     */
    STORAGE_RELEASE,
    FLIGHT_CANCELLED,
    REPLAN_TRIGGER
}
