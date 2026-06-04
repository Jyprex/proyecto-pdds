package com.tasfb2b.shared.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;

/**
 * Configuración del pool de hilos para ejecución asíncrona de simulaciones.
 *
 * <p>{@code @EnableAsync} activa el soporte de {@code @Async} en toda la aplicación.
 * El bean {@code simulationExecutor} define un pool dedicado para las simulaciones,
 * separado del pool de tareas programadas de Spring.
 *
 * <p>Parámetros del pool:
 * <ul>
 *   <li>corePoolSize = 2 (2 simulaciones concurrentes por defecto)</li>
 *   <li>maxPoolSize = 4 (máximo bajo carga)</li>
 *   <li>queueCapacity = 10 (cola de espera para simulaciones adicionales)</li>
 *   <li>threadNamePrefix = "tasf-sim-" (visible en logs y profilers)</li>
 * </ul>
 */
@Configuration
@EnableAsync
public class AsyncConfig {

    @Bean(name = "simulationExecutor")
    public Executor simulationExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(4);
        executor.setQueueCapacity(10);
        executor.setThreadNamePrefix("tasf-sim-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(30);
        executor.initialize();
        return executor;
    }

    /**
     * Pool dedicado para replanificaciones ALNS paralelas en modo colapso.
     * Separado del pool principal para no bloquear las simulaciones.
     */
    @Bean(name = "replanExecutor")
    public Executor replanExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(4);
        executor.setMaxPoolSize(8);
        executor.setQueueCapacity(50);
        executor.setThreadNamePrefix("tasf-replan-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(10);
        executor.initialize();
        return executor;
    }
}
