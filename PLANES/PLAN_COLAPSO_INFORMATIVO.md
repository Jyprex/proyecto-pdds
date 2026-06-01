# Plan: Colapso Informativo + Condición de Parada Configurable

## Contexto

Antes de este cambio, la simulación de colapso abortaba con `status=FAILED`
cuando el planificador entregaba una ruta tardía (`Solution.esColapsada()`).
El usuario quería que la simulación **continuara** mostrando la degradación
completa y terminara solo cuando se cumpliera una condición explícita.

## Decisión de diseño

1. **Colapso es informativo**: la simulación ya NO aborta por SLA breach del
   plan. La cola FIFO del almacén (`SimulationState.drainCola`) y la
   saturación reversible (`SimulationState.recalcularSaturacion`) ya estaban
   bien — solo se quita el `return history` en `SimulationService`.
2. **La terminación se decide al fin de cada día** según la condición
   elegida por el operador al lanzar la simulación.
3. **Día del colapso se incluye** en el reporte con `colapsed=true` y
   `collapseTime` poblado; los días siguientes no se simulan.
4. **Compatibilidad hacia atrás**: el default es `NONE`, que equivale al
   comportamiento anterior (correr N días sin abortar por condición).

## Condiciones disponibles

| Condición | Criterio | Defaults (properties) |
|---|---|---|
| `SLA_BELOW_THRESHOLD` | `slaPercent < umbral` por N días consecutivos | `tasf.sim.collapse.slaThreshold=30.0`, `tasf.sim.collapse.consecutiveDays=2` |
| `ALL_AIRPORTS_CRITICAL` | Todos los aeropuertos con `getOccupancyPercent >= 90` | (n/a) |
| `NONE` | Nunca termina por condición | (n/a) |

## Cambios por archivo

| Archivo | Cambio |
|---|---|
| `backend/.../planificador/domain/CollapseEndCondition.java` | **Nuevo** enum con 3 valores |
| `backend/.../planificador/service/SimulationProgressHolder.java` | +`endCondition`, +`slaStreak`, +`collapseDayIndex`, +`collapseReason` en `SimulationSessionState` |
| `backend/.../planificador/web/SimulationStatusDTO.java` | +`endCondition`, +`collapseDayIndex`, +`collapseReason` |
| `backend/.../planificador/service/SimulationService.java` | Quitar `if (sol.esColapsada())`; +`@Value` para umbrales; +`checkEndCondition()` (static, package-private) + record `CollapseCheckResult`; chequeo al fin de cada día |
| `backend/.../planificador/web/SimulationController.java` | +`@RequestParam endCondition` (default `NONE`) en `/run-collapse`; mapeo seguro a enum; expone nuevos campos en `/status` |
| `backend/src/main/resources/application.properties` | +defaults `tasf.sim.collapse.slaThreshold` y `consecutiveDays` |
| `backend/pom.xml` | +`org.awaitility:awaitility` (scope test) — agregado aunque el test actual no lo usa; queda disponible para futuros tests asíncronos |
| `backend/src/test/java/.../SimulationCollapseEndConditionTest.java` | **Nuevo**: 7 tests unitarios de `checkEndCondition` (sin Spring context) |

## Comportamiento por condición

### `SLA_BELOW_THRESHOLD`
- Cada fin de día, evalúa `report.getSlaPercent() < threshold`.
- Si se cumple: `streak = streak + 1`; si no: `streak = 0`.
- Si `streak >= consecutiveDays`: `terminated = true`, `reason` se incluye en
  `eventLog` y `SimulationStatusDTO.collapseReason`.
- El streak se persiste en la sesión para que la condición sea
  realmente consecutiva (no se "salta" días).

### `ALL_AIRPORTS_CRITICAL`
- Cuenta aeropuertos con `getOccupancyPercent(icao, airportMap) >= 90`.
- Si `count >= airportMap.size()`: `terminated = true`.
- Reutiliza la noción de "crítico" ya presente en `updateProgress`
  (línea ~446 de `SimulationService`), asegurando consistencia con
  `criticalNodes` del DTO.

### `NONE`
- El chequeo se salta completamente; la simulación corre los N días.

## Pruebas

`SimulationCollapseEndConditionTest` cubre:
- SLA bajo 1 día → no termina, streak=1
- SLA bajo 2 días consecutivos → termina, streak=2
- SLA alto resetea el streak
- 3/3 aeropuertos críticos → termina
- 1 aeropuerto no crítico → no termina
- `NONE` nunca termina, no toca el streak
- Estado por defecto de la sesión: `NONE`, streak=0, sin `collapseDayIndex`

Decisión: se optó por tests unitarios (sin Spring) en vez de integración
completa porque el bucle de simulación con `playbackMinutes=1` tarda ~60s
por test (clamp de `computeSleepPerCycleMs`). El helper es pure y se
prueba en milisegundos; la integración está cubierta por `BackendApplicationTests.contextLoads`.

## Uso desde el cliente

```bash
# Sin condición explícita (default = NONE, comportamiento legacy)
curl -X POST 'http://localhost:8081/api/v1/simulation/run-collapse/5?stressFactor=5'

# Terminar cuando SLA < 30% por 2 días consecutivos
curl -X POST 'http://localhost:8081/api/v1/simulation/run-collapse/7?stressFactor=8&endCondition=SLA_BELOW_THRESHOLD'

# Terminar cuando todos los aeropuertos estén críticos
curl -X POST 'http://localhost:8081/api/v1/simulation/run-collapse/10?stressFactor=10&endCondition=ALL_AIRPORTS_CRITICAL'
```

Respuesta de `GET /api/v1/simulation/status/{id}` ahora incluye:
- `endCondition`: nombre del enum activo
- `collapseDayIndex`: día (1-based) en que se cumplió la condición, `null` si `NONE`
- `collapseReason`: mensaje humano con el detalle

## Compatibilidad

- Sin `endCondition` en la query → default `NONE` → comportamiento
  equivalente al legacy (sin abort por SLA breach, pero también sin
  terminación temprana).
- Campos nuevos en `SimulationStatusDTO` son aditivos: clientes que
  no los consuman siguen funcionando.
- `SimulationExcelService` ya pinta la columna "¿Colapso?" en rojo
  cuando `rep.isColapsed()` — la simulación ahora puede llegar a esa
  fila con `colapsed=true` sin haber abortado, y se ven los días
  previos con sus KPIs.

## Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| Frontend rompe por campos nuevos del DTO | Campos son aditivos; los consumidores que no los pidan los ignoran |
| Tests requieren data path válida | El único test nuevo es unitario (sin Spring) |
| Memoria: con `NONE` y 120 días, la heap crece | El `report.setRoutes(List.of())` (compact post-día) ya mitiga |
| Comportamiento cambiado para usuarios existentes | Default `NONE`; quien quiera abort tiene que pedir `SLA_BELOW_THRESHOLD` explícitamente |
| `awaitility` agregado pero no usado | Queda disponible para futuros tests asíncronos; costo despreciable |

## Checklist de aceptación

- [x] `CollapseEndCondition` creado
- [x] `SimulationService.runFullSimulation` ya no llama a `markFailed` por SLA breach
- [x] `/run-collapse` acepta `endCondition` (NONE | SLA_BELOW_THRESHOLD | ALL_AIRPORTS_CRITICAL)
- [x] El día que cumple la condición tiene `colapsed=true` y `collapseTime` poblado
- [x] `SimulationStatusDTO` expone `endCondition`, `collapseDayIndex`, `collapseReason`
- [x] `mvn -pl backend test` pasa (8/8 tests)
- [x] Documento `PLAN_COLAPSO_INFORMATIVO.md` creado
- [x] No hay imports sin usar ni warnings nuevos de Lombok
