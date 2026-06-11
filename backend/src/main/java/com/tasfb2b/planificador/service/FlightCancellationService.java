package com.tasfb2b.planificador.service;

import com.tasfb2b.planificador.domain.Solution;
import com.tasfb2b.vuelo.domain.Vuelo;
import com.tasfb2b.vuelo.repository.VueloRepository;
import com.tasfb2b.planificador.strategy.NetworkAdapter;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Servicio dedicado para cancelación de vuelos con replanificación ALNS.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class FlightCancellationService {

    private final VueloRepository vueloRepository;
    private final ALNSPlannerService alnsPlanner;
    private final SimulationProgressHolder progressHolder;
    private final NetworkAdapter networkAdapter;
    private final PlanningSessionHolder sessionHolder;

    /**
     * Cancela un vuelo y dispara la replanificación ALNS para rescatar rutas afectadas.
     *
     * @param vueloId   ID del vuelo a cancelar
     * @param sessionId ID de la sesión de simulación activa (puede ser null)
     */
    @Transactional
    public void cancelarVuelo(Long vueloId, String sessionId) {
        log.info("Cancelando manualmente el vuelo {}", vueloId);

        Vuelo vuelo = vueloRepository.findById(vueloId)
                .orElseThrow(() -> new IllegalArgumentException("Vuelo no encontrado: " + vueloId));

        vuelo.setCancelled(true);
        vueloRepository.save(vuelo);

        // Invalidar el caché del grafo para que Dijkstra no vuelva a usarlo
        networkAdapter.invalidateGraph();

        // Si hay una simulación en curso, la replanificación se realiza de manera reactiva en el bucle de simulación.
        // Si hay un warm-start o sesión de planificación estática, corremos la replanificación ALNS estática.
        SimulationProgressHolder.SimulationSessionState session = null;
        if (sessionId != null) {
            session = progressHolder.get(sessionId);
        }

        if (session != null) {
            if (sessionHolder.hasSolution()) {
                try {
                    Solution replanned = alnsPlanner.replanificar(vueloId, 6_500L);
                    if (replanned != null && !replanned.getRoutes().isEmpty()) {
                        session.setRescuedFlights(session.getRescuedFlights() + 1);
                        log.info("Replanificación estática exitosa para el vuelo cancelado {}", vueloId);
                    }
                } catch (Exception e) {
                    log.warn("Fallo en replanificación ALNS para vuelo cancelado {}: {}",
                            vueloId, e.getMessage());
                }
            } else {
                log.info("Simulación activa detectada. La replanificación del vuelo {} se realizará de forma reactiva en el ciclo actual/siguiente.", vueloId);
            }
        }
    }
}
