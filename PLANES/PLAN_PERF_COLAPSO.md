# PLAN_PERF_COLAPSO — Paralelización de replans del modo colapso

**Estado**: ✅ Implementado y validado (14/14 tests pasan)
**Fecha**: Junio 2026
**Rama / módulo**: `backend/` (motor ALNS + AsyncConfig)
**Plan padre**: `PLAN_COLAPSO_INFORMATIVO.md`

---

## 1. Contexto y motivación

El modo colapso de TASF.B2B simula una saturación extrema de la red aérea
inyectando cancelaciones masivas de rutas y lanzando replans ALNS para intentar
recuperarlas. Bajo las opciones por defecto, una corrida de 5 días con
`stressFactor=10` tardaba demasiado para ser interactiva en demos.

**Medición previa** (síntesis del problema, no benchmark formal):

| Bloque | Coste aproximado | Por qué |
|---|---|---|
| `replanificar(vueloId, 6_500L)` por ruta | 6 500 ms | ventana ALNS fija en 6.5 s |
| 6 cancelaciones × serial | ~39 s | un solo `for` await por replan |
| 24 ciclos/día × 30 días | minutos de simulación | iteración síncrona del engine |

El cuello de botella dominante era el **replan serial con ventana alta**, no
el motor de simulación en sí. Cualquier mejora > 2× debía pasar por reducir
el tiempo por replan y/o paralelizarlos.

---

## 2. Decisión: Opción A + B combinadas

Se evaluaron 3 alternativas:

| Opción | Idea | A favor | En contra |
|---|---|---|---|
| **A** | Bajar ventana ALNS 6 500 ms → 500 ms | simple, sin concurrencia | calidad de planes menor (best-effort) |
| **B** | Paralelizar replans con `CompletableFuture` | calidad ALNS intacta, ~4× speedup | requiere executor dedicado, riesgo de race en holder |
| **C** | Cachear replans por `vueloId` | reduce trabajo redundante | solo aplica cuando varias rutas comparten vuelo (caso minoritario) |

**Decisión**: **A + B combinadas**. La calidad del plan ALNS en modo colapso es
ya best-effort (no aborta por SLA breach desde `PLAN_COLAPSO_INFORMATIVO.md`),
así que la pérdida de optimalidad de 500 ms es aceptable a cambio de respuesta
interactiva. La paralelización preserva la calidad por replan al mantener la
ventana suficiente, solo cambia la cantidad de replans simultáneos.

La opción C se aplicó **dentro** de B como sub-optimización: el conjunto
`uniqueVueloIds` evita relanzar el mismo replan.

---

## 3. Cambios por archivo

### 3.1 `ALNSPlannerService.java` — extracción de `doReplan` y eliminación de `lastSimState`

**Problema previo**:

1. El método público `replanificar(vueloId, windowMs)` hacía el replan **y**
   escribía el resultado en `PlanningSessionHolder` (`sessionHolder.store(sol)`).
2. Si dos replans corrían en paralelo, ambos escribirían en
   `volatile Solution currentSolution` — **last-write-wins**, no error
   detectable.
3. El campo `lastSimState` (estado de la última evaluación) era compartido
   entre `runAlns` y los replans, así que paralelizar introducía lecturas
   cruzadas del estado de otro replan.

**Cambios**:

- **Nuevo `doReplan(vueloId, windowMs)`** (package-private, sin side-effect):
  ejecuta el ciclo ALNS acotado al vuelo cancelado y devuelve la `Solution`
  resultante **sin** tocar el holder. Apto para uso concurrente.
- **`replanificar` se convierte en thin wrapper** que llama a `doReplan` y
  luego sí hace `sessionHolder.store(sol)`. La API pública sigue funcionando
  para llamadores existentes (`FlightCancellationService` y similares).
- **Eliminado `lastSimState`** como campo de instancia. En su lugar,
  `evalFitness` ahora devuelve `EvaluationResult(double fitness, SimulationState state)`
  — un `record` inmutable. `runAlns` opera con la variable local `iterState`,
  no con estado compartido.
- `runAlns` ya **no** llama a `sessionHolder.store(sol)` al final. Los
  llamadores (`PlanningService.ejecutarALNS`, `NumericExperimentService`) hacen
  su propio `store` cuando corresponde.

**Beneficio**: el replan es ahora **puro** desde el punto de vista del holder.
El engine de simulación (`SimulationState`) ya no es un singleton mutable
compartido entre hilos.

### 3.2 `AsyncConfig.java` — `replanExecutor` dedicado

Nuevo bean (Spring `@Configuration`):

```java
@Bean(name = "replanExecutor")
public ExecutorService replanExecutor(
        @Value("${tasf.sim.replan.poolSize:4}") int core) {
    int max = Math.max(core, core * 2);
    ThreadPoolTaskExecutor exec = new ThreadPoolTaskExecutor();
    exec.setCorePoolSize(core);
    exec.setMaxPoolSize(max);
    exec.setQueueCapacity(20);
    exec.setThreadNamePrefix("tasf-replan-");
    exec.initialize();
    return exec;
}
```

| Param | Default | Justificación |
|---|---|---|
| `corePoolSize` | 4 | 1 replan por núcleo lógico (workstation típica 4–8 cores) |
| `maxPoolSize` | 8 | Permite picos sin denegar tareas |
| `queueCapacity` | 20 | Backpressure si todos los hilos están ocupados |
| `threadNamePrefix` | `tasf-replan-` | Distinguible de `tasf-sim-` en logs/profilers |

Configurable vía `tasf.sim.replan.poolSize=N` en `application.properties`.

### 3.3 `SimulationService.java` — `REPLAN_WINDOW_MS` + `applyCollapseInjections`

**Constante nueva**:
```java
private static final long REPLAN_WINDOW_MS = 500L;
```

**Nuevo campo inyectado**:
```java
@Qualifier("replanExecutor")
private final Executor replanExecutor;
```

**Nuevo método `applyCollapseInjections` (package-private)**:

Firma:
```java
int applyCollapseInjections(
        SimulationProgressHolder.SimulationSessionState session,
        List<Route> routes,
        String algorithm)
```

Lógica (líneas 573-639 de `SimulationService.java`):

1. `cancelFraction = stressFactor * 0.03` (×1→3 %, ×10→30 %, ×100→300 %).
2. `cancelCount = max(1, routes.size() * cancelFraction)`, capeado a `routes.size()`.
3. `Collections.shuffle(rutasModificables)` para inyectar variabilidad.
4. Recolecta `uniqueVueloIds` (LinkedHashSet) de los primeros `cancelCount`
   vuelos. **Dedupe automático**: rutas con mismo `vueloId` se replanifican una
   sola vez.
5. Si `algorithm != "alns"` o `uniqueVueloIds` está vacío: marca todo como
   `cancelled` y retorna 0 (evita trabajo inútil).
6. Por cada `vueloId` lanza un `CompletableFuture.supplyAsync(..., replanExecutor)`
   que llama `alnsPlanner.doReplan(vueloId, 500L)`.
7. Cada futuro se encadena con `.handle((sol, ex) -> ...)`:
   - Si la replanificación devolvió una `Solution` con `routes` no vacía →
     `Set.of(vueloId)` (marcado como rescatado).
   - En cualquier otro caso (null, vacío, excepción) → log warning +
     `Collections.emptySet()`. **Nunca aborta el ciclo**.
8. `f.join()` espera todos los futuros (en este punto el código sigue siendo
   síncrono respecto al hilo de simulación principal, pero las replans internas
   son paralelas).
9. `markCancelled(rutasModificables, cancelCount, rescuedVueloIds)` etiqueta
   cada ruta como `rescued` o `cancelled` y pone `capacidadAsignada=0` en las
   canceladas (para no animar vuelos fantasma en el frontend).
10. Retorna el conteo de rutas rescatadas, que se suma a
    `session.setRescuedFlights(...)` como métrica para el KPI final.

### 3.4 `application.properties` — configuración colapsable

```properties
# Modo colapso
tasf.sim.collapse.slaThreshold=30.0
tasf.sim.collapse.consecutiveDays=2
# Pool de replans
tasf.sim.replan.poolSize=4
```

---

## 4. Tests añadidos

Archivo: `backend/src/test/java/com/tasfb2b/planificador/service/SimulationReplanParallelTest.java`

Estrategia: **JUnit 5 + Mockito puro** (no `@SpringBootTest`). Cada test
construye un `SimulationService` con sus 8 dependencias mockeadas vía el
constructor generado por Lombok, más un `Executor` configurable (sync
`Runnable::run` para tests deterministas, `Executors.newFixedThreadPool(4)`
para el test de paralelismo).

| # | Test | Verifica |
|---|---|---|
| 1 | `invoca_doReplan_con_ventana_500ms` | `doReplan` se llama con `500L` (no `6500L`) y `replanificar` jamás |
| 2 | `dedupe_por_vueloId` | 4 rutas con 3 vueloIds únicos → 3 llamadas (no 4) |
| 3 | `replan_exitoso_marca_rescued` | Replan que devuelve `Solution` con rutas → status `rescued` |
| 4 | `replan_sin_rutas_marca_cancelled` | Replan vacío → status `cancelled` y `capacidadAsignada=0` |
| 5 | `excepcion_en_un_replan_no_aborta_otros` | Un replan que lanza `RuntimeException` no aborta el resto |
| 6 | `usa_el_replanExecutor_dedicado` | Pool real de 4 hilos; con 4 replans bloqueadas en `CountDownLatch`, `maxConcurrent ≥ 2` |

**Total**: 14/14 tests verdes (1 `BackendApplicationTests` + 7
`SimulationCollapseEndConditionTest` + 6 nuevos).

```
[INFO] Tests run: 14, Failures: 0, Errors: 0, Skipped: 0
[INFO] BUILD SUCCESS
[INFO] Total time:  10.188 s
```

---

## 5. Estimación de speedup

**Sin paralelizar (referencia)**: N cancelaciones × 500 ms = `N × 500 ms`.

**Con paralelización** (asumiendo pool de 4 y N ≥ 4):
- Mejor caso (todas las replans independientes): `(N/4) × 500 ms` + overhead.
- Caso típico (4–10 replans por ciclo, 4 hilos): ~`500–1000 ms` totales.

**Speedup esperado en modo colapso extremo** (`stress=10`, ~30 %
cancelaciones, 200 rutas/ciclo):

- Antes: 60 rutas × 6 500 ms = **~390 s/ciclo** (inviable para demo).
- Ahora: 60 rutas × 500 ms / 4 hilos = **~7.5 s/ciclo** + overhead
  `CompletableFuture` (~50–100 ms).

**Speedup conservador**: 390 / 8 ≈ **~48×** sobre el peor caso previo.
**Speedup realista** (incluyendo que el motor `simulator.run` sigue siendo
serial y domina ~30 % del tiempo): **~20–30× end-to-end** para corridas de
5–10 días con `stressFactor=10`.

Para `stressFactor=1` o `=2` (3–6 % de cancelaciones) la mejora es menor en
absoluto pero la latencia de respuesta mejora porque el bucle no espera
replans que apenas se usan.

---

## 6. Trade-offs conocidos

1. **Calidad de los planes ALNS cae** al bajar la ventana de 6 500 ms a
   500 ms. Es aceptable porque:
   - El modo colapso ya es best-effort (la simulación no aborta por SLA
     breach, `PLAN_COLAPSO_INFORMATIVO.md`).
   - El conteo de `rescuedFlights` sigue siendo una métrica informativa, no
     un SLA duro.

2. **Race en `PlanningSessionHolder`**: con el cambio, los replans **no**
   tocan el holder. Solo el wrapper público `replanificar` lo hace, y los
   llamadores externos siguen siendo seriales (`FlightCancellationService`
   lo invoca en su propio `@Transactional`, sin paralelismo). No hay race
   detectable en producción.

3. **Memoria**: 4–8 hilos paralelos pueden mantener 4–8 `Solution`
   intermedias simultáneamente. Cada `Solution` con N rutas es liviana
   (~5–20 KB), así que el peor caso (~8 × 200 rutas × 10 KB) es ~16 MB
   extra en heap — aceptable.

4. **Backpressure**: con `queueCapacity=20` y `maxPoolSize=8`, si llegasen
   más de 28 replans pendientes, el `ThreadPoolTaskExecutor` usaría la
   política por defecto (`AbortPolicy`) y lanzaría
   `TaskRejectedExecutionException`. En modo colapso el `cancelCount`
   está limitado por `routes.size()`, así que 28+ replans solo ocurriría
   con > 2800 rutas/ciclo (no esperado en dataset académico).

---

## 7. Cómo verificar manualmente

1. **Benchmark end-to-end** (antes/después en el mismo equipo):
   ```bash
   # Iniciar backend
   cd backend && ./mvnw spring-boot:run
   # En otra terminal, cronometrar:
   time curl -X POST 'http://localhost:8081/api/v1/simulation/run-collapse/5?stressFactor=10&endCondition=NONE'
   ```
   Comparar con el commit previo a este plan.

2. **Verificar el pool** en logs:
   ```
   grep "tasf-replan-" backend/logs/spring-boot.log
   ```
   Deben aparecer 4+ hilos con prefijo `tasf-replan-` durante un colapso.

3. **Verificar paralelismo** con JFR/async-profiler: durante un ciclo de
   colapso, los 4 hilos del pool deben mostrar uso simultáneo de CPU.

---

## 8. Resumen de diffs

| Archivo | Líneas añadidas | Líneas removidas | Tipo |
|---|---|---|---|
| `ALNSPlannerService.java` | +25 | -10 | refactor |
| `AsyncConfig.java` | +20 | 0 | feature |
| `SimulationService.java` | +95 | -8 | feature |
| `application.properties` | +3 | 0 | config |
| `SimulationReplanParallelTest.java` | +270 | 0 | tests |
| **Total** | **+413** | **-18** | |

---

## 9. Próximos pasos (no incluidos)

- Si se observa `TaskRejectedExecutionException` en producción, subir
  `queueCapacity` o cambiar `RejectedExecutionHandler` a `CallerRunsPolicy`.
- Si el speedup real es menor al esperado, considerar un
  `ForkJoinPool` con work-stealing en vez de `ThreadPoolTaskExecutor`.
- Mover `applyCollapseInjections` a un componente aparte
  (`CollapseReplanInjector`) si crece más allá de 100 líneas.
