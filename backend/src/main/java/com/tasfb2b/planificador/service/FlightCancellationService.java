package com.tasfb2b.planificador.service;

import com.tasfb2b.vuelo.domain.Vuelo;
import com.tasfb2b.vuelo.service.VueloService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
@Slf4j
public class FlightCancellationService {

    private static final long MIN_LEAD_TIME_MS = 60L * 60 * 1000;

    private final VueloService vueloService;
    private final SimulationProgressHolder progressHolder;

    // ⚠️ NO USADOS — pertenecían al mecanismo de replanificación ESTÁTICA
    // (pre-doble-búfer). SimulationService.computeBlock() ya detecta el
    // flag cancelled=true cada ciclo (vueloRepo.findByCancelledTrue()) y
    // hace la replanificación REACTIVA dentro del propio bucle — invocar
    // ALNS aquí no afecta a la simulación en curso, solo desperdicia CPU.
    // private final ALNSPlannerService alnsPlanner;
    // private final PlanningSessionHolder sessionHolder;

    @Transactional
    public void cancelarVuelo(Long vueloId, String sessionId) {

        SimulationProgressHolder.SimulationSessionState session = null;
        if (sessionId != null) {
            session = progressHolder.get(sessionId);
        }

        boolean diferirAManana = false;

        if (session != null
                && session.getCurrentEpochTime() != null
                && session.getStartEpoch() != null
                && session.getCurrentDay() > 0) {

            Vuelo vuelo = vueloService.obtenerVuelo(vueloId);
            long dayStartEpoch = session.getStartEpoch()
                    + ((long) (session.getCurrentDay() - 1) * 86_400_000L);
            long todayDeparture = vuelo.getDepartureEpoch(dayStartEpoch);
            long currentSimTime = session.getCurrentEpochTime();

            long leadTimeMs = todayDeparture - currentSimTime;
            diferirAManana = leadTimeMs < MIN_LEAD_TIME_MS;
        }

        if (diferirAManana) {
            session.getPendingNextDayCancellations().add(vueloId);
            log.info("Vuelo {} cancelado con menos de 1h de anticipación. " +
                    "Se difiere la cancelación a la instancia de mañana.", vueloId);
            return;
        }

        log.info("Cancelando manualmente el vuelo {} (efecto visible en el próximo ciclo del bloque actual).", vueloId);
        vueloService.cancelarVuelo(vueloId);
        // La replanificación reactiva de las maletas afectadas ocurre dentro
        // de SimulationService.computeBlock() en su próximo ciclo — no
        // requiere ninguna acción adicional aquí.
    }
}