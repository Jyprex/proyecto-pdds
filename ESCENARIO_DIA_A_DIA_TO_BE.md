## Inicio del Escenario Día a Día

El usuario no selecciona una hora de inicio.

La simulación utiliza automáticamente la hora actual del servidor (GMT+0) como referencia temporal.

Ejemplo:

Hora actual del servidor:

17:15 UTC

La simulación debe reconstruir el estado de la red desde:

00:00 UTC
↓
17:15 UTC

---

## Fase 1: Bootstrap

Al iniciar el escenario, el backend ejecuta una reconstrucción acelerada de toda la operación ocurrida desde el inicio del día actual hasta la hora actual del servidor.

Características:

* Sin WebSockets.
* Sin snapshots visuales.
* Sin rendering.
* Sin delays artificiales.
* Máxima velocidad de ejecución.

Objetivo:

Reconstruir el estado operativo exacto de la red en el instante actual.

Ejemplo:

Servidor:

17:15 UTC

Bootstrap:

00:00 UTC → 17:15 UTC

---

## Snapshot Inicial

Al finalizar el bootstrap se genera un snapshot único correspondiente al instante actual del servidor.

Ejemplo:

Hora actual del servidor:

17:15 UTC

Primer snapshot visible:

17:15 UTC

El usuario visualiza directamente el estado operativo actual de la red.

No observa la evolución histórica desde las 00:00.

---

## Simulación Activa

Una vez mostrado el snapshot inicial, la simulación continúa desde la hora actual.

Ejemplo:

17:15 UTC
↓
17:30 UTC
↓
17:45 UTC
↓
18:00 UTC

Los snapshots posteriores representan la evolución futura de la operación.

---

## Principio de Diseño

La hora de referencia del escenario Día a Día siempre es la hora actual del servidor (GMT+0).

El usuario se conecta a una operación ya existente.

No inicia una simulación desde una hora arbitraria.
