package com.tasfb2b.planificador.service;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;

/**
 * Executor DEDICADO y EXCLUSIVO para el cálculo asíncrono de bloques
 * (doble búfer). NUNCA debe compartirse con "simulationExecutor" — ese
 * ya está ocupado por el hilo externo de runAsync() durante TODA la
 * simulación. Si se reutiliza el mismo pool, cuando no hay hilo libre
 * la política CallerRunsPolicy ejecuta la tarea "async" de forma
 * SÍNCRONA en el hilo que la solicitó, causando el freeze periódico
 * que coincide exactamente con el tamaño de cada bloque (sa segundos).
 */
@Configuration
public class BlockExecutorConfig {

    @Bean("blockComputeExecutor")
    public Executor blockComputeExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(4);
        executor.setMaxPoolSize(8);
        executor.setQueueCapacity(50);
        executor.setThreadNamePrefix("block-compute-");
        executor.initialize();
        return executor;
    }
}