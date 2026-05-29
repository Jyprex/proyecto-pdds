package com.tasfb2b.envio.repository;

import java.time.LocalDate;
import java.time.LocalTime;

public interface EnvioResumen {

    String getOrigenIcao();
    String getDestinoIcao();
    int getCantidadMaletas();
    String getOrigenContinente();
    String getDestinoContinente();
    int getOrigenGmtOffset();

    LocalDate getFecha();
    LocalTime getHora();
}
