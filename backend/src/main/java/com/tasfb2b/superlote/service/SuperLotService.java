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

            boolean intercontinental = !acc.origenCont.equals(acc.destinoCont);

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

            boolean intercontinental = !acc.origenCont.equals(acc.destinoCont);

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

    // Contador global para IDs de MegaLots
    private final java.util.concurrent.atomic.AtomicInteger megaLotIdCounter = new java.util.concurrent.atomic.AtomicInteger(1_000_000);

    /**
     * Fusiona lotes remanentes (carry-over) que tienen el mismo origen, destino e intercontinentalidad.
     * Consolida las maletas sumando su demanda, tomando el readyTime más antiguo y el deadline más restrictivo.
     * Esto reduce N drásticamente bajo colapso extremo.
     */
    public List<SuperLot> mergeLots(List<SuperLot> lots) {
        if (lots == null || lots.isEmpty()) return new ArrayList<>();

        // Clave: origen-destino-intercontinental
        Map<String, List<SuperLot>> grupos = new HashMap<>();
        for (SuperLot lot : lots) {
            String key = lot.getOrigenIcao() + "-" + lot.getDestinoIcao() + "-" + lot.isIntercontinental();
            grupos.computeIfAbsent(key, k -> new ArrayList<>()).add(lot);
        }

        List<SuperLot> result = new ArrayList<>();
        for (List<SuperLot> grupo : grupos.values()) {
            if (grupo.size() == 1) {
                result.add(grupo.get(0));
                continue;
            }

            SuperLot first = grupo.get(0);
            int totalMaletas = 0;
            long minReadyTime = Long.MAX_VALUE;
            long minDeadline = Long.MAX_VALUE;
            int maxPriority = 0;

            for (SuperLot lot : grupo) {
                totalMaletas += lot.getTotalMaletas();
                if (lot.getReadyTime() < minReadyTime) minReadyTime = lot.getReadyTime();
                if (lot.getDeadline() < minDeadline) minDeadline = lot.getDeadline();
                if (lot.getPriority() > maxPriority) maxPriority = lot.getPriority();
            }

            // Evitar SLA negativo si deadline ya pasó, aseguramos que al menos sea 0
            long newSla = Math.max(0L, minDeadline - minReadyTime);

            SuperLot mergedLot = new SuperLot(
                    megaLotIdCounter.getAndIncrement(),
                    first.getOrigenIcao(),
                    first.getDestinoIcao(),
                    totalMaletas,
                    minReadyTime,
                    newSla,
                    first.isIntercontinental(),
                    maxPriority
            );
            result.add(mergedLot);
        }
        return result;
    }

    // ─────────────────────────────
    // ACCUMULATOR INTERNO
    // ─────────────────────────────
    private static class Accumulator {

        int totalMaletas;
        /** Nombre del continente (Continente.name()), inmune a reordenamiento del enum. */
        String origenCont;
        String destinoCont;
        long minReadyTime;

        Accumulator(String origenContName, String destinoContName, long readyTime) {
            this.totalMaletas = 0;
            this.origenCont   = origenContName;
            this.destinoCont  = destinoContName;
            this.minReadyTime = readyTime;
        }

        void add(int bags, long readyTime) {
            this.totalMaletas += bags;
            this.minReadyTime = Math.min(this.minReadyTime, readyTime);
        }
    }
}