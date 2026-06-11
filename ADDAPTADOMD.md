# 📊 Reporte de Auditoría y Adaptaciones Logísticas: TASF-B2B (V2)

Este documento detalla los hallazgos de la auditoría de la base de código del Sistema de Control Logístico **TASF-B2B** y las adaptaciones implementadas para asegurar el cumplimiento de las reglas de negocio descritas en `CASE.md` y `PLANIFICACION_PROGRAMADA.md`.

---

## 🔍 1. Archivos Analizados
La auditoría abarcó de manera exhaustiva los siguientes componentes de la arquitectura del planificador y del motor de simulación:
1. **`SimulationService.java`**: Hilo asíncrono que corre la simulación multi-día con micro-batching de 48 ciclos diarios.
2. **`FlightCancellationService.java`**: Servicio invocado al cancelar vuelos desde el frontend.
3. **`FlightCancellationScheduler.java`**: Programación nocturna encargada de restaurar la disponibilidad de vuelos.
4. **`Vuelo.java`** y **`VueloRepository.java`**: Entidad persistente de vuelos y sus métodos de consulta.
5. **`EventEngine.java`**: Generador cronológico de eventos para las simulaciones.

---

## ⚠️ 2. Problemas Identificados ("Amnesia de IA")
Se detectaron tres desviaciones críticas en las que el código de la V2 había perdido la alineación con las reglas de oro:

1. **Problema de Sincronización en la Replanificación Activa (El Error de la Amnesia):**
   * *Diagnóstico:* Al cancelar un vuelo manualmente, el hilo HTTP llamaba a `alnsPlanner.replanificar()`. Sin embargo, la simulación corre de forma asíncrona en un hilo separado del pool `simulationExecutor`, manteniendo su propio `masterSolution` en una variable local. 
   * *Impacto:* La llamada a `replanificar` fallaba con `IllegalStateException` (ya que `sessionHolder` no tiene solución activa durante una simulación) o los cambios no se propagaban al bucle activo. La simulación seguía moviendo paquetes en vuelos cancelados como si nada hubiese pasado.
   
2. **Falta de Restauración Diaria en Tiempo Simulado:**
   * *Diagnóstico:* Según `CASE.md`, la cancelación de un vuelo solo tiene validez para el día en curso; al día siguiente el vuelo vuelve a estar operativo.
   * *Impacto:* La restauración solo ocurría en tiempo real a las 00:00 UTC vía un `@Scheduled` de Spring. Si una simulación corría de forma rápida cubriendo 5 días simulados en 2 minutos reales, los vuelos cancelados el día 1 permanecían cancelados durante todos los días restantes.

3. **Falta de Trazabilidad Matemática del Micro-batching:**
   * *Diagnóstico:* El log de profiling no reportaba de manera explícita y estructurada las variables de tiempo y aceleración del sistema (`Ta`, `Sa`, `K`, `Sc`).

---

## 🛠️ 3. Soluciones e Implementaciones Realizadas

Para solucionar estas desviaciones, se diseñó e implementó un flujo **reactivo y síncrono** entre el backend y la base de datos de simulación:

### A. Replanificación Operativa Reactiva en SimulationService
* En cada uno de los 48 ciclos diarios (cada 30 minutos simulados), antes de planificar y avanzar el estado físico, la simulación inspecciona la base de datos buscando vuelos cancelados (`vueloRepo.findByCancelledTrue()`).
* Si detecta un vuelo recién cancelado:
  1. Registra un evento de alerta en el `Event Log` visible por el usuario en el frontend: `[HH:mm] 🚨 Vuelo X CANCELADO MANUALMENTE por el operario`.
  2. Filtra las rutas activas en la simulación que usaban ese vuelo y que aún no habían arribado (`arrivalTime > currentSimTime`).
  3. Cambia su estado a `"cancelled"`, libera la capacidad asignada y **re-encola las maletas afectadas** de vuelta al lote del ciclo actual (`lotsDelDia`) con prioridad máxima.
  4. En ese mismo ciclo, el planificador (ALNS o HGA) encuentra automáticamente rutas alternativas sin pasar por el vuelo cancelado, logrando rescatar los paquetes al instante.

### B. Restaurar Vuelos en Tiempo Simulado y Preservación de Pre-Cancelaciones
* Se agregó la invocación de `restaurarVuelosEnBD(List<Long> exceptIds)` en el ciclo de simulación:
  1. Al inicio de la simulación (`runFullSimulation`) para limpiar el estado de cancelaciones previas de pruebas, excepto aquellos IDs especificados por el operario como "pre-cancelaciones previas" antes de iniciar.
  2. Al inicio de cada día simulado (`day > 0`), asegurando que todos los vuelos vuelvan a estar disponibles para el nuevo día conforme a la regla del negocio, a excepción de los vuelos configurados para pre-cancelación multi-día.

### C. Logging del Profiler con Parámetros Teóricos de Tiempo
* Se refactorizó el log estructurado de profiling al final de cada ciclo para reportar:
  * `Ta` (Tiempo de ejecución del algoritmo / Planner time en ms).
  * `Sa` (Salto del algoritmo fijo a `30` minutos simulados).
  * `K` (Factor de aceleración calculado dinámicamente como `(Sa * 60000) / sleepPerCycleMs`).
  * `Sc` (Salto de consumo de tiempo simulado).

### D. Integración del Doble Panel en Operación Día a Día y Simulación de Periodo
* **Operación Día a Día (Panel Dual):**
  1. **Antes de Iniciar (Cancelaciones Previas):** Permite ingresar IDs de vuelos y visualizarlos como badges interactivos de pre-cancelación. Estos IDs son transmitidos como parámetro de consulta `preCancelledFlightIds` al endpoint `/api/v1/simulation/run/{dias}`.
  2. **Durante la Operación (Cancelaciones en Curso):** El panel dinámico `FlightCancellationPanel` permite cancelar vuelos en tiempo real, adaptando reactivamente el ruteo del micro-batching.
* **Simulación de Periodo (Cancelaciones Programadas):**
  1. Se agregó un panel de cancelaciones programadas en `PeriodSimConfig.jsx` que permite asociar un vuelo a un día específico (Día 1 a 5) o a todos los días ("Todos").
  2. El formato `flightId:day` (ej. `15:2`) es transmitido al backend, el cual lo procesa y aplica la cancelación únicamente al comenzar el ciclo del día indicado, restaurándolo en los demás días simulados.
* Se propagaron y unificaron los estados del frontend y del backend para que ambos escenarios soporten las pre-cancelaciones de forma íntegra.

### E. Inclusión de Cancelaciones en Reportes Ejecutivos (.md)
* Se integró una sección dedicada llamada `## ❌ Registro de Cancelaciones y Disrupciones de Vuelos` en el generador de reportes Markdown (`exportSimulationReportMd` en `useControlTowerController.js`).
* Esta sección extrae automáticamente todos los eventos del `eventLog` de la sesión (incluyendo pre-cancelaciones de simulación marcadas como `[Pre-sim]`) y los formatea en una tabla estructurada con su día, hora e ID.


---

## 📈 4. Estado de Verificación
* **Compilación:** `BUILD SUCCESS` obtenido tras limpiar y recompilar la suite completa del backend (`mvn clean compile`).
* **Frontend:**
  1. Se integró el menú interactivo dual de cancelaciones en `DayToDayConfig.jsx` (pestaña "Vuelos").
  2. Se verificó con un agente de pruebas la adición de vuelos pre-cancelados (captura de pantalla guardada exitosamente).
  3. Se corrigieron los mapeos en el controlador del backend (`SimulationController`) y el hilo principal de simulación (`SimulationService`) para procesar y preservar estas pre-cancelaciones a lo largo del transcurso multi-día.
  4. Se integró el registro detallado de estas pre-cancelaciones en los reportes Markdown generados.
