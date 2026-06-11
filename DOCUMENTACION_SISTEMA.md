# 📄 Documentación Técnica del Sistema: TASF-B2B

Este documento detalla la arquitectura, el flujo de datos, los componentes y la lógica algorítmica del sistema **TASF-B2B** (versión actual y optimizada del proyecto principal), excluyendo comparaciones externas.

---

## 1. Arquitectura General y Stack Tecnológico

El sistema adopta una arquitectura de monolito modular con comunicación en tiempo real y asíncrona entre el servidor y el cliente.

```
       [ Client / Frontend (React + Vite) ]
               │                     ▲
         HTTP  │ (REST Requests)     │ (STOMP WebSockets)
        (Poll) │                     │ (Sim Telemetry)
               ▼                     │
       [ Server / Backend (Spring Boot + H2 in-memory DB) ]
```

*   **Frontend (Puerto 5173):** Desarrollado en React con Vite y Vanilla CSS. Utiliza visualización de mapas SVG para telemetría interactiva de vuelos, interpolación de tiempo real a 60 FPS para el movimiento de aeronaves y exportación estructurada de reportes finales en Markdown.
*   **Backend (Puerto 8080):** Spring Boot 3.5 con Java 21 y base de datos embebida H2. Implementa un pool de ejecución asíncrono (`simulationExecutor`) para no bloquear el hilo de peticiones HTTP durante simulaciones de larga duración.
*   **Comunicación:** Peticiones REST para operaciones de control (iniciar, pausar, resetear, cancelar) y canal WebSockets (STOMP) con fallback de HTTP Polling periódico para transmitir métricas en vivo.

---

## 2. Lógica del Motor de Simulación (EventEngine)

La simulación es un motor de eventos de tiempo discreto (DES) que procesa cronológicamente un conjunto de eventos ordenados en una cola de prioridad.

### 2.1 Flujo de Eventos Soportados

El ciclo de vida de un envío de equipaje se compone de los siguientes eventos fundamentales:

1.  **`LOT_ARRIVAL` (Llegada al origen):** 
    *   *Propósito:* Marca el momento en que un lote de equipajes (`SuperLot`) está listo en el aeropuerto de origen.
    *   *Lógica:* Registra la cantidad de maletas en la base temporal y habilita su procesamiento por parte de la primera escala de vuelos.
2.  **`FLIGHT_DEPARTURE` (Despegue de Vuelo - Restricción Hard):**
    *   *Propósito:* Ejecuta el despegue físico del avión con los paquetes asignados.
    *   *Lógica:* Evalúa la capacidad remanente real del avión en la base de datos de simulación (`capacidadVuelo`). Si la capacidad planificada supera a la disponible por sobre-venta u otras restricciones, solo se embarca la cantidad máxima física posible (`maletasEmbarcadas = min(load, capacity)`). El excedente queda en tierra (respetando restricciones rígidas o *Hard Constraints*).
3.  **`FLIGHT_ARRIVAL` (Aterrizaje en Escala/Destino):**
    *   *Propósito:* Registra la llegada física del avión y sus maletas al almacén del aeropuerto de destino.
    *   *Lógica:* Incrementa la carga del almacén del aeropuerto. 
    *   *Mecanismo de Cola FIFO:* Si el ingreso supera la capacidad de almacenamiento máxima (`storageCapacity`), se almacena la fracción permitida y el resto entra en una cola de espera FIFO por aeropuerto (`PendingBag`). Esto evita pérdidas de inventario por saturación física.
4.  **`STORAGE_RELEASE` (Permanencia 24 Horas):**
    *   *Propósito:* Modela el tiempo reglamentario de permanencia de los paquetes en almacenes de tránsito.
    *   *Lógica:* El equipaje debe quedarse exactamente 24 horas locales en el almacén de destino tras su aterrizaje antes de liberarse formalmente, reduciendo así la carga física del almacén y permitiendo que la cola FIFO (`PendingBag`) sea drenada progresivamente.
5.  **`BAGGAGE_PICKUP` (Retiro por Cliente):**
    *   *Propósito:* Entrega final al cliente y salida del sistema.
    *   *Lógica:* Decrementa el stock del aeropuerto final y suma las maletas entregadas con éxito para el cálculo del SLA general de la jornada.
6.  **`FLIGHT_CANCELLED` (Vuelo Cancelado):**
    *   *Propósito:* Registra la interrupción de un vuelo físico.
    *   *Lógica:* Registra el ID de vuelo en el estado y transfiere las maletas asociadas a la cola de replanificación en caliente.
7.  **`REPLAN_TRIGGER` (Disparador de Replanificación):**
    *   *Propósito:* Ejecuta el algoritmo ALNS en caliente para encontrar una ruta alternativa rápida a los paquetes varados.

---

## 3. Algoritmos de Planificación y Optimización

La plataforma dispone de dos grandes heurísticas combinatorias para optimizar las rutas y cumplir los Acuerdos de Nivel de Servicio (SLA: 24h intracontinental, 48h intercontinental).

```
                      [ SuperLots (Demanda Agrupada) ]
                                      │
                 ┌────────────────────┴────────────────────┐
                 ▼                                         ▼
   [ Hybrid Genetic Algorithm (HGA) ]        [ Adaptive Large Neighborhood (ALNS) ]
      - Selección Torneo / OX                   - Selección Ruleta de Operadores
      - Elitismo / Backup Routes                - Búsqueda Local / Simulated Annealing
                                                - Surrogate Evaluation (Filtro Rápido)
```

### 3.1 HGA (Hybrid Genetic Algorithm)
*   **Funcionamiento:** Trabaja con una población de 50 individuos (soluciones candidatas). Utiliza el operador de cruzamiento de orden (**OX - Order Crossover**) para preservar secuencias viables de escalas y aplica mutaciones con una probabilidad del 15% para evitar óptimos locales. Mantiene un elitismo rígido de los 5 mejores individuos.
*   **Backup Routes:** Al finalizar, el HGA precalcula una solución de respaldo para cada lote (`backupRoutes`), construyendo una ruta alternativa a través de Dijkstra que excluye explícitamente los vuelos utilizados en la ruta primaria. Esto permite una replanificación instantánea en caso de cancelaciones durante el vuelo.

### 3.2 ALNS (Adaptive Large Neighborhood Search)
*   **Búsqueda Adaptativa:** Utiliza un set de operadores de destrucción (Worst, Related, AffectedByFlight) y reparación (Greedy, Regret-2) cuyos pesos se ajustan dinámicamente mediante una ruleta según su éxito histórico.
*   **Surrogate Evaluation (Evaluación por Subrogados):** 
    *   *Problema:* Correr el motor de eventos de simulación completo en cada iteración de ALNS para medir el fitness exacto es extremadamente lento.
    *   *Solución:* ALNS realiza una pre-evaluación estática rápida utilizando `fitnessEval.evaluateRoutes(candidate)`. Si la estimación estática del fitness mejora la solución actual (o es aceptada por la probabilidad de simulated annealing), recién se procede a invoca al simulador real (`simulator.run`). Esto optimiza los recursos de CPU y permite realizar un número de iteraciones muy superior en la misma ventana de tiempo.

### 3.3 Dijkstra State-Aware con Espera Modular
*   Construye la matriz de adyacencia de vuelos mediante un JOIN FETCH optimizado.
*   La búsqueda del camino más corto considera el paso del tiempo. Si un paquete llega a un aeropuerto intermedio, la función `calcularEsperaMatematica()` calcula modularmente las horas de espera requeridas hasta la salida del siguiente vuelo físico del plan del día siguiente.

---

## 4. Arquitectura de Datos y Gestión de Módulos (Backend)

*   **`aeropuerto`:** Modela aeropuertos con su ICAO, coordenadas DMS convertidas automáticamente a decimal y zonas horarias (GMT offsets) para traducir eventos a UTC.
*   **`envio`:** Carga diferida de los archivos de envíos diarios. En lugar de procesar megabytes de archivos planos al arranque del servidor, se utiliza una ventana móvil en la simulación que carga únicamente la fecha correspondiente a la jornada en curso y purga datos de más de 3 días para optimizar la memoria Heap de Java.
*   **`vuelo`:** Contiene el plan maestro de vuelos. Implementa la lógica de periodicidad diaria y marcas físicas de cancelación.
*   **`superlote`:** Agrupador de envíos con el mismo par origen-destino. Agrega la demanda y calcula el tiempo de inicio más temprano (`readyTime`) y los plazos de entrega requeridos para guiar los algoritmos.

---

## 5. Sistema de Cancelaciones e Integración Multidía

El sistema dispone de un esquema avanzado para simular interrupciones operativas:

### 5.1 Cancelación Previa (Pre-Simulation)
*   Permite definir qué vuelos estarán caídos antes de iniciar la jornada.
*   El backend interpreta una cadena de parámetros en formato `flightId:day` (ej: `10:1` cancela el vuelo 10 solo en el día 1; `15:all` cancela el vuelo 15 en todas las jornadas).
*   **Restauración entre días (`restaurarVuelosEnBD()`):** Al inicio de cada día de simulación, el sistema ejecuta una restauración que limpia los flags de cancelación del día anterior. Esto asegura la fidelidad e independencia de la simulación multijornada sin fugas de estado.

### 5.2 Cancelación en Caliente (Live Simulation)
*   Si un usuario cancela un vuelo durante el playback activo en el dashboard, el hilo asíncrono intercepta el evento, invalida el grafo de Dijkstra y dispara una replanificación ALNS en caliente para reencauzar los equipajes varados por rutas alternativas (usando las backup routes precalculadas si están disponibles).

---

## 6. Frontend y Tablero de Control

*   **Movimiento e Interpolación 60 FPS:** El componente de telemetría del frontend calcula la posición geográfica exacta interpolando las coordenadas lat/lon de los aviones según el reloj interno simulación, logrando trayectorias fluidas en el mapa SVG.
*   **Experimentación Numérica:** Panel dedicado que ejecuta comparaciones estructuradas de algoritmos (HGA vs ALNS) sobre 5 niveles estandarizados de demanda (MIN, MID_LOW, AVG, MID_HIGH, MAX), graficando métricas de SLA y tiempos de convergencia.
*   **Exportador de Reportes:** Al finalizar cualquier simulación, el frontend autogenera un documento Markdown descargable que documenta la sesión, fecha, algoritmos, desgloses detallados por día y la bitácora completa de incidentes del simulador.
