package com.tasfb2b.planificador.alns.operator;

import com.tasfb2b.planificador.domain.Route;
import com.tasfb2b.superlote.domain.SuperLot;

import java.util.List;
import java.util.Random;

/**
 * Operador de destrucción del ALNS.
 * Extrae hasta q SuperLots de las rutas actuales y los retorna como "removidos".
 * La lista de rutas es modificada in-place (se eliminan las rutas de los lotes removidos).
 */
public interface DestroyOperator {

    /**
     * @param routes lista de rutas actual (se modificará: se eliminan las rutas destruidas)
     * @param q      número máximo de lotes a extraer
     * @param rng    generador aleatorio
     * @param currentSimTime tiempo actual de simulación para proteger rutas en vuelo
     * @return lista de SuperLots extraídos de sus rutas
     */
    List<SuperLot> destroy(List<Route> routes, int q, Random rng, long currentSimTime);

    /** Nombre identificador para el tracker de pesos. */
    String name();
}
