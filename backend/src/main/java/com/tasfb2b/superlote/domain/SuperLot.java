package com.tasfb2b.superlote.domain;

import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;
import java.util.HashMap;
import java.util.Map;

@Data
@NoArgsConstructor
public class SuperLot {

    private int id;
    private String origenIcao;
    private String destinoIcao;
    private int totalMaletas;
    private long readyTime;
    private long sla;
    private boolean intercontinental;
    private int priority;
    /** Códigos de envío individuales que componen este lote, con su carga real. */
    private List<String> bagIds = new ArrayList<>();
    private Map<String, Long> bagDeadlines = new HashMap<>();
    private Map<String, Long> bagReadyTimes = new HashMap<>();
    /**
     * Constructor LEGACY — para mantener compatibilidad con todo el código existente
     * que construye SuperLot sin lista de shipments (queda vacía).
     */
    public SuperLot(int id, String origenIcao, String destinoIcao, int totalMaletas,
                    long readyTime, long sla, boolean intercontinental, int priority) {
        this(id, origenIcao, destinoIcao, totalMaletas, readyTime, sla,
                intercontinental, priority, new ArrayList<>());
    }

    /** Constructor NUEVO: para usar códigos de envíos */
    public SuperLot(int id, String origenIcao, String destinoIcao, int totalMaletas,
                    long readyTime, long sla, boolean intercontinental, int priority,
                    List<String> bagIds) {
        this.id = id;
        this.origenIcao = origenIcao;
        this.destinoIcao = destinoIcao;
        this.totalMaletas = totalMaletas;
        this.readyTime = readyTime;
        this.sla = sla;
        this.intercontinental = intercontinental;
        this.priority = priority;
        this.bagIds = (bagIds != null) ? bagIds : new ArrayList<>();
    }

    public SuperLot(int id, String origenIcao, String destinoIcao, int totalMaletas,
                    long readyTime, long sla, boolean intercontinental, int priority,
                    List<String> bagIds, Map<String, Long> bagDeadlines) {
        this(id, origenIcao, destinoIcao, totalMaletas, readyTime, sla, intercontinental, priority, bagIds);
        this.bagDeadlines = (bagDeadlines != null) ? bagDeadlines : new HashMap<>();
    }

    /** Copia con readyTime distinto, preservando bagIds. Útil para perturbaciones (regret). */
    public SuperLot withReadyTime(long newReadyTime) {
        SuperLot copy = new SuperLot(id, origenIcao, destinoIcao, totalMaletas,
                newReadyTime, sla, intercontinental, priority, bagIds, bagDeadlines);
        copy.bagReadyTimes = this.bagReadyTimes;
        return copy;
    }

    /** Códigos de envío distintos contenidos en este lote para trabajar con maletas . */
    public List<String> getCodigosPedido() {
        return bagIds.stream()
                .map(b -> b.substring(0, b.lastIndexOf('-')))
                .distinct()
                .toList();
    }

    public long getDeadline() {
        return readyTime + sla;
    }

    public boolean isFeasibleArrival(long arrivalTime) {
        return arrivalTime <= getDeadline();
    }

    public boolean isExpired(long currentTime) {
        return currentTime > getDeadline();
    }

    public long getUrgencyScore(long currentTime) {
        return getDeadline() - currentTime;
    }

    public String getKey() {
        return origenIcao + "-" + destinoIcao + "-" + readyTime;
    }

    public void validate() {
        if (origenIcao == null || destinoIcao == null) {
            throw new IllegalArgumentException("ICAO no puede ser null");
        }
        if (totalMaletas <= 0) {
            throw new IllegalArgumentException("Maletas debe ser > 0");
        }
        if (sla <= 0) {
            throw new IllegalArgumentException("SLA inválido");
        }
    }

}