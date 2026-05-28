package com.tasfb2b.superlote.service;

import com.tasfb2b.envio.repository.EnvioRepository;
import com.tasfb2b.envio.repository.EnvioResumen;
import com.tasfb2b.superlote.domain.SuperLot;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.*;
import java.util.stream.Stream;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class SuperLotService {

    private final EnvioRepository envioRepo;

    @Transactional(readOnly = true)
    public List<SuperLot> agruparEnvios() {

        Map<String, Accumulator> grupos = new HashMap<>();

        try (Stream<EnvioResumen> stream = envioRepo.streamResumenes()) {
            stream.forEach(e -> {

                String key = e.getOrigenIcao() + "-" + e.getDestinoIcao();

                long readyTime = LocalDateTime
                        .of(e.getFecha(), e.getHora())
                        .minusHours(e.getOrigenGmtOffset())
                        .toInstant(ZoneOffset.UTC)
                        .toEpochMilli();

                grupos.computeIfAbsent(key, k -> new Accumulator(
                        0,
                        e.getOrigenContinente(),
                        e.getDestinoContinente(),
                        readyTime
                )).add(e.getCantidadMaletas(), readyTime);
            });
        }

        List<SuperLot> superLots = new ArrayList<>();
        int id = 0;

        for (var entry : grupos.entrySet()) {

            String[] partes = entry.getKey().split("-");
            Accumulator acc = entry.getValue();

            boolean intercontinental = acc.origenCont != acc.destinoCont;

            // READY TIME REAL (mínimo del grupo)
            long readyTime = acc.minReadyTime;

            // SLA base por tipo de operación
            long sla = intercontinental
                    ? 48L * 3600_000
                    : 24L * 3600_000;

            SuperLot lot = new SuperLot(
                    id++,
                    partes[0],
                    partes[1],
                    acc.totalMaletas,
                    readyTime,
                    sla,
                    intercontinental,
                    0
            );

            lot.validate();
            superLots.add(lot);
        }

        return superLots;
    }

    /**
     * Igual que agruparEnvios() pero filtrando solo los envíos de una fecha específica.
     * Usado por el loop diario de SimulationService para obtener la demanda REAL de cada día.
     */
    @Transactional(readOnly = true)
    public List<SuperLot> agruparEnviosPorFecha(java.time.LocalDate fecha) {

        Map<String, Accumulator> grupos = new HashMap<>();

        try (Stream<EnvioResumen> stream = envioRepo.streamResumenesPorFecha(fecha)) {
            stream.forEach(e -> {
                String key = e.getOrigenIcao() + "-" + e.getDestinoIcao();

                long readyTime = java.time.LocalDateTime
                        .of(e.getFecha(), e.getHora())
                        .minusHours(e.getOrigenGmtOffset())
                        .toInstant(ZoneOffset.UTC)
                        .toEpochMilli();

                grupos.computeIfAbsent(key, k -> new Accumulator(
                        0,
                        e.getOrigenContinente(),
                        e.getDestinoContinente(),
                        readyTime
                )).add(e.getCantidadMaletas(), readyTime);
            });
        }

        List<SuperLot> superLots = new ArrayList<>();
        int id = 0;

        for (var entry : grupos.entrySet()) {
            String[] partes = entry.getKey().split("-");
            Accumulator acc = entry.getValue();

            boolean intercontinental = acc.origenCont != acc.destinoCont;

            long sla = intercontinental ? 48L * 3600_000 : 24L * 3600_000;

            SuperLot lot = new SuperLot(
                    id++, partes[0], partes[1],
                    acc.totalMaletas, acc.minReadyTime,
                    sla, intercontinental, 0);

            lot.validate();
            superLots.add(lot);
        }

        return superLots;
    }

    // ─────────────────────────────
    // ACCUMULATOR INTERNO
    // ─────────────────────────────
    private static class Accumulator {

        int totalMaletas;
        int origenCont;
        int destinoCont;
        long minReadyTime;

        Accumulator(int totalMaletas, int origenCont, int destinoCont, long readyTime) {
            this.totalMaletas = totalMaletas;
            this.origenCont = origenCont;
            this.destinoCont = destinoCont;
            this.minReadyTime = readyTime;
        }

        void add(int bags, long readyTime) {
            this.totalMaletas += bags;
            this.minReadyTime = Math.min(this.minReadyTime, readyTime);
        }
    }
}