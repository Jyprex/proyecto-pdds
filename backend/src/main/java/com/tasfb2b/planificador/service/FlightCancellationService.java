package com.tasfb2b.planificador.service;

import com.tasfb2b.planificador.domain.Solution;
import com.tasfb2b.vuelo.domain.Vuelo;
import com.tasfb2b.vuelo.repository.VueloRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
@Slf4j
public class FlightCancellationService {

    private final VueloRepository vueloRepository;
    private final ALNSPlannerService alnsPlanner;
    private final SimulationProgressHolder progressHolder;

    /**
     * Cancela un vuelo en la base de datos y dispara la replanificación ALNS para rescatar rutas.
     */
    @Transactional
    public void cancelarVuelo(Long vueloId, String sessionId) {
        log.info("Cancelando manualmente el vuelo {}", vueloId);
        Vuelo vuelo = vueloRepository.findById(vueloId).orElseThrow(() -> new IllegalArgumentException("Vuelo no encontrado: " + vueloId));
        
        // Marcar como cancelado
        vuelo.setCancelled(true);
        vueloRepository.save(vuelo);

        // Si hay una simulación en curso, lanzar la replanificación ALNS
        SimulationProgressHolder.SimulationSessionState session = null;
        if (sessionId != null) {
            session = progressHolder.get(sessionId);
        }

        if (session != null) {
            try {
                Solution replanned = alnsPlanner.replanificar(vueloId, 6_500L);
                if (replanned != null && !replanned.getRoutes().isEmpty()) {
                    session.setRescuedFlights(session.getRescuedFlights() + 1);
                    log.info("Replanificación exitosa. Vuelos rescatados en la sesión: {}", session.getRescuedFlights());
                }
            } catch (Exception e) {
                log.warn("Fallo en replanificación ALNS para vuelo cancelado {}: {}", vueloId, e.getMessage());
            }
        }
    }
}
