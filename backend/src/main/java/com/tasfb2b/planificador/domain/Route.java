package com.tasfb2b.planificador.domain;

import com.tasfb2b.superlote.domain.SuperLot;
import com.tasfb2b.vuelo.domain.Vuelo;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Route {

    private SuperLot lot;

    private List<String> hops;
    private List<Vuelo> flights;

    private int demandaTotal;
    private int capacidadAsignada;
    private long arrivalTime;
    private long deadline;

    @Builder.Default
    private String status = "normal";

    // ── DERIVADOS ─────────────────────────────────────

    public boolean isIntercontinental() {
        return lot.isIntercontinental();
    }

    public double getPorcentajeAtendido() {
        if (capacidadAsignada == 0) return 0;
        return (double) demandaTotal / capacidadAsignada;
    }

    public int getExcesoCapacidad(){
        return demandaTotal-capacidadAsignada;
    }
    public long getDelayMs() {
        return Math.max(0, arrivalTime - deadline);
    }

    public double getDelayHoras() {
        return getDelayMs() / 3_600_000.0;
    }

    public boolean isAtendido() {
        return capacidadAsignada > 0;
    }

    public boolean isNoAtendido() {
        return capacidadAsignada == 0;
    }

    public boolean isTarde() {
        return arrivalTime > deadline;
    }

    /**
     * Retorna true si la ruta llega antes o exactamente en el deadline.
     * Usado para validar backup routes precalculadas.
     */
    public boolean isFeasibleArrival() {
        return arrivalTime > 0 && arrivalTime <= deadline;
    }

    //Demanda supera la capacidad
    public boolean excedeCapacidad() {
        return capacidadAsignada < demandaTotal;
    }

    // ── CONSISTENCIA ─────────────────────────────────

    public void validarConsistencia() {
        if (hops == null || flights == null) {
            throw new IllegalStateException("Route incompleta");
        }
        if (lot == null) throw new IllegalStateException("Lot null");
        if (flights.size() != hops.size() - 1) {
            throw new IllegalStateException(
                    "flights.size() debe ser hops.size() - 1"
            );
        }
    }

    public void calcularArrivalTime() {

        if (flights == null || flights.isEmpty()) {
            arrivalTime = -1L;
            return;
        }

        long currentTime = lot.getReadyTime();

        for (Vuelo v : flights) {

            long dep = v.calcularSiguienteSalida(currentTime);
            long arr = dep + v.getDuracionMs();

            currentTime = arr;
        }

        this.arrivalTime = currentTime;
    }

    public boolean isSinRuta() {
        return arrivalTime < 0;
    }

    public int getDemandaNoAtendida() {
        return Math.max(0, demandaTotal - capacidadAsignada);
    }

    /**
     * Limpia la ruta para evitar estado sucio al ser reciclada en el RoutePool.
     */
    public void clear() {
        this.lot = null;
        this.hops = null;
        this.flights = null;
        this.demandaTotal = 0;
        this.capacidadAsignada = 0;
        this.arrivalTime = 0;
        this.deadline = 0;
        this.status = "normal";
    }
}