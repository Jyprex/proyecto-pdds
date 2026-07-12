package com.tasfb2b.tracking.domain;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class ShipmentState {
    //id de maleta único
    private final String bagId;

    //id del envío
    private final String shipmentCode;

    private ShipmentStatus estado;

    private String aeropuertoActual;

    private Long vueloActual;

    private String vueloInstanceActual;

    private ShipmentStatus pendingEstado;

    private long lastUpdateTime;

    public ShipmentState(String bagId) {
        this.bagId = bagId;
        int idx = bagId.lastIndexOf('-');
        this.shipmentCode = idx > 0 ? bagId.substring(0, idx) : bagId;
        this.estado = ShipmentStatus.SIN_ASIGNAR;
    }
}