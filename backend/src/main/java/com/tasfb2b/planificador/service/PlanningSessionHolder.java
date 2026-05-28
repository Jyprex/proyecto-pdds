package com.tasfb2b.planificador.service;

import com.tasfb2b.planificador.domain.Solution;
import org.springframework.stereotype.Component;

/**
 * Memoria de trabajo del planificador para el día actual.
 *
 * <p>Mantiene la última {@link Solution} generada (por ALNS) como
 * estado compartido en memoria. El ALNS usa este holder para acceder a
 * las rutas vigentes sin necesidad de que el frontend las envíe en cada request.
 *
 * <p>Ciclo de vida típico:
 * <ol>
 *   <li>POST /planificador/ejecutar → ALNS guarda la solución aquí.</li>
 *   <li>POST /planificador/replanificar → ALNS lee las rutas desde aquí.</li>
 *   <li>Al finalizar ALNS → la nueva solución reemplaza a la anterior.</li>
 * </ol>
 *
 * <p>Si el servidor se reinicia, el estado se pierde. El endpoint de replanificación
 * retorna 409 Conflict si no hay solución activa.
 */
@Component
public class PlanningSessionHolder {

    /** Última solución vigente. Acceso volátil para visibilidad entre hilos. */
    private volatile Solution currentSolution;

    /** Almacena la solución más reciente. */
    public void store(Solution sol) {
        this.currentSolution = sol;
    }

    /** Retorna la solución vigente, o null si no hay ninguna. */
    public Solution get() {
        return currentSolution;
    }

    /** @return true si hay una solución activa en memoria. */
    public boolean hasSolution() {
        return currentSolution != null;
    }

    /** Limpia el estado (útil para tests o reinicio de jornada). */
    public void clear() {
        this.currentSolution = null;
    }
}
