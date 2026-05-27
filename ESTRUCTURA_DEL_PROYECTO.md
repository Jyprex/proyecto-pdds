# TASF.B2B — Estructura del Proyecto
**Sistema de Optimización Logística Aeroportuaria**
Grupo 4D · Proyecto de Diseño de Software · Mayo 2026
Autores: Jim Navarrete, Diego Silvestre, Jose Avalos, Mathias Medina

---

## 1. Árbol de Archivos (estructura limpia)

```
proyecto-pdds-main/
├── backend/                        ← Spring Boot 3 (Java 21)
│   ├── pom.xml
│   ├── data/                       ← Archivos .txt del dataset
│   │   ├── c.1inf54.26.1.v1.Aeropuerto.husos.v1.20250818__estudiantes.txt
│   │   ├── planes_vuelo.txt
│   │   └── _envios_SKBO_.txt  (×28 archivos, uno por aeropuerto origen)
│   └── src/main/java/com/tasfb2b/
│       ├── BackendApplication.java
│       ├── aeropuerto/
│       │   ├── domain/Aeropuerto.java
│       │   ├── repository/AeropuertoRepository.java
│       │   └── service/AeropuertoService.java
│       ├── vuelo/
│       │   ├── domain/Vuelo.java
│       │   ├── repository/VueloRepository.java
│       │   └── service/VueloService.java
│       ├── envio/
│       │   ├── domain/Envio.java
│       │   ├── repository/EnvioRepository.java
│       │   ├── service/EnvioService.java
│       │   └── util/  (EnvioParser, NombreArchivoParser, ParsedEnvio)
│       ├── superlote/
│       │   ├── domain/SuperLot.java
│       │   └── service/SuperLotService.java
│       ├── planificador/
│       │   ├── alns/              ← Operadores ALNS
│       │   │   ├── AdaptiveWeightTracker.java
│       │   │   └── operator/     (Destroy: Worst, Related, AffectedByFlight)
│       │   │                     (Repair: Greedy, Regret)
│       │   ├── domain/           (Route, Solution, SimulationDayReport)
│       │   ├── service/
│       │   │   ├── ALNSPlannerService.java   ← 🧠 ALGORITMO ALNS
│       │   │   ├── HGAPlannerService.java    ← 🧬 ALGORITMO HGA
│       │   │   ├── SimulationService.java    ← Orquestador multi-día
│       │   │   ├── FitnessEvaluator.java
│       │   │   ├── RouteBuilder.java
│       │   │   ├── SimulationProgressHolder.java
│       │   │   └── SimulationExcelService.java
│       │   ├── simulation/
│       │   │   ├── SimulationRunner.java
│       │   │   └── SimulationState.java
│       │   └── web/
│       │       ├── SimulationController.java  ← REST API principal
│       │       └── PlanningController.java
│       ├── experiment/
│       │   ├── NumericExperimentService.java  ← DOE (5 niveles)
│       │   ├── NumericExperimentController.java
│       │   ├── ExcelExportService.java
│       │   └── ExperimentRunResult.java
│       └── shared/
│           └── config/
│               ├── DataInitializer.java       ← Carga inicial en arranque
│               └── AsyncConfig.java
│
├── frontend/                       ← React 18 + Vite
│   ├── src/
│   │   ├── main.jsx               ← Punto de entrada React
│   │   ├── App.jsx                ← Pantalla principal (Torre de Control)
│   │   ├── hooks/
│   │   │   ├── useControlTowerController.js  ← Estado global + API calls
│   │   │   └── useNumericExperiment.js
│   │   ├── components/
│   │   │   ├── map/WorldMap.jsx              ← Mapa interactivo (react-simple-maps)
│   │   │   ├── controlTower/                 ← Dock, Header, AirportDetail
│   │   │   ├── floating/                     ← Paneles flotantes (Telemetry, KPIs…)
│   │   │   ├── kpi/                          ← KpiStrip, SimulationControls
│   │   │   └── scenarios/
│   │   │       ├── DayToDayConfig.jsx        ← Panel: Operación Día a Día
│   │   │       ├── PeriodSimConfig.jsx       ← Panel: Simulación Período
│   │   │       └── CollapseSimConfig.jsx     ← Panel: Escenario de Colapso
│   │   ├── experiment/
│   │   │   └── NumericExperimentDashboard.jsx
│   │   └── data/
│   │       ├── airportsData.js
│   │       └── controlTowerData.js
│   └── public/
│       └── world-110m.json                   ← GeoJSON del mapa mundial
│
├── DATOS ANALISIS/                 ← Prototipos standalone Java (algoritmos puros)
│   ├── Main.java
│   ├── alns/  (ALNSPlanner, RuinOperators, RepairOperators, AdaptiveWeights)
│   └── hga/   (HGAPlanner, GeneticOperators, LocalSearch)
│
└── frontend/Documentation/        ← Estándares del proyecto
    ├── ALGORITHMS.md
    ├── REQUIREMENTS.md
    └── INFORME_SELECCION_ALGORITMOS.md
```

---

## 2. Configuración del Backend (application.properties)

```properties
spring.application.name=backend

# Base de datos H2 en memoria (reinicia limpia con cada arranque)
spring.h2.console.enabled=true
spring.h2.console.path=/h2-console
spring.datasource.url=jdbc:h2:mem:testdb

# Ruta a los archivos .txt del dataset
tasf.data.path=C:/Users/Mathias/Documents/proyecto-pdds-main/backend/data
```

> **Nota:** Se usa H2 en memoria porque el sistema carga y procesa los datos en caliente
> desde archivos `.txt` en cada sesión de simulación. No hay persistencia entre reinicios.

---

## 3. Entidades Clave del Dominio

### 3.1 `Aeropuerto.java`
```java
@Entity @Table(name = "aeropuertos")
public class Aeropuerto {
    @Id @GeneratedValue
    private Long id;

    @Column(unique = true, nullable = false)
    private String icaoCode;        // Código ICAO (ej: "SKBO")
    private String city;
    private String country;

    @Enumerated(EnumType.STRING)
    private Continente continent;   // EUROPA, ASIA, SUDAMERICA, etc.

    private Integer storageCapacity; // Capacidad máx. de almacenamiento (maletas)
    private Integer gmtOffset;       // Offset UTC en horas
    private Double latitude;
    private Double longitude;

    // Métodos de negocio
    public boolean esIntercontinentalCon(Aeropuerto otro) { ... }
    public long toEpochMillis(int minuteOfDay) { ... }
}
```

### 3.2 `Vuelo.java`
```java
@Entity @Table(name = "vuelos")
public class Vuelo {
    @Id @GeneratedValue
    private Long id;

    @ManyToOne Aeropuerto origen;
    @ManyToOne Aeropuerto destino;

    private Integer capacidadTotal;   // Maletas que puede llevar
    private Integer departureMinute;  // Minutos desde 00:00 (0–1439)
    private Integer arrivalMinute;
    private Boolean intercontinental;
    private Boolean cancelled;

    // Métodos de negocio
    public int getDuracionMinutos() { ... }  // Maneja cruce de medianoche en UTC
    public long calcularSiguienteSalida(long currentTimeMs) { ... }
    public boolean esFactibleDesde(long currentTimeMs) { ... }
}
```

### 3.3 `Envio.java`
```java
@Entity
@Table(name = "envios",
    uniqueConstraints = @UniqueConstraint(columnNames = {"codigo_pedido", "origen_id"}))
public class Envio {
    @Id @GeneratedValue
    private Long id;

    private String codigoPedido;     // Identificador del pedido
    private LocalDate fecha;
    private LocalTime hora;

    @ManyToOne Aeropuerto origen;    // Deducido del nombre del archivo .txt
    @ManyToOne Aeropuerto destino;
    private Integer cantidadMaletas;
    private String clienteId;
}
```

### 3.4 `SuperLot.java` (objeto de dominio de planificación)
```java
// No es una entidad JPA — es el objeto que los algoritmos planifican
public class SuperLot {
    private Integer id;
    private String origenIcao;
    private String destinoIcao;
    private int totalMaletas;       // Demanda agregada del par OD
    private long readyTime;         // Epoch ms: cuándo el lote está listo
    private long sla;               // Epoch ms: deadline de entrega
    private boolean intercontinental;
    private int priority;           // Integer.MAX_VALUE = urgente
}
```

---

## 4. El "Cerebro" — Algoritmos de Optimización

### 4.1 ALNS (`ALNSPlannerService.java`) — Escenario TIEMPO_REAL

**Rol:** Replanificación reactiva y rápida ante disrupciones (cancelaciones de vuelos, colapsos).

**Método principal:** `plan(lots, windowMs)` / `replanificar(vueloIdCancelado, windowMs)`

**Flujo interno:**
```
1. buildInitialSolution()     ← Greedy: ordenar por urgencia SLA
2. while (tiempo < ventana):
   a. Seleccionar DestroyOperator (Worst / Related / AffectedByFlight)
   b. destroy(candidate, q=20%)  → extrae lotes afectados
   c. buildCapacidadDisponible() → mapa vueloId → capacidad libre
   d. Seleccionar RepairOperator (Greedy / Regret)
   e. repair(candidate, removed) → reasigna lotes por Dijkstra
   f. evalFitness()              → 10A − 0.005Ecap − 2Dh − 12Saero
   g. Aceptar por SA (Simulated Annealing) si delta < 0
   h. Actualizar pesos (AdaptiveWeightTracker) cada 100 iters
3. Retorna mejor solución global
```

**Parámetros:** `INITIAL_TEMP_FACTOR=0.05`, `COOLING_FACTOR=0.997`, `SEGMENT_SIZE=100`, `DESTROY_FRACTION=0.20`

**Ventana de tiempo:** ~6.5 segundos (escenario TIEMPO_REAL)

---

### 4.2 HGA (`HGAPlannerService.java`) — Escenario PERIODO

**Rol:** Planificación estructural nocturna exhaustiva.

**Método principal:** `plan(lots, null, windowMs)`

**Flujo interno:**
```
1. initPopulation(50 individuos)
   - Individuo 1: ordenado por SLA (greedy)
   - Individuos 2-50: permutaciones aleatorias
2. while (tiempo < ventana):
   a. Evaluar fitness de cada individuo
   b. Elitismo: conservar top 5
   c. Generar nuevos individuos:
      - Selección por torneo (3 candidatos)
      - Order Crossover (OX)
      - Mutación: swap aleatorio (15%)
3. Al finalizar: generar BACKUP ROUTES para cada ruta óptima
   → Las guarda en Solution.backupRoutes
   → El ALNS las usa como warm-start ante cancelaciones
```

**Parámetros:** `POP_SIZE=50`, `MUTATION_RATE=0.15`, `ELITE_SIZE=5`

**Ventana de tiempo:** ~45 segundos (escenario PERIODO)

---

### 4.3 `SimulationService.java` — Orquestador Multi-Día

**Flujo por día:**
```
Para día N en [0..dias]:
  1. cargarPorFecha(fechaN)        ← Lee .txt para esa fecha
  2. superLotService.agrupar()     ← Agrupa envíos en SuperLots por par OD
  3. alnsPlanner.plan() o hgaPlanner.plan()
  4. [Si collapseMode]:
     - Reducir capacidad de hubs en 50%
     - Cancelar 15% de rutas aleatoriamente
     - ALNS "rescata" las canceladas; HGA las pierde
  5. simulationRunner.run()        ← Simula eventos hora a hora
  6. Calcular métricas: SLA%, E_cap, saturaciónAeropuerto
  7. Propagar lotes pendientes al día N+1 con prioridad MAX
  8. Actualizar SimulationProgressHolder cada hora simulada (polling frontend)
```

---

## 5. API REST — Endpoints Principales

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/v1/simulation/run/{dias}?algorithm=ALNS&startDate=2026-01-15` | Inicia simulación estándar → HTTP 202 + `{sessionId}` |
| POST | `/api/v1/simulation/run-collapse/{dias}` | Inicia simulación con inyección de colapso |
| GET  | `/api/v1/simulation/status/{sessionId}` | Estado en tiempo real (polling cada 2s) |
| POST | `/api/v1/simulation/export-excel/{sessionId}` | Exporta resultados a Excel |
| POST | `/api/v1/planificador/ejecutar` | Ejecuta planificación puntual (HGA) |
| POST | `/api/v1/planificador/replanificar/{vueloId}` | Replanifica por cancelación (ALNS) |
| POST | `/api/v1/experiment/start` | Inicia experimento DOE (5 niveles) |
| GET  | `/api/v1/experiment/status/{sessionId}` | Estado del experimento numérico |
| POST | `/api/v1/experiment/export/{sessionId}` | Exporta Excel comparativo HGA vs ALNS |

---

## 6. Frontend — Arquitectura React

### Patrón: Container-Presenter

```
main.jsx
  └── App.jsx (Container)
        ├── useControlTowerController.js  ← TODO el estado y lógica de negocio
        │     ├── sessionId, liveStatus, simState
        │     ├── startSimulation(), startDayToDaySimulation()
        │     ├── startCollapseSimulation()
        │     └── polling cada 2s a /api/v1/simulation/status/{id}
        │
        └── UI (Presenter) — solo recibe props, no tiene lógica
              ├── WorldMap.jsx          ← Mapa con aviones animados (60fps via rAF)
              ├── ScenarioHeader.jsx    ← Tabs: Día a Día / Periodo / Colapso
              ├── KpiStrip.jsx          ← Métricas en tiempo real
              ├── DayToDayConfig.jsx    ← Panel configuración TIEMPO_REAL
              ├── PeriodSimConfig.jsx   ← Panel configuración PERIODO
              ├── CollapseSimConfig.jsx ← Panel configuración COLAPSO
              └── [paneles flotantes]   ← Telemetría, Top Aeropuertos, Comparación
```

### Los 3 Escenarios en el Frontend

| Tab | Componente | Qué hace el usuario | Qué llama |
|-----|-----------|-------------------|-----------|
| Día a Día | `DayToDayConfig` | Selecciona fecha (hoy por defecto), inicia 1 día | `POST /run/1?algorithm=ALNS&startDate=...` |
| Período | `PeriodSimConfig` | Selecciona rango de fechas y días | `POST /run/{dias}?startDate=...` |
| Colapso | `CollapseSimConfig` | Selecciona fecha de crisis, factor de estrés | `POST /run-collapse/{dias}?startDate=...` |

---

## 7. Flujo de Carga de Datos (.txt → BD → Algoritmo)

```
Arranque del servidor
  └── DataInitializer.init()
        ├── AeropuertoService.cargarDesdeArchivo("Aeropuerto.husos.txt")
        │     → Lee líneas, parsea ICAO/ciudad/GMT/capacidad → INSERT en aeropuertos
        └── VueloService.cargarDesdeArchivo("planes_vuelo.txt")
              → Lee líneas, parsea origen/destino/horarios/capacidad → INSERT en vuelos

Al iniciar simulación (POST /run)
  └── EnvioService.cargarPorFecha(inicio, fin, dataPath)
        ├── Escanea _envios_XXXX_.txt (donde XXXX = ICAO origen)
        ├── Filtra líneas cuya fecha cae en [inicio, fin]
        ├── Pre-carga Set<String> de codigosPedido ya en BD (evita duplicados)
        └── Inserta en lotes de 500 (BATCH_SIZE)

Formato de cada línea en _envios_XXXX_.txt:
  CODIGO-YYYYMMDD-HH-MM-DESTINO-CANTIDAD-CLIENTE
  000005032-20260115-08-30-LEMD-042-0001234
  │         │        │  │  │    │   └─ clienteId (7 dígitos)
  │         │        │  │  │    └──── cantidadMaletas (3 dígitos)
  │         │        └──┴─────────── hora (08:30)
  │         └───────────────────────── fecha (YYYYMMDD)
  └────────────────────────────────────── código pedido

El ORIGEN se extrae del nombre del archivo: _envios_SKBO_.txt → "SKBO"
```

---

## 8. Función Objetivo del Sistema

```
F(S) = 10·A − 0.005·Ecap − 2·Dh − 12·Saero

Donde:
  A    = lotes atendidos dentro del SLA
  Ecap = exceso de demanda no atendida (maletas sin vuelo)
         max(0, demanda_total − atendidas − capacidad_almacenaje)
  Dh   = horas de retraso promedio
  Saero = saturación promedio de aeropuertos [0, 1]

Colapso Computacional (Ta ≥ Sa):
  Sa = 15 segundos (umbral operativo)
  Si planningTimeMs ≥ Sa → el algoritmo no pudo planificar antes del despegue
  → log.warn("[COLAPSO COMPUTACIONAL]")
```

---

## 9. Stack Tecnológico Completo

| Capa | Tecnología | Versión |
|------|-----------|---------|
| Backend Framework | Spring Boot | 3.5 |
| Lenguaje Backend | Java | 21 |
| Base de Datos | H2 (in-memory) | 2.3 |
| ORM | Hibernate / Spring Data JPA | 6.6 |
| Build Tool | Maven | 3.x |
| Frontend Framework | React | 18 |
| Build Tool Frontend | Vite | 8.x |
| Mapa Interactivo | react-simple-maps | 3.x |
| Exportación | Apache POI (Excel) | — |
| Animación de Aviones | requestAnimationFrame (60fps) | — |
| Comunicación | REST + Polling cada 2s | — |
