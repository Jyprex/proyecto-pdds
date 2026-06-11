package com.tasfb2b.shared.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;

/**
 * Configuración de los pools de hilos para ejecución asíncrona.
 */
@Configuration
@EnableAsync
public class AsyncConfig {

    @Bean(name = "simulationExecutor")
    public Executor simulationExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(16);
        executor.setMaxPoolSize(32);
        executor.setQueueCapacity(200);
        executor.setThreadNamePrefix("tasf-sim-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(30);
        executor.initialize();
        return executor;
    }

    /**
     * Pool para replans ALNS paralelos del modo colapso.
     *
     * <p>Tamaño configurable vía {@code tasf.sim.replan.poolSize}
     * (default 4). {@code maxPoolSize = 2 × core}, {@code queueCapacity = 20}.
     */
    @Bean(name = "replanExecutor")
    public Executor replanExecutor(
            @Value("${tasf.sim.replan.poolSize:4}") int corePoolSize) {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(corePoolSize);
        executor.setMaxPoolSize(Math.max(corePoolSize, corePoolSize * 2));
        executor.setQueueCapacity(500);
        executor.setThreadNamePrefix("tasf-replan-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(30);
        executor.initialize();
        return executor;
    }
}
