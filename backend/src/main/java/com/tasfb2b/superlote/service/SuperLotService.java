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
    // Contador global para IDs de MegaLots
    private final java.util.concurrent.atomic.AtomicInteger megaLotIdCounter =
            new java.util.concurrent.atomic.AtomicInteger(1_000_000); //tracking

    @Transactional(readOnly = true)
    public List<SuperLot> agruparEnvios() {

        Map<String, Accumulator> grupos = new HashMap<>();

        try (Stream<EnvioResumen> stream = envioRepo.streamResumenes()) {
            stream.forEach(e -> {

                String key = e.getOrigenIcao() + "-" + e.getDestinoIcao();

                long readyTime = LocalDateTime
                        .of(e.getFecha(), e.getHora())
                        .toInstant(ZoneOffset.UTC)
                        .toEpochMilli();

                grupos.computeIfAbsent(key, k -> new Accumulator(
                        e.getOrigenContinente(),
                        e.getDestinoContinente(),
                        readyTime
                )).add(e.getCantidadMaletas(), readyTime, e.getOrigenIcao(), e.getCodigoPedido());
            });
        }
        return construirLotes(grupos);
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
                        .toInstant(ZoneOffset.UTC)
                        .toEpochMilli();

                grupos.computeIfAbsent(key, k -> new Accumulator(
                        e.getOrigenContinente(),
                        e.getDestinoContinente(),
                        readyTime
                )).add(e.getCantidadMaletas(), readyTime, e.getOrigenIcao(), e.getCodigoPedido());
            });
        }

        return construirLotes(grupos);
    }

    @Transactional(readOnly = true)
    public List<SuperLot> agruparEnviosPorVentana(long startTimeMs, long endTimeMs) {
        Map<String, Accumulator> grupos = new HashMap<>();

        java.time.LocalDate startDate = java.time.Instant.ofEpochMilli(startTimeMs)
                .atZone(java.time.ZoneOffset.UTC)
                .toLocalDate();

        java.time.LocalDate endDate = java.time.Instant.ofEpochMilli(endTimeMs)
                .atZone(java.time.ZoneOffset.UTC)
                .toLocalDate();

        try (Stream<EnvioResumen> stream = envioRepo.streamResumenesPorRangoFechas(startDate, endDate)) {
            stream.forEach(e -> {
                long readyTime = java.time.LocalDateTime
                        .of(e.getFecha(), e.getHora())
                        .toInstant(java.time.ZoneOffset.UTC)
                        .toEpochMilli();

                if (readyTime >= startTimeMs && readyTime < endTimeMs) {
//                    if ("SPIM".equalsIgnoreCase(e.getOrigenIcao())) {
//                        System.out.println(String.format("[BD SPIM] Registro leído -> Pedido: %s | Cantidad: %d | Hora: %s",
//                                e.getCodigoPedido(), e.getCantidadMaletas(), e.getHora()));
//                    }
                    String key = e.getOrigenIcao() + "-" + e.getDestinoIcao();
                    grupos.computeIfAbsent(key, k -> new Accumulator(
                            e.getOrigenContinente(),
                            e.getDestinoContinente(),
                            readyTime
                    )).add(e.getCantidadMaletas(), readyTime, e.getOrigenIcao(), e.getCodigoPedido());
                }
            });
        }

        return construirLotes(grupos);
    }

    private List<SuperLot> construirLotes(Map<String, Accumulator> grupos) {

        List<SuperLot> superLots = new ArrayList<>();

        for (var entry : grupos.entrySet()) {

            String[] partes = entry.getKey().split("-");
            Accumulator acc = entry.getValue();

            boolean intercontinental = !acc.origenCont.equals(acc.destinoCont);
            long sla = intercontinental ? 48L * 3600_000 : 24L * 3600_000;

            Map<String, Long> bagDeadlines = new HashMap<>();
            for (Map.Entry<String, Long> br : acc.bagReadyTimes.entrySet()) {
                bagDeadlines.put(br.getKey(), br.getValue() + sla);
            }

            SuperLot lot = new SuperLot(
                    megaLotIdCounter.getAndIncrement(),
                    partes[0], partes[1], acc.totalMaletas, acc.maxReadyTime, sla,
                    intercontinental, 0, acc.bagIds, bagDeadlines
            );
            lot.setBagReadyTimes(new HashMap<>(acc.bagReadyTimes));

            lot.validate();
            superLots.add(lot);
        }

        return superLots;
    }

    /**
     * Fusiona lotes remanentes que comparten origen, destino e intercontinentalidad
     * — PERO solo cuando fusionarlos preserva un SLA factible para TODOS los bags
     * involucrados.
     *
     * <p>CAUSA RAÍZ de colapsos persistentes con "rutasSinAtender" constante: fusionar
     * ciegamente todos los bags de una ruta usando readyTime=MÁXIMO (necesario para que
     * la ruta nunca despegue antes de que el bag más tardío exista) junto con
     * deadline=MÍNIMO (el compromiso más urgente del grupo) puede producir un SLA
     * fusionado NEGATIVO o CERO cuando el grupo mezcla un bag muy urgente (deadline
     * temprano, de un readyTime antiguo) con un bag recién llegado (readyTime tardío).
     * El lote resultante queda con un plazo IMPOSIBLE de cumplir para cualquier vuelo,
     * apareciendo como "sin ruta" indefinidamente hasta que el deadline real vence —
     * aunque NINGÚN bag individual era realmente infactible por sí solo.
     *
     * <p>Fix: se ordenan los lotes del grupo por deadline ascendente (más urgente
     * primero) y se fusionan incrementalmente en "buckets", solo mientras la fusión
     * mantenga un SLA estrictamente positivo. En cuanto agregar el siguiente lote
     * rompería la factibilidad, se cierra el bucket actual y se empieza uno nuevo.
     */
    public List<SuperLot> mergeLots(List<SuperLot> lots) {
        if (lots == null || lots.isEmpty()) return new ArrayList<>();

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

            // Más urgente primero: así cualquier incompatibilidad se detecta
            // apenas aparece, no al final tras fusionar todo el grupo.
            List<SuperLot> ordenado = new ArrayList<>(grupo);
            ordenado.sort(Comparator.comparingLong(SuperLot::getDeadline));

            List<SuperLot> bucket = new ArrayList<>();
            long bucketMinDeadline = Long.MAX_VALUE;
            long bucketMaxReadyTime = Long.MIN_VALUE;

            for (SuperLot lot : ordenado) {
                long candidateMinDeadline = Math.min(bucketMinDeadline, lot.getDeadline());
                long candidateMaxReadyTime = bucket.isEmpty()
                        ? lot.getReadyTime()
                        : Math.max(bucketMaxReadyTime, lot.getReadyTime());

                boolean feasible = candidateMinDeadline > candidateMaxReadyTime;

                if (bucket.isEmpty() || feasible) {
                    bucket.add(lot);
                    bucketMinDeadline = candidateMinDeadline;
                    bucketMaxReadyTime = candidateMaxReadyTime;
                } else {
                    result.add(mergeBucket(bucket));
                    bucket = new ArrayList<>();
                    bucket.add(lot);
                    bucketMinDeadline = lot.getDeadline();
                    bucketMaxReadyTime = lot.getReadyTime();
                }
            }
            if (!bucket.isEmpty()) result.add(mergeBucket(bucket));
        }
        return result;
    }

    /** Fusiona un bucket YA VALIDADO como factible (ver mergeLots) en un único SuperLot. */
    private SuperLot mergeBucket(List<SuperLot> bucket) {
        if (bucket.size() == 1) return bucket.get(0);

        SuperLot first = bucket.get(0);
        int totalMaletas = 0;
        long maxReadyTime = Long.MIN_VALUE;
        long minDeadline = Long.MAX_VALUE;
        int maxPriority = 0;
        List<String> mergedBagIds = new ArrayList<>();
        Map<String, Long> mergedBagDeadlines = new HashMap<>();
        Map<String, Long> mergedBagReadyTimes = new HashMap<>();

        for (SuperLot lot : bucket) {
            totalMaletas += lot.getTotalMaletas();
            mergedBagIds.addAll(lot.getBagIds());
            mergedBagDeadlines.putAll(lot.getBagDeadlines());
            mergedBagReadyTimes.putAll(lot.getBagReadyTimes());
            if (lot.getReadyTime() > maxReadyTime) maxReadyTime = lot.getReadyTime();
            if (lot.getDeadline() < minDeadline) minDeadline = lot.getDeadline();
            if (lot.getPriority() > maxPriority) maxPriority = lot.getPriority();
        }

        long newSla = Math.max(0L, minDeadline - maxReadyTime);

        SuperLot mergedLot = new SuperLot(
                megaLotIdCounter.getAndIncrement(),
                first.getOrigenIcao(),
                first.getDestinoIcao(),
                totalMaletas,
                maxReadyTime,
                newSla,
                first.isIntercontinental(),
                maxPriority,
                mergedBagIds,
                mergedBagDeadlines
        );
        mergedLot.setBagReadyTimes(mergedBagReadyTimes);
        return mergedLot;
    }

    // ─────────────────────────────
    // ACCUMULATOR INTERNO
    // ─────────────────────────────
    private static class Accumulator {
        int totalMaletas;
        String origenCont;
        String destinoCont;
        long maxReadyTime;
        List<String> bagIds = new ArrayList<>();
        Map<String, Long> bagReadyTimes = new HashMap<>();

        Accumulator(String origenContName, String destinoContName, long readyTime) {
            this.totalMaletas = 0;
            this.origenCont = origenContName;
            this.destinoCont = destinoContName;
            this.maxReadyTime = readyTime;
        }

        void add(int bags, long readyTime, String origenIcao, String codigoPedido) {
            this.totalMaletas += bags;
            this.maxReadyTime = Math.max(this.maxReadyTime, readyTime);
            String globalCode = origenIcao + "_" + codigoPedido;
            for (int i = 1; i <= bags; i++) {
                String bagId = globalCode + "-" + i;
                this.bagIds.add(bagId);
                this.bagReadyTimes.put(bagId, readyTime);
            }
        }
    }
}