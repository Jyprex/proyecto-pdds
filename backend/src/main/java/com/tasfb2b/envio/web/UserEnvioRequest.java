package com.tasfb2b.envio.web;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.time.LocalTime;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UserEnvioRequest {
    private LocalDate fecha;
    private LocalTime hora;
    private String origenIcao;
    private String destinoIcao;
    private Integer cantidadMaletas;
    private String clienteId;
}
