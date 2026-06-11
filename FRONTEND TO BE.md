# FRONTEND TO-BE – Arquitectura de Reproducción de Simulación Logística

## Objetivo

Permitir que el backend ejecute la planificación logística tan rápido como sea posible mientras el frontend reproduce visualmente la simulación a una velocidad controlada e independiente.

La reproducción debe ser fluida, continua y desacoplada del ritmo de cálculo del backend.

---

# Problema Actual

Actualmente existe la tendencia a asociar:

* 1 snapshot recibido
* 1 actualización visual

Esto provoca que:

* Los aviones "salten" de posición.
* El movimiento no sea continuo.
* La velocidad visual dependa directamente de la velocidad de cálculo del backend.

Además, si el backend termina antes que el frontend, la animación deja de tener una referencia clara.

---

# Arquitectura Objetivo

La simulación se divide en dos procesos completamente independientes:

## Backend = Productor

Responsable de:

* Calcular planificación.
* Generar snapshots.
* Enviar snapshots mediante WebSocket.

Nunca se preocupa por:

* Animaciones.
* Renderizado.
* FPS.
* Movimiento visual.

Solo produce estados.

---

## Frontend = Consumidor

Responsable de:

* Recibir snapshots.
* Guardarlos en un buffer.
* Reproducirlos a velocidad constante.
* Generar animaciones suaves entre snapshots.

Nunca calcula planificación.

---

# Concepto Fundamental

El frontend NO muestra snapshots.

El frontend muestra interpolaciones entre snapshots.

---

# Ejemplo

Supongamos:

* Duración simulada = 1 día.
* Backend genera snapshots cada 30 minutos.

Entonces:

48 snapshots por día.

Snapshot 1:
08:00

Snapshot 2:
08:30

Snapshot 3:
09:00

etc.

El usuario jamás debe ver únicamente esos estados.

---

# Interpolación

Entre dos snapshots consecutivos:

Snapshot A
08:00

Snapshot B
08:30

El frontend genera cientos de frames intermedios.

Ejemplo:

08:01
08:02
08:03
...
08:29

aunque nunca hayan sido enviados por el backend.

---

# Movimiento de Aviones

Cada snapshot contiene:

* posición lógica
* aeropuerto origen
* aeropuerto destino
* progreso del vuelo

Ejemplo:

Snapshot A:

progress = 0.40

Snapshot B:

progress = 0.50

Durante la reproducción:

t = 0%
progress = 0.40

t = 50%
progress = 0.45

t = 100%
progress = 0.50

El avión se mueve continuamente.

No existen saltos visuales.

---

# Buffer de Snapshots

El frontend mantiene:

```text
snapshotBuffer
```

Ejemplo:

```text
[S1, S2, S3, S4, S5, ...]
```

Los snapshots se almacenan en orden temporal.

---

# Adelanto del Backend

Escenario:

Frontend mostrando:

```text
Snapshot 20
```

Backend calculando:

```text
Snapshot 40
```

Esto es deseable.

Significa que:

* el cálculo nunca bloquea la visualización;
* existe margen para absorber picos de latencia;
* el usuario observa una simulación estable.

---

# Estado Ideal del Buffer

Mantener siempre:

```text
5 a 20 snapshots
```

por delante del punto visual actual.

---

# Velocidad de Reproducción

Ejemplo:

Simulación:

5 días

Duración visual:

15 minutos

Entonces:

```text
7200 minutos simulados
```

deben mostrarse en:

```text
900 segundos reales
```

Ratio:

```text
8 minutos simulados
=
1 segundo real
```

El reloj del frontend avanza usando este ratio.

---

# Reloj Maestro del Frontend

El frontend mantiene:

```text
playbackTime
```

Este reloj:

* avanza con requestAnimationFrame;
* no depende de la llegada de snapshots;
* es la única referencia temporal para la UI.

---

# Selección de Snapshots

En cada frame:

Buscar:

```text
SnapshotAnterior
SnapshotSiguiente
```

tales que:

SnapshotAnterior.time <= playbackTime <= SnapshotSiguiente.time

---

# Factor de Interpolación

Calcular:

```text
alpha =
(playbackTime - t0)
/
(t1 - t0)
```

donde:

* t0 = tiempo del snapshot anterior
* t1 = tiempo del snapshot siguiente

Resultado:

```text
0 <= alpha <= 1
```

---

# Renderizado

Cada frame:

```text
estadoVisual =
lerp(
 SnapshotAnterior,
 SnapshotSiguiente,
 alpha
)
```

donde:

```text
lerp = interpolación lineal
```

---

# Fin de Simulación

El backend puede terminar mucho antes.

Cuando termina:

```text
backendFinished = true
```

pero el frontend continúa reproduciendo.

---

# Condición Real de Finalización

La simulación finaliza únicamente cuando:

```text
backendFinished
AND
buffer vacío
AND
playbackTime >= último snapshot
```

En ese momento:

```text
Estado = COMPLETED
```

---

# Ventajas

## Desacoplamiento

Backend y frontend trabajan independientemente.

---

## Fluidez

Los aviones se mueven continuamente.

---

## Escalabilidad

El backend puede calcular:

* 10× más rápido
* 100× más rápido
* 1000× más rápido

sin afectar la visualización.

---

## Robustez

Pequeñas pérdidas de paquetes o retrasos de red no afectan la experiencia.

---

# Implementación Recomendada

## Backend

Enviar snapshots cada:

```text
30 minutos simulados
```

o

```text
15 minutos simulados
```

No enviar más frecuencia.

---

## Frontend

Mantener:

```javascript
snapshotBuffer
playbackTime
backendFinished
```

y renderizar mediante:

```javascript
requestAnimationFrame()
```

interpolando siempre entre snapshots consecutivos.

---

# Regla Principal

Los snapshots son puntos de control.

No son frames.

Los frames son generados por el frontend mediante interpolación continua entre snapshots.
