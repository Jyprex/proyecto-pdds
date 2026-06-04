package com.tasfb2b.planificador.service;

import com.tasfb2b.aeropuerto.repository.AeropuertoRepository;
import com.tasfb2b.envio.service.EnvioService;
import com.tasfb2b.planificador.domain.Solution;
import com.tasfb2b.planificador.simulation.SimulationRunner;
import com.tasfb2b.superlote.domain.SuperLot;
import com.tasfb2b.superlote.service.SuperLotService;
import com.tasfb2b.vuelo.domain.Vuelo;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import com.tasfb2b.planificador.domain.Route;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Tests del bloque de inyección de cancelaciones paralelas del modo colapso
 * (ver PLANES/PLAN_PERF_COLAPSO.md).
 *
 * <p>Verifica:
 * <ul>
 *   <li>Se invoca {@code ALNSPlannerService.doReplan} (no {@code replanificar}).</li>
 *   <li>La ventana de replan es 500ms.</li>
 *   <li>Se cachean replans por {@code vueloId} (sin duplicados).</li>
 *   <li>Replans exitosos marcan rutas como "rescued".</li>
 *   <li>Excepciones en replans no abortan los otros.</li>
 *   <li>El executor del pool dedicado es el que se usa (verificable por concurrencia).</li>
 * </ul>
 */
@ExtendWith(MockitoExtension.class)
class SimulationReplanParallelTest {

    @Mock SimulationRunner simulator;
    @Mock ALNSPlannerService alnsPlanner;
    @Mock AeropuertoRepository airportRepo;
    @Mock SuperLotService superLotService;
    @Mock SimulationProgressHolder progressHolder;
    @Mock EnvioService envioService;
    @Mock SimulationWsPublisher wsPublisher;

    /**
     * Construye un SimulationService con los mocks y un executor configurable.
     * Usa el constructor generado por Lombok con el orden de declaración de campos.
     */
    private SimulationService buildService(Executor exec) {
        return new SimulationService(
                simulator, alnsPlanner, airportRepo, superLotService,
                progressHolder, envioService, wsPublisher, exec);
    }

    /**
     * Construye un Route mock con un vuelo de id específico. Usa reflexión porque
     * el setter de flights no acepta null y queremos lotes de prueba mínimos.
     */
    private static Route routeWithVuelo(long vueloId) {
        Route r = Route.builder()
                .lot(new SuperLot(0, "SKBO", "SEQM", 100, 0L, 48L * 3600_000L, false, 1))
                .hops(List.of("SKBO", "SEQM"))
                .flights(List.of(Vuelo.builder().id(vueloId).capacidadTotal(1000).build()))
                .demandaTotal(100)
                .capacidadAsignada(100)
                .arrivalTime(1L)
                .deadline(48L * 3600_000L)
                .build();
        return r;
    }

    private static SimulationProgressHolder.SimulationSessionState sessionConStress(double stress) {
        SimulationProgressHolder.SimulationSessionState s =
                new SimulationProgressHolder.SimulationSessionState();
        s.setCollapseMode(true);
        s.setStressFactor(stress);
        return s;
    }

    private static Solution emptyReplan() {
        Solution s = new Solution();
        s.setRoutes(List.of());
        return s;
    }

    // ── 1. Usa doReplan con ventana 500L ─────────────────────────────

    @Test
    void invoca_doReplan_con_ventana_500ms() {
        Executor sync = Runnable::run;
        SimulationService svc = buildService(sync);

        // 10 rutas con vueloIds únicos
        List<Route> routes = new ArrayList<>();
        for (long i = 1; i <= 10; i++) routes.add(routeWithVuelo(i));

        // stress=10 → 30% = 3 cancelaciones
        SimulationProgressHolder.SimulationSessionState s = sessionConStress(10.0);

        when(alnsPlanner.doReplan(anyLong(), anyLong())).thenReturn(emptyReplan());

        svc.applyCollapseInjections(s, routes, "alns");

        // 3 cancelaciones, todas con vueloId único → 3 llamadas
        verify(alnsPlanner, times(3)).doReplan(anyLong(), eq(500L));
        // Nunca debe invocar replanificar (la versión con side-effect)
        verify(alnsPlanner, never()).replanificar(anyLong(), anyLong());
    }

    // ── 2. Cache de replans por vueloId ──────────────────────────────

    @Test
    void dedupe_por_vueloId() {
        Executor sync = Runnable::run;
        SimulationService svc = buildService(sync);

        // 4 rutas: vueloId=1 aparece 2 veces. Tras dedupe, debe haber 3 replans (no 4).
        List<Route> routes = List.of(
                routeWithVuelo(1L), routeWithVuelo(2L),
                routeWithVuelo(3L), routeWithVuelo(1L));
        // stress=100 → cancelFraction=3.0 → cancelCount=max(1, 12)=12, capped a 4
        // → se seleccionan las 4 rutas, dedupe deja 3 vueloIds únicos
        SimulationProgressHolder.SimulationSessionState s = sessionConStress(100.0);

        when(alnsPlanner.doReplan(anyLong(), anyLong())).thenReturn(emptyReplan());

        svc.applyCollapseInjections(s, routes, "alns");

        // 4 rutas, 3 vueloIds únicos → 3 replans (no 4)
        verify(alnsPlanner, times(3)).doReplan(anyLong(), eq(500L));
    }

    // ── 3. Replan exitoso → rescued ──────────────────────────────────

    @Test
    void replan_exitoso_marca_rescued() {
        Executor sync = Runnable::run;
        SimulationService svc = buildService(sync);

        List<Route> routes = List.of(
                routeWithVuelo(1L), routeWithVuelo(2L), routeWithVuelo(3L));
        // stress=100 → cancelCount se cape a 3 (todas las rutas)
        SimulationProgressHolder.SimulationSessionState s = sessionConStress(100.0);

        // Todos los replans devuelven solución con 1 ruta (éxito)
        Solution ok = new Solution();
        ok.setRoutes(List.of(routeWithVuelo(99L)));
        when(alnsPlanner.doReplan(anyLong(), anyLong())).thenReturn(ok);

        int rescued = svc.applyCollapseInjections(s, routes, "alns");

        assertThat(rescued).isEqualTo(3);
        for (Route r : routes) {
            assertThat(r.getStatus()).isEqualTo("rescued");
        }
    }

    // ── 4. Replan que devuelve vacío → cancelled ─────────────────────

    @Test
    void replan_sin_rutas_marca_cancelled() {
        Executor sync = Runnable::run;
        SimulationService svc = buildService(sync);

        List<Route> routes = List.of(
                routeWithVuelo(1L), routeWithVuelo(2L), routeWithVuelo(3L));
        // stress=100 → cancelCount cape a 3
        SimulationProgressHolder.SimulationSessionState s = sessionConStress(100.0);

        when(alnsPlanner.doReplan(anyLong(), anyLong())).thenReturn(emptyReplan());

        int rescued = svc.applyCollapseInjections(s, routes, "alns");

        assertThat(rescued).isZero();
        for (Route r : routes) {
            assertThat(r.getStatus()).isEqualTo("cancelled");
            assertThat(r.getCapacidadAsignada()).isZero();
        }
    }

    // ── 5. Excepción en un replan no aborta los otros ────────────────

    @Test
    void excepcion_en_un_replan_no_aborta_otros() {
        Executor sync = Runnable::run;
        SimulationService svc = buildService(sync);

        List<Route> routes = List.of(
                routeWithVuelo(1L), routeWithVuelo(2L), routeWithVuelo(3L));
        // stress=100 → cancelCount cape a 3 (todas las rutas se procesan)
        SimulationProgressHolder.SimulationSessionState s = sessionConStress(100.0);

        // vueloId=2 explota, los otros retornan éxito
        when(alnsPlanner.doReplan(eq(1L), anyLong())).thenReturn(emptyReplan());
        when(alnsPlanner.doReplan(eq(2L), anyLong()))
                .thenThrow(new RuntimeException("boom simulado"));
        Solution ok = new Solution();
        ok.setRoutes(List.of(routeWithVuelo(99L)));
        when(alnsPlanner.doReplan(eq(3L), anyLong())).thenReturn(ok);

        int rescued = svc.applyCollapseInjections(s, routes, "alns");

        // vueloId=1 y 3 → cancelled y rescued respectivamente; vueloId=2 → cancelled (excepción)
        assertThat(rescued).isEqualTo(1);
        assertThat(routes.get(0).getStatus()).isEqualTo("cancelled"); // vuelo 1
        assertThat(routes.get(1).getStatus()).isEqualTo("cancelled"); // vuelo 2 (excepción)
        assertThat(routes.get(2).getStatus()).isEqualTo("rescued");   // vuelo 3
    }

    // ── 6. Paralelismo: usa el executor dedicado ─────────────────────

    @Test
    void usa_el_replanExecutor_dedicado() throws Exception {
        // Pool real de 4 hilos; si el código llamara al executor equivocado,
        // las replans serían seriales y este test fallaría.
        java.util.concurrent.ExecutorService realPool =
                java.util.concurrent.Executors.newFixedThreadPool(4);
        try {
            SimulationService svc = buildService(realPool);

            // 4 rutas con vueloIds distintos, stress=100 para cancelar las 4
            List<Route> routes = List.of(
                    routeWithVuelo(1L), routeWithVuelo(2L),
                    routeWithVuelo(3L), routeWithVuelo(4L));
            SimulationProgressHolder.SimulationSessionState s = sessionConStress(100.0);

            CountDownLatch allStarted = new CountDownLatch(4);
            AtomicInteger currentConcurrent = new AtomicInteger();
            AtomicInteger maxConcurrent = new AtomicInteger();

            when(alnsPlanner.doReplan(anyLong(), anyLong())).thenAnswer(inv -> {
                int now = currentConcurrent.incrementAndGet();
                maxConcurrent.updateAndGet(m -> Math.max(m, now));
                allStarted.countDown();
                boolean arrived = allStarted.await(3, TimeUnit.SECONDS);
                currentConcurrent.decrementAndGet();
                assertThat(arrived)
                        .as("Las 4 replans deben llegar a ejecutarse concurrentemente")
                        .isTrue();
                return emptyReplan();
            });

            svc.applyCollapseInjections(s, routes, "alns");

            // Si el código fuera serial, maxConcurrent quedaría en 1.
            assertThat(maxConcurrent.get())
                    .as("Las replans deben ejecutarse en paralelo (max concurrent >= 2)")
                    .isGreaterThanOrEqualTo(2);
        } finally {
            realPool.shutdownNow();
        }
    }
}
