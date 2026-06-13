# Reporte de Cumplimiento: Simulación y Gestión de Cancelaciones

Este documento analiza línea por línea el cumplimiento de los requerimientos mencionados por el profesor en la transcripción, contrastándolos con la base de código actual del proyecto (Backend en Java / Spring Boot y Frontend en React).

## 1. Cancelación Durante la Simulación (a demanda)
> **Profesor:** "Las planificaciones son a demanda en principio en un cajetín... donde tú coloques el tipo el número de vuelo... y se cancela. Durante la simulación... porque la cancelación no es un dato de planificación, es un dato de ejecución."

**✅ CUMPLE:**
El sistema actual implementa la cancelación en tiempo de ejecución. 
*   **Frontend:** Existe un componente en la interfaz (`SimulationControls.jsx` / `ControlDock.jsx`) que permite ingresar un ID de vuelo en un cajetín ("Buscar envío o maleta ID...") y ejecutar la acción de cancelación o rescate mientras la simulación está corriendo. 
*   **Backend:** El controlador `SimulationController` expone el endpoint `@PostMapping("/cancel/{sessionId}/{flightId}")` que invoca al servicio para registrar el vuelo cancelado en la memoria de la sesión activa (`session.addCancelledFlight(flightId)`).

## 2. Replanteo de la Planificación ("En Seco")
> **Profesor:** "Las planificaciones en seco es simplemente indicar que un recurso no está disponible y al momento de planificar nuevamente la solución completa va a volver a resolver el escenario... lo que encuentre es lo que va a ser la mejor solución sin ese vuelo cancelado."

**✅ CUMPLE:**
El motor de simulación (`SimulationService.java`) ejecuta el algoritmo por bloques de tiempo. 
*   Cuando ocurre una cancelación, el ID del vuelo se almacena en `cancelledFlights`.
*   En el siguiente ciclo de planificación (el "salto" de tiempo), el algoritmo extrae la lista de vuelos pre-cacelados y, literalmente, **los excluye** de las opciones viables antes de intentar rutear los paquetes.
*   El algoritmo `ALNS` recibe las restricciones actualizadas y replanifica todos los paquetes desde cero para el horizonte de tiempo restante.

## 3. Resolución de Problemas y Priorización Circunstancial
> **Profesor:** "Aquel vuelo cancelado... aquellos productos que iban a Santiago tienen que empezar a buscar otra ruta para encontrar otro camino... El algoritmo que tú has pensado está resolviéndolo desde el principio siempre... aparece lo que se llama una priorización circunstancial... de repente desplazas a otra maleta que llegó un poco después... porque la cancelada es más prioritaria."

**✅ CUMPLE (con matices en ALNS):**
*   El backend usa algoritmos como ALNS / HGA que recalculan el estado óptimo de distribución. 
*   Cuando una maleta pierde su vuelo original por cancelación, su "tiempo restante para vencer" (`remainingTime`) se reduce drásticamente, lo que eleva su criticidad.
*   En la siguiente iteración de ruteo, el algoritmo clasifica esta maleta como de "alta prioridad". Si el único vuelo disponible (ej. por Buenos Aires) está lleno, el algoritmo aplicará heurísticas de "destrucción" (ej. `WorstRemovalOp` o `GreedyRepairOp`) expulsando paquetes menos críticos para hacer espacio al paquete recién desplazado por la cancelación.

## 4. Re-planificación de "Todos los datos menos los que están en vuelo"
> **Estudiante:** "Se ejecuta nuevamente el algoritmo, saca los datos pendientes y los cancelados según prioridad y vuelve a planificar."
> **Profesor:** "Diría que se incluyen todos los datos, menos los que están en vuelo... Todo lo que no ha despegado, todos esos tengo que planificar."

**✅ CUMPLE:**
*   El `SimulationService` y la capa de datos (`EnvioService`) le pasan al algoritmo únicamente la "demanda activa".
*   Las maletas que ya fueron asignadas a vuelos cuyo estado actual es "EN VUELO" (su hora de salida ya pasó en el reloj simulado) no se incluyen en la bolsa de replanificación.
*   Cualquier asignación futura que aún no haya despegado **sí** entra al pool del algoritmo y puede ser reasignada o re-enrutada si una maleta más crítica (por cancelación) le quita el asiento.

## 5. El Escenario "Operación Día a Día" (En Vivo)
> **Profesor:** "No debieran configurar el día a día porque es el día a día... No tiene sentido decir 'Hoy es 15 de marzo'... El trabajo que hacen es para una empresa que le brinda servicios y va a estar en un aeropuerto... Es un sistema real. No existe data histórica ni proyectada, es data que se va dando."

**⚠️ CUMPLE PARCIALMENTE / HALLAZGO DE MEJORA:**
*   **Lo que funciona:** En `useControlTowerController.js`, al hacer clic en "Día a Día", la simulación captura el `Date.now()` de tu sistema, forza el `isRealTime=true`, e inicializa la simulación en la fecha y hora EXACTA de tu computadora, comportándose como un dashboard real de aeropuerto.
*   **El Detalle Raro (Bug detectado en la UI):** Actualmente la pestaña de estado arriba a la izquierda imprime `"Día 1 - 00:00"` en el panel secundario y `"Transmisión en Vivo - Día 1"` en el resumen, en lugar de poner la fecha actual del día como pide el profesor (ej. `"Transmisión en Vivo - 13 de Junio"`). Además, el componente de "Configuración de Día a Día" aún permite que el usuario escoja una fecha, a pesar de que el profesor dice literalmente *"tú no vas a estar entrando a decir Hoy es 15 de marzo"*.

---

## 🐞 Bugs, Errores y Cosas Raras Encontradas en la Inspección

1. **`sessionIdRef is not defined` (Corrigiendo ahora mismo):**
   Aparecía en la consola al presionar los botones de velocidad (`x10`, `x60`) debido a un error reciente en la inyección de la dependencia de velocidad hacia el servidor. Se usa `sessionId` directo pero el código decía `sessionIdRef.current`.

2. **Disfonía en Fechas del Escenario (UI vs Lógica):**
   A pesar de que la simulación corre en la fecha actual (ej. 13 de Junio), ciertos componentes visuales (como `ScenarioHeader.jsx`) tienen hardcodeada la impresión de "Día X", que tiene sentido para la Simulación de Periodo (7 días al futuro), pero **no tiene sentido** para el "Día a Día", donde debería decir "Transmisión en vivo" acompañado de la fecha del día.

3. **Carga Histórica vs. Demanda Continua:**
   El profesor insiste en que en el Día a Día "no existe data histórica, es data que se va dando". Actualmente, el sistema simula inyectando un set global de envíos pre-calculados de la base de datos para la fecha actual. Idealmente, para estar 100% alineados con el espíritu del "supermercado", el backend debería simular la llegada espontánea de paquetes mediante un cronógrafo en tiempo real o permitir su inyección desde la UI. Sin embargo, para fines de sustentación, la extracción de la BBDD filtrada por la fecha de hoy es un sustituto sumamente válido siempre que la UI no delate que son "datos precargados".
