package com.tasfb2b.planificador.service;

import com.tasfb2b.planificador.domain.Route;
import org.springframework.stereotype.Component;

import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Object Pool para reciclar instancias de {@link Route}.
 *
 * <p>Reduce la presión sobre el Garbage Collector durante las iteraciones
 * intensivas de ALNS/HGA, donde se crean y descartan miles de rutas por
 * segundo en la evaluación de vecindarios.
 *
 * <p>Uso:
 * <pre>
 *   Route r = routePool.borrow();
 *   // ... configurar r con Route.builder() o setters ...
 *   routePool.recycle(r);  // devuelve al pool (llama r.clear())
 * </pre>
 *
 * <p>Thread-safe via {@link ConcurrentLinkedQueue}.
 */
@Component
public class RoutePool {

    private static final int MAX_POOL_SIZE = 2048;

    private final ConcurrentLinkedQueue<Route> pool = new ConcurrentLinkedQueue<>();
    private final AtomicInteger size = new AtomicInteger(0);

    /**
     * Obtiene una instancia de Route del pool. Si el pool está vacío,
     * crea una nueva instancia.
     *
     * @return instancia de Route limpia lista para usar
     */
    public Route borrow() {
        Route r = pool.poll();
        if (r != null) {
            size.decrementAndGet();
            return r;
        }
        return new Route();
    }

    /**
     * Devuelve una instancia de Route al pool para reutilización.
     * Llama a {@link Route#clear()} para limpiar el estado.
     * Si el pool ya alcanzó su tamaño máximo, la instancia se descarta.
     *
     * @param route instancia a reciclar
     */
    public void recycle(Route route) {
        if (route == null) return;
        route.clear();
        if (size.get() < MAX_POOL_SIZE) {
            pool.offer(route);
            size.incrementAndGet();
        }
    }

    /**
     * Recicla una lista completa de rutas de vuelta al pool.
     */
    public void recycleAll(java.util.List<Route> routes) {
        if (routes == null) return;
        for (Route r : routes) {
            recycle(r);
        }
    }

    /**
     * Retorna el número de instancias disponibles en el pool.
     */
    public int available() {
        return size.get();
    }

    /**
     * Limpia todo el pool, liberando memoria.
     */
    public void clear() {
        pool.clear();
        size.set(0);
    }
}
