package com.tasfb2b.planificador.domain;

import java.util.Queue;
import java.util.concurrent.ConcurrentLinkedQueue;

/**
 * Object Pool para reciclar objetos Route (Fase 5).
 * Evita que el ALNS sature al Garbage Collector instanciando y
 * destruyendo millones de objetos Route temporalmente en reparaciones.
 */
public class RoutePool {

    private static final Queue<Route> pool = new ConcurrentLinkedQueue<>();

    /**
     * Obtiene una instancia limpia de Route.
     */
    public static Route borrow() {
        Route r = pool.poll();
        return r != null ? r : new Route();
    }

    /**
     * Limpia la ruta y la devuelve al pool para su futuro reciclaje.
     */
    public static void recycle(Route r) {
        if (r == null) return;
        r.clear();
        pool.offer(r);
    }
}
