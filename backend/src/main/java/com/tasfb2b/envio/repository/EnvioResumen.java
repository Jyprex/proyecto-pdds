package com.tasfb2b.envio.repository;

import java.time.LocalDate;
import java.time.LocalTime;

public interface EnvioResumen {

    String getOrigenIcao();
    String getDestinoIcao();
    int getCantidadMaletas();
    int getOrigenContinente();
    int getDestinoContinente();
    int getOrigenGmtOffset();

    LocalDate getFecha();
    LocalTime getHora();
}
