# Reporte de Comparación: Arquitectura y Lógica (Código Actual vs Versión v3)

Este documento presenta una comparación detallada entre la versión actual del proyecto (`proyecto-pdds-main`) y la versión de prueba de su compañero (`proyecto-v3`).

---

## 1. Algoritmos de Planificación y Replanificación (HGA vs ALNS)

### Código Actual (Nuestra Versión)
*   **Algoritmos Soportados:** Ofrece soporte dual y dinámico tanto para **HGA (Hybrid Genetic Algorithm)** como para **ALNS (Adaptive Large Neighborhood Search)**.
*   **Estrategia de Evaluación de Fitness:** Implementa una **Evaluación por Subrogados (Surrogate Evaluation Strategy)** en `ALNSPlannerService.java`. Antes de ejecutar el motor de eventos de simulación completo (el cual es muy costoso en términos de CPU), el algoritmo realiza una pre-evaluación estática rápida utilizando `fitnessEval.evaluateRoutes`. Solo si la ruta pasa esta prueba de simulated annealing o mejora el fitness estimado, se invoca a `simulator.run` para obtener el estado exacto. Esto reduce las llamadas al simulador en un **70-80%**, acelerando notablemente la convergencia de la optimización.
*   **Resolución de Conflictos de Capacidad:** Ordena los paquetes (rutas) de manera híbrida por prioridad descendente y luego por cercanía de entrega (`deadline` / `readyTime`). Esto garantiza que los paquetes urgentes no sufran cuellos de botella por paquetes de menor prioridad pero de fecha límite tardía.
*   **Reciclador de Objetos:** Implementa un `RoutePool` para reutilizar instancias de rutas descartadas en la búsqueda local de ALNS, disminuyendo la presión sobre el Recolector de Basura (Garbage Collector) de Java.

### Versión v3 (Compañero)
*   **Algoritmos Soportados:** Únicamente soporta **ALNS**; la lógica del algoritmo genético HGA ha sido omitida o eliminada del controlador y de los servicios de planificación.
*   **Evaluación de Fitness:** Carece de evaluación por subrogados. Invoca a `simulator.run` (que construye y ejecuta todos los eventos del simulador) en **cada iteración** del bucle principal de ALNS. Esto produce un rendimiento significativamente menor en máquinas de desarrollo y limita la cantidad de iteraciones que pueden completarse dentro de la ventana de replanificación.
*   **Resolución de Conflictos de Capacidad:** Ordena exclusivamente por prioridad descendente (`priority`), lo que puede causar que paquetes de alta prioridad consuman toda la capacidad física de vuelos tempranos, dejando sin opciones a paquetes con fecha de entrega inmediata (SLA crítico).

---

## 2. Gestión de Cancelaciones y Persistencia Multi-Día

### Código Actual (Nuestra Versión)
*   **Cancelaciones Previas y en Operación:** Permite realizar cancelaciones de dos formas:
    1.  **Pre-simulación (Pre-cancellations):** Programadas desde el panel de control antes de ejecutar la simulación, soportando filtros por día específico (`flightId:day`) o globales (`flightId:all`).
    2.  **Durante la simulación (Live cancellations):** Manuales mediante el dock de vuelo en tiempo real.
*   **Persistencia y Restauración de Vuelos:** Implementa el método `restaurarVuelosEnBD()` en `SimulationService.java` que restaura el estado físico de los vuelos cancelados (`cancelled = false`) al iniciar la simulación o al pasar a un nuevo día simulado. Esto evita que los vuelos cancelados de un día anterior interfieran de forma errónea con los vuelos del día siguiente.
*   **Registro en Reportes:** Las pre-cancelaciones se registran formalmente en la bitácora de eventos del reporte exportable en Markdown.

### Versión v3 (Compañero)
*   **Cancelaciones Soportadas:** Solo dispone de la funcionalidad de cancelación durante la simulación (`Live`). No tiene soporte para cancelaciones previas ni filtros por días específicos.
*   **Persistencia de Estado de Vuelos:** No restaura el estado de los vuelos en base de datos al cambiar de día. Esto puede causar "fugas de estado", donde un vuelo cancelado de manera manual permanece cancelado para todas las simulaciones subsecuentes a menos que se reinicie el servidor de Spring Boot.

---

## 3. Motor de Simulación y Ciclo de Eventos

Ambos sistemas modelan los envíos como un flujo de eventos cronológicos ordenados en una cola de prioridad. Sin embargo, existen diferencias clave en la transición de estados:

### Tabla de Comparación de Eventos

| Evento | Descripción / Uso | Implementación en Código Actual | Implementación en Versión v3 |
| :--- | :--- | :--- | :--- |
| `LOT_ARRIVAL` | Llegada de maletas al origen | Registra el lote en cola. | Mismo comportamiento. |
| `FLIGHT_DEPARTURE` | Despegue del avión con carga | **Restringe capacidad de forma real.** Descuenta capacidad en base al espacio físico remanente en el avión, no en la planificación abstracta (Hard Constraint). | Mismo comportamiento. |
| `FLIGHT_ARRIVAL` | Aterrizaje del vuelo en escalas/destino | Aplica el ingreso del paquete al almacén y recalcula la saturación. Si el almacén está lleno, encola usando una cola FIFO. | Mismo comportamiento. |
| `STORAGE_RELEASE` | Liberación de almacén (24h de permanencia) | Libera espacio en el almacén de destino exactamente 24 horas después de la hora de llegada. | Mismo comportamiento. |
| `BAGGAGE_PICKUP` | Retiro del cliente final | Decrementa carga y suma maletas entregadas. | Mismo comportamiento. |
| `FLIGHT_CANCELLED` | Vuelo cancelado | Suma maletas a espera de replanificación. | Mismo comportamiento. |
| `REPLAN_TRIGGER` | Disparador de replanificación ALNS | Modifica rutas y reduce carga en espera. | Mismo comportamiento. |

### Lógica de Avance Temporal (`advanceTo` y `runUntil`)
*   **Nuestra Versión:** `SimulationRunner.java` incluye la función de simulación parcial `runUntil` y un método `advanceTo` más robusto que filtra eventos en la ventana temporal exacta (`e.getTime() > lastProcessedTime && e.getTime() <= endTime`). Esto evita duplicar o saltear eventos que ocurren en el límite exacto del milisegundo de sincronización.
*   **Versión v3:** Carece del método `runUntil`. Su función `advanceTo` avanza usando condicionales simples (`e.getTime() < state.getCurrentTime()` para saltar y `e.getTime() >= untilTime` para detenerse), lo cual tiene susceptibilidad a errores de frontera bajo micro-batching rápido.

---

## 4. Arquitectura de Red y Streaming (WebSocket STOMP vs Polling HTTP)

Esta es la diferencia técnica más significativa entre ambas versiones:

### Código Actual (Nuestra Versión)
*   **Protocolo de Comunicación:** Utiliza peticiones HTTP estándar mediante **Polling** periódico (cada 1 segundo) para consultar el estado actual de la simulación `/api/v1/simulation/status/{sessionId}` y el mapa `/api/v1/simulation/map-snapshot/{sessionId}`.
*   **Ventajas:**
    *   **Simplicidad:** Menor complejidad en el servidor, no requiere mantener hilos dedicados de sockets abiertos.
    *   **Robustez de conexión:** Tolera desconexiones breves de red sin requerir negociaciones de handshake ni causar fugas de memoria o bloqueos de hilo por reconexión.
*   **Desventajas:** Mayor sobrecarga de cabeceras HTTP si el tráfico de red es muy elevado.

### Versión v3 (Compañero)
*   **Protocolo de Comunicación:** Integra **WebSocket sobre protocolo STOMP** (usando SockJS en el cliente). Define un publicador asíncrono (`SimulationWsPublisher.java`) que empuja el estado del mapa, los KPIs y los logs a través de tópicos específicos (`/topic/sim/{sessionId}/snapshot`, `/topic/sim/{sessionId}/kpi`, `/topic/sim/{sessionId}/eventLog`).
*   **Ventajas:**
    *   Transmisión de datos en tiempo real con latencia reducida.
    *   Reduce el número de solicitudes de red HTTP.
*   **Desventajas:**
    *   **Complejidad de I/O:** Introduce hilos asíncronos y un Message Broker en Spring Boot que puede consumir más recursos si hay múltiples sesiones activas.
    *   **Riesgo de desincronización:** Si el cliente se desconecta temporalmente, se pueden perder deltas de logs o snapshots del mapa que no se vuelven a solicitar de forma histórica.

---

## 5. Interfaz de Usuario y UX

*   **Páneles de Control:**
    *   **Nuestra Versión:** Mantiene activa la sección de **Experimentación Numérica**, el control de velocidad en modo rápido/fluido (60 FPS) y los cuadros de comparación de algoritmos en caliente. Incorpora un selector de cancelaciones de vuelos por día para simulación periodica y de colapso.
    *   **Versión v3:** Tiene comentadas y deshabilitadas las opciones de experimentación numérica, los selectores de modo de velocidad fluida y el panel de comparación de algoritmos. Tampoco ofrece la interfaz de cancelación previa por días, limitándose al panel de simulación clásico.

---

## Conclusión y Evaluación Crítica

*   **¿Qué está mejor en nuestra versión?**
    1.  **Rendimiento del Algoritmo:** Nuestra técnica de **Surrogate Evaluation** en ALNS es técnicamente superior y reduce dramáticamente la carga de procesamiento, permitiendo una planificación más eficiente.
    2.  **Lógica Funcional de Negocio:** La inclusión de cancelaciones programadas previas a la simulación con granularidad por día, y la correcta limpieza del estado de la base de datos (`restaurarVuelosEnBD()`), resuelven problemas de fuga de estado presentes en la v3.
    3.  **Algoritmos:** Contamos con soporte para el algoritmo HGA que la v3 eliminó por completo.
*   **¿Qué está mejor en la versión v3?**
    1.  **WebSocket STOMP:** El uso de WebSockets en lugar de HTTP Polling para el streaming del mapa vivo y los KPIs es una mejora moderna para la visualización fluida de vuelos, aunque añade complejidad de red y riesgos de pérdida de logs si el cliente reconecta.
