# DOCUMENTACIÓN TÉCNICA — PROYECTO TASF.B2B (Proyecto Principal)

> Sistema de Control Logístico para transporte intercontinental de equipajes B2B.
> Grupo 4D — Jim Navarrete, Diego Silvestre, Jose Avalos, Mathias Medina

---

## 1. ARQUITECTURA GENERAL

| Capa | Tecnología | Puerto |
|------|-----------|--------|
| **Frontend** | React + Vite | 5173 |
| **Backend** | Spring Boot 3.5 + Java 21 | 8080 |
| **BD** | H2 en memoria | Embebida |
| **Comunicación** | REST + WebSocket (STOMP) | 8080 |

**Patrón arquitectónico:** Monolito modular con paquetes por dominio (DDD-lite). Cada módulo (`aeropuerto`, `envio`, `vuelo`, `superlote`, `planificador`, `experiment`, `shared`) tiene subcarpetas `domain/`, `dto/`, `repository/`, `service/`, `web/`, `util/`.

---

## 2. BACKEND — MÓDULO POR MÓDULO

### 2.1 `aeropuerto` — Gestión de Aeropuertos

| Archivo | Propósito |
|---------|-----------|
| `Aeropuerto.java` | Entidad JPA: ICAO, ciudad, país, continente, capacidad de almacenamiento, GMT offset, lat/lon |
| `Continente.java` | Enum: `AMERICA`, `EUROPE`, `ASIA` |
| `AeropuertoParser.java` | Parser regex del archivo plano académico (coordenadas DMS → decimal) |
| `AeropuertoService.java` | CRUD + `cargarDesdeArchivo()` que lee el .txt codificado en UTF-16BE |
| `AeropuertoController.java` | REST `/api/v1/aeropuertos` — CRUD básico |

**Fin:** Modela los 45 aeropuertos del dataset TASF.B2B con sus capacidades de almacenaje y zonas horarias. `esIntercontinentalCon()` determina si un envío cruza continentes (SLA de 48h vs 24h).

### 2.2 `envio` — Gestión de Envíos/Pedidos

| Archivo | Propósito |
|---------|-----------|
| `Envio.java` | Entidad JPA: código, fecha, hora, origen→destino (ManyToOne a Aeropuerto), cantidad de maletas, cliente |
| `EnvioParser.java` | Parsea líneas formato `CODIGO-YYYYMMDD-HH-MM-DESTINO-CANTIDAD-CLIENTE` |
| `NombreArchivoParser.java` | Extrae el ICAO del nombre del archivo `_envios_XXXX.txt` |
| `EnvioRepository.java` | Queries JPA: `streamResumenes()`, `streamResumenesPorFecha()`, `findDailyTotalsByRange()` |
| `EnvioService.java` | Carga envíos por lotes (batch 500), filtrado por fecha, deduplicación por código+origen |

**Fin:** Los envíos son la **demanda** del sistema. Cada línea del archivo plano representa un pedido de maletas de un aeropuerto a otro. La carga es **diferida** (no al arranque) para ahorrar RAM.

### 2.3 `vuelo` — Gestión de Vuelos

| Archivo | Propósito |
|---------|-----------|
| `Vuelo.java` | Entidad JPA: origen, destino, capacidad total, departure/arrival en minutos del día, flag intercontinental y cancelled |
| `VueloService.java` | Carga desde `planes_vuelo.txt`, cancelación de vuelos con invalidación del grafo |
| `FlightCancellationScheduler.java` | Programador de cancelaciones periódicas (modo colapso) |
| `VueloParser.java` | Parser del archivo de planes de vuelo |

**Fin:** Los vuelos son la **oferta** (capacidad de transporte). `getDuracionMinutos()` convierte horarios locales a UTC para calcular tiempos reales. `calcularSiguienteSalida()` maneja la periodicidad diaria.

### 2.4 `superlote` — Agrupación de Envíos (SuperLots)

| Archivo | Propósito |
|---------|-----------|
| `SuperLot.java` | POJO (no JPA): agrupa envíos por ruta origen→destino. Campos: totalMaletas, readyTime, SLA, prioridad |
| `SuperLotService.java` | `agruparEnvios()` y `agruparEnviosPorFecha()`: agrupa envíos en SuperLots con SLA calculado (24h intracontinental, 48h intercontinental) |

**Fin:** Transforma la demanda granular (miles de envíos individuales) en lotes manejables para los algoritmos de planificación. Usa un `Accumulator` interno para sumar maletas y calcular el `minReadyTime`.

### 2.5 `planificador` — Núcleo de Optimización

#### 2.5.1 Dominio (`planificador/domain/`)

| Archivo | Propósito |
|---------|-----------|
| `Route.java` | Ruta logística: lot + hops (ICAOs) + flights + métricas (demanda, capacidad asignada, arrival, deadline, status) |
| `Solution.java` | Conjunto de rutas + fitness score + backup routes precalculadas |
| `SimulationDayReport.java` | Reporte diario: SLA%, maletas atendidas/totales, saturación, colapso |
| `Event.java` / `EventType.java` | Eventos de simulación: `FLIGHT_DEPARTURE`, `FLIGHT_ARRIVAL`, `LOT_ARRIVAL`, `BAGGAGE_PICKUP` |

#### 2.5.2 Estrategia de Red (`planificador/strategy/`)

| Archivo | Propósito |
|---------|-----------|
| `NetworkAdapter.java` | Interfaz: `findBestRoute()`, `findAlternativeRoute()`, `invalidateGraph()` |
| `NetworkAdapterImpl.java` | **Dijkstra con grafo cacheado.** Construye grafo de adyacencia (vuelos por ICAO origen) via JOIN FETCH. Soporta exclusión de vuelos (para backups) y filtrado por capacidad disponible |
| `RouteStrategy.java` | Interfaz de estrategia (no utilizada directamente, patrón Strategy) |

**Algoritmo Dijkstra:** Usa `PriorityQueue` con nodos `(airport, time)`. La espera matemática `calcularEsperaMatematica()` resuelve la periodicidad diaria de vuelos con aritmética modular.

#### 2.5.3 Servicio de Planificación

| Archivo | Propósito |
|---------|-----------|
| `RouteBuilder.java` | Construye una `Route` para un `SuperLot`: llama a Dijkstra, calcula capacidad, simula saturación. `buildBackup()` genera ruta alternativa excluyendo vuelos de la principal |
| `FitnessEvaluator.java` | Fórmula: `score = 10×Atendidos − 0.005×E_cap − 2×DelayHoras − 12×SaturaciónAeropuerto + bonus_estabilidad` |
| `HGAPlannerService.java` | **Hybrid Genetic Algorithm**: Población=50, mutación=0.15, élite=5. Order Crossover (OX) + selección por torneo de 3. Genera backup routes al final |
| `ALNSPlannerService.java` | **Adaptive Large Neighborhood Search**: Destroy/Repair con Simulated Annealing. Operadores adaptativos con pesos dinámicos. Soporta `replanificar()` para warm-start con backups del HGA |
| `PlanningService.java` | Orquestador: elige HGA o ALNS según parámetro |
| `PlanningSessionHolder.java` | Almacena la solución activa para replanificación |

#### 2.5.4 Operadores ALNS (`planificador/alns/`)

| Archivo | Propósito |
|---------|-----------|
| `AdaptiveWeightTracker.java` | Pesos adaptativos por operador: REWARD_GLOBAL_BEST=10, REWARD_IMPROVE=5, REWARD_ACCEPT=2, REWARD_REJECT=0 |
| `AffectedByFlightDestroyOp.java` | Destruye rutas que usan un vuelo específico (cancelado) |
| `WorstDestroyOp.java` | Destruye las Q rutas con peor fitness |
| `RelatedDestroyOp.java` | Destruye rutas con origen/destino similares |
| `GreedyRepairOp.java` | Repara ordenando por SLA urgente y reconstruyendo |
| `RegretRepairOp.java` | Repara con criterio de "arrepentimiento" (regret-2): prioriza lotes con mayor diferencia entre mejor y segunda mejor inserción |

#### 2.5.5 Simulación

| Archivo | Propósito |
|---------|-----------|
| `SimulationRunner.java` | Ejecuta eventos sobre el estado: genera eventos desde rutas y los aplica secuencialmente |
| `SimulationState.java` | Estado mutable: carga por aeropuerto, capacidad por vuelo, saturación, colapso (reversible) |

#### 2.5.6 Motor Principal (`SimulationService.java` — 382 líneas)

**Es el corazón del sistema.** Ejecuta la simulación multi-día completa:

1. Carga envíos por rango de fechas (`cargarPorFecha`)
2. Para cada día: agrupa envíos → SuperLots → planifica (HGA/ALNS) → simula → reporta
3. **Modo colapso:** reduce capacidad de hubs (SKBO, LEMD, VIDP) al 50%, cancela rutas aleatoriamente según `stressFactor × 3%`, intenta replanificación ALNS
4. **Lotes pendientes:** rutas no atendidas se elevan a prioridad máxima para el día siguiente
5. **Playback visual:** 48 ciclos por día (cada 30 min simulados), con sleep configurable para presentación fluida
6. **WebSocket broadcasting:** actualiza progreso, rutas activas, KPIs y event log en tiempo real

#### 2.5.7 Otros Servicios

| Archivo | Propósito |
|---------|-----------|
| `SimulationProgressHolder.java` | Estado en memoria de sesiones activas (ConcurrentHashMap). Campos: percent, currentDay, airportLoads, activeRoutes, eventLog, stressFactor, startEpoch, algorithm |
| `SimulationExcelService.java` | Genera archivos Excel con resultados detallados de la simulación |

#### 2.5.8 Web (`planificador/web/`)

| Archivo | Propósito |
|---------|-----------|
| `SimulationController.java` | Endpoints: `POST /run/{dias}`, `POST /run-collapse/{dias}`, `GET /status/{id}` |
| `SimulationStatusDTO.java` | DTO completo: status, percent, reports, airportLoads, activeRoutes, eventLog, algorithm, stressFactor, startEpoch |

### 2.6 `experiment` — Experimentación Numérica (DOE)

| Archivo | Propósito |
|---------|-----------|
| `NumericExperimentService.java` | Calcula 5 niveles DOE (MIN, MID_LOW, AVG, MID_HIGH, MAX) desde archivos planos. Ejecuta HGA y ALNS sobre cada nivel y produce métricas comparativas |
| `ExperimentSession.java` | Estado de sesión de experimento con niveles y resultados |

### 2.7 `shared` — Infraestructura Transversal

| Archivo | Propósito |
|---------|-----------|
| `DataInitializer.java` | `CommandLineRunner`: carga aeropuertos + vuelos al arrancar. Envíos se cargan diferidamente |
| `AsyncConfig.java` | Pool `simulationExecutor` para ejecución asíncrona de simulaciones |
| `WebSocketConfig.java` | Configura STOMP sobre WebSocket: `/ws`, topics `/topic/sim/**` |
| `SecurityConfig.java` | Deshabilita CSRF, permite todos los endpoints, configura H2 console |
| `GlobalExceptionHandler.java` | Manejo centralizado de excepciones REST |

---

## 3. FRONTEND — ESTRUCTURA Y COMPONENTES

### 3.1 Punto de Entrada

| Archivo | Propósito |
|---------|-----------|
| `main.jsx` | Monta `<App />` en el DOM |
| `App.jsx` | Layout principal: mapa mundial + paneles flotantes + escenarios + botones globales (modo fluido, exportar MD) |
| `App.css` | ~50KB de estilos: diseño oscuro premium, animaciones, glassmorphism |

### 3.2 Hook Principal: `useControlTowerController.js` (~792 líneas)

**Es el cerebro del frontend.** Gestiona:
- Estado de simulación (`idle`, `running`, `completed`)
- Polling HTTP cada 1s al endpoint `/status/{sessionId}`
- Interpolación de reloj a 60 FPS
- Funciones: `startDayToDaySimulation()`, `startCollapseSimulation()`, `exportSimulationReportMd()`, `exportSimulationExcel()`
- Generación de reportes Markdown con metadatos técnicos (sesión, fecha, algoritmo, factor de estrés, desglose diario, bitácora)

### 3.3 Componentes del Mapa

| Archivo | Propósito |
|---------|-----------|
| `WorldMap.jsx` | Mapa SVG interactivo del mundo con proyección Mercator |
| `AirportLayer.jsx` | Renderiza aeropuertos como nodos con indicador de ocupación |
| `AircraftLayer.jsx` | Anima aviones en vuelo interpolando posición entre origen/destino |

### 3.4 Paneles de Control

| Archivo | Propósito |
|---------|-----------|
| `ControlDock.jsx` | Dock lateral con pestañas de escenarios |
| `ScenarioHeader.jsx` | Header con nombre del escenario activo y controles |
| `KpiStrip.jsx` | Barra de KPIs en tiempo real (SLA, demanda, ocupación) |
| `TelemetryPanel.jsx` | Panel de telemetría detallada |
| `TopAirportsPanel.jsx` | Top aeropuertos por ocupación |
| `AlgorithmComparisonPanel.jsx` | Comparativa HGA vs ALNS |

### 3.5 Escenarios

| Archivo | Propósito |
|---------|-----------|
| `DayToDayConfig.jsx` | Config de "Operación Día a Día": selector de algoritmo, fecha, inicio |
| `PeriodSimConfig.jsx` | Config de "Simulación de Periodo": 5 días fijos, algoritmo, exportar Excel/MD |
| `CollapseSimConfig.jsx` | Config de "Simulación de Colapso": factor de estrés (1-10), progreso con barra |

### 3.6 Datos Estáticos

| Archivo | Propósito |
|---------|-----------|
| `airportsData.js` | Coordenadas y metadata de los 45 aeropuertos para el mapa |
| `controlTowerData.js` | Configuración de tabs, filas de aeropuertos, nodos del grafo visual |

---

## 4. FLUJO DE DATOS COMPLETO

```
1. ARRANQUE: DataInitializer → carga aeropuertos.txt + planes_vuelo.txt → H2
2. USUARIO: Selecciona escenario + algoritmo + fecha → click "Iniciar"
3. FRONTEND: POST /api/v1/simulation/run/{dias}?algorithm=HGA&startDate=2026-01-02
4. BACKEND: Crea sesión → responde 202 con sessionId → lanza @Async
5. SIMULACIÓN:
   ├─ Carga envíos del rango de fechas
   ├─ Para cada día:
   │   ├─ SuperLotService.agruparEnviosPorFecha()
   │   ├─ HGA/ALNS planifica rutas (Dijkstra + metaheurística)
   │   ├─ [Colapso]: cancela rutas + intenta ALNS replan
   │   ├─ SimulationRunner simula eventos
   │   ├─ Actualiza ProgressHolder + broadcast WebSocket
   │   └─ Sleep por playback visual
   └─ Marca sesión DONE
6. FRONTEND: Polling /status/{id} → actualiza mapa, KPIs, progreso
7. EXPORTAR: Genera .md con metadatos + desglose diario + bitácora
```

---
---

# DOCUMENTACIÓN DE PROYECTO V2

> Versión desarrollada por compañeros del equipo con cambios significativos.

---

## 5. ARCHIVOS NUEVOS EN V2 (no existen en proyecto principal)

| Archivo | Propósito |
|---------|-----------|
| `CollapseEndCondition.java` | Enum con 3 condiciones de terminación de colapso: `SLA_BELOW_THRESHOLD`, `ALL_AIRPORTS_CRITICAL`, `NONE` |
| `RoutePool.java` | Object Pool para reciclar objetos Route (evita presión sobre GC) |
| `SimulationWsPublisher.java` | Publicador periódico dedicado por WebSocket (`@Scheduled` cada 500ms) |
| `FlightCancellationService.java` | Servicio dedicado para cancelación manual de vuelos con replanificación ALNS |
| `EventEngine.java` | Motor de eventos separado del SimulationRunner, con evento `STORAGE_RELEASE` (permanencia 24h) |
| `SimulationKpiSnapshotDTO.java` | DTO tipado para KPIs (reemplaza Map genérico) |
| `SimulationMapSnapshotDTO.java` | DTO tipado para snapshot del mapa |
| `SimulationMapRouteDTO.java` | DTO tipado para cada ruta activa en el mapa |
| `FlightCancellationPanel.jsx` | Panel frontend para cancelar vuelos manualmente durante simulación |
| `api.js` + `ws.js` | Módulos frontend separados para API REST y WebSocket (SockJS) |
| `PLANES/*.md` | 4 documentos de diseño: colapso informativo, escalado WebSocket, performance colapso |

---

## 6. CAMBIOS CLAVE V2 vs PRINCIPAL — ANÁLISIS COMPARATIVO

### 6.1 SimulationService — El cambio más grande

| Aspecto | Proyecto Principal | Proyecto V2 | Veredicto |
|---------|-------------------|-------------|-----------|
| **Líneas** | 382 | 760 | V2 es el doble de complejo |
| **Planificación** | 1 plan por día completo | Micro-batching: 48 planes por día (cada 30 min simulados) | ✅ **V2 mejor**: más realista, simula planificación continua |
| **Carga de envíos** | Todo el rango de golpe | Sliding window: día a día + purga de datos antiguos | ✅ **V2 mejor**: ahorra memoria significativamente |
| **Algoritmo** | HGA o ALNS seleccionable | Solo ALNS (HGA eliminado del flujo principal) | ⚠️ **Discutible**: pierde la comparativa HGA vs ALNS |
| **Ventana ALNS** | 8000ms por día | 500ms por ciclo (48 ciclos/día = ~24s total) | ✅ **V2 mejor**: más responsivo pero con menos optimización por ciclo |
| **Colapso** | Aborta implícitamente | Colapso INFORMATIVO: nunca aborta, termina por condición configurable | ✅ **V2 mejor**: más flexible y controlable |
| **Replan colapso** | Secuencial (250ms cada uno) | Paralelo con `replanExecutor` + ventana dinámica | ✅ **V2 mejor**: no bloquea el hilo principal |
| **Lotes pendientes** | Se pasan al día siguiente enteros | Se fusionan (Mega-Lots) vía `superLotService.mergeLots()` | ✅ **V2 mejor**: reduce fragmentación |
| **Profiling** | No tiene | Log estructurado por ciclo (planner, build, apply, update en ms) | ✅ **V2 mejor**: facilita debugging de performance |

### 6.2 SimulationState — Modelo de eventos

| Aspecto | Principal | V2 | Veredicto |
|---------|-----------|-----|-----------|
| **Eventos** | 4 tipos: DEPARTURE, ARRIVAL, LOT_ARRIVAL, BAGGAGE_PICKUP | 7 tipos: + STORAGE_RELEASE, FLIGHT_CANCELLED, REPLAN_TRIGGER | ✅ **V2 mejor**: modelo más completo |
| **Cola de espera** | No existe (maletas se pierden si almacén lleno) | Cola FIFO por aeropuerto con `drainCola()` | ✅ **V2 mejor**: más realista |
| **Permanencia** | No modelada | 24h en destino antes de liberar espacio (STORAGE_RELEASE) | ✅ **V2 mejor**: regla de negocio importante |
| **Hard Constraints** | No rastreadas | `maletasEmbarcadas` por (lote, vuelo) para tracking exacto | ✅ **V2 mejor**: evita sobre-conteo |
| **Métricas** | Básicas | + buildEventsTimeNanos, applyEventsTimeNanos, totalEventsCount | ✅ **V2 mejor**: instrumentación |

### 6.3 WebSocket Publishing

| Aspecto | Principal | V2 | Veredicto |
|---------|-----------|-----|-----------|
| **Mecanismo** | Inline en `updateProgress()` — emite en cada ciclo | `SimulationWsPublisher` dedicado con `@Scheduled(500ms)` | ✅ **V2 mejor**: desacopla simulación de I/O |
| **DTOs** | `Map<String, Object>` genérico en WsEnvelope | DTOs tipados: `SimulationKpiSnapshotDTO`, `SimulationMapSnapshotDTO` | ✅ **V2 mejor**: type-safe, documentable |
| **Deduplicación** | No — puede enviar duplicados | `finalSentBySession` evita spam post-completado | ✅ **V2 mejor** |
| **Rutas activas** | Por ruta lógica (duplica aviones) | Agrupadas por **vuelo físico** (mapKey = vueloId-depEpoch) | ✅ **V2 mejor**: evita aviones fantasma |
| **Snapshot** | Directo (race conditions posibles) | `volatile MapSnapshot` inmutable | ✅ **V2 mejor**: thread-safe |

### 6.4 Route + RoutePool

| Aspecto | Principal | V2 | Veredicto |
|---------|-----------|-----|-----------|
| **Route** | Solo `@Builder` | + `@NoArgsConstructor` + `clear()` para reciclaje | ✅ **V2 mejor**: habilita pooling |
| **RoutePool** | No existe | `ConcurrentLinkedQueue` — borrow/recycle | ⚠️ **Neutral**: buena idea pero no se usa consistentemente en el código |

### 6.5 Frontend

| Aspecto | Principal | V2 | Veredicto |
|---------|-----------|-----|-----------|
| **API** | URLs hardcoded `/api/v1/...` | `api.js` centralizado con `apiUrl()` + env variable | ✅ **V2 mejor**: configurable para deploy |
| **WebSocket** | Inline `new Client()` | `ws.js` con factory `createStompClient()` + SockJS | ✅ **V2 mejor**: compatible con proxies |
| **Panel de cancelación** | No existe | `FlightCancellationPanel.jsx` — cancelar vuelos manualmente | ✅ **V2 mejor**: feature útil para demos |
| **Assets** | Mínimos | + hero.png, MAPA.jpg, PANTALLA_1.png | Neutral: recursos visuales adicionales |

### 6.6 Documentación interna

| Principal | V2 | Veredicto |
|-----------|-----|-----------|
| Sin planes de diseño | 4 documentos `.md` en `PLANES/` | ✅ **V2 mejor**: decisiones documentadas |

---

## 7. RESUMEN EJECUTIVO

### Lo que V2 hace BIEN (recomendable adoptar):
1. **Micro-batching** — planificación cada 30 min simulados en vez de 1 plan/día
2. **Sliding window de datos** — carga y purga envíos día a día
3. **Colapso informativo** — no aborta, termina por condición configurable
4. **EventEngine separado** — con STORAGE_RELEASE y cola de espera
5. **WebSocket publisher desacoplado** — `@Scheduled` independiente del ciclo de simulación
6. **DTOs tipados** — reemplazan `Map<String,Object>` por clases documentables
7. **Replan paralelo** — `CompletableFuture` con `replanExecutor`
8. **Agrupación por vuelo físico** — evita aviones duplicados en el mapa

### Lo que V2 hace MAL o es discutible:
1. **Eliminó HGA del flujo principal** — pierde la capacidad de comparar algoritmos en simulación
2. **RoutePool declarado pero no integrado** — el código de ALNS/HGA no usa `RoutePool.borrow()`/`recycle()`
3. **Complejidad duplicada** — SimulationService de 760 líneas es difícil de mantener
4. **stressFactor cambió de `int` a `double`** — inconsistencia menor con el frontend que envía enteros
5. **`envioService.purgarAntesDe()`** — este método no existe en EnvioService del proyecto principal; si no está implementado, crasheará

### Lo que el proyecto principal hace que V2 NO tiene:
1. **Selección HGA vs ALNS en simulación** — el usuario puede elegir
2. **Exportación de reportes .md** integrada en el frontend con metadatos completos
3. **Campo `algorithm` en SessionState y DTO** — trazabilidad del algoritmo usado

---

*Documento generado automáticamente. No se modificó ninguna línea de código durante este análisis.*
