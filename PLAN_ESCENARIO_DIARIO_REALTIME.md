# Planificación: Implementación de Escenario Día a Día Real-Time

Este documento detalla el plan de acción para transicionar el escenario "Día a Día" (En Vivo) a una ejecución en tiempo real (1:1) con una ventana de planificación de 30 minutos, manteniendo la integridad de la simulación de 5 días existente.

## 1. Objetivos
- **Real-Time (1:1):** 1 segundo simulado = 1 segundo real para el escenario diario.
- **Ventana de Planificación:** El algoritmo ALNS debe consumir lotes de envío en un horizonte de **30 minutos** (actualmente 4 horas) solo para el modo diario.
- **Integridad:** No alterar el comportamiento, velocidad o ventanas de la simulación de periodo (5 días).
- **Consistencia Visual:** La velocidad en el frontend debe reflejar el estado x1 para el modo diario.

## 2. Fase 1: Extensión del Backend (API y DTOs)

### 2.1. Modificación de `SimulationController.java`
Añadir nuevos parámetros opcionales a los endpoints de ejecución:
- `planningHorizon`: Ventana de tiempo para el algoritmo (minutos).
- `isRealTime`: Flag booleano para activar el modo 1:1.

### 2.2. Actualización de `SimulationService.java`
Refactorizar el método `runAsync` y `runFullSimulation` para aceptar estos nuevos parámetros.
- Guardar `planningHorizon` y `isRealTime` en el estado de la sesión (`SimulationSessionState`).

## 3. Fase 2: Adaptación del Motor de Simulación

### 3.1. Ajuste del Horizonte de Planificación
En `SimulationService.java`, reemplazar el valor hardcodeado de 240 minutos por el parámetro `planningHorizon` recibido.
```java
long horizonEnd = currentSimTime + ((long)planningHorizon * 60_000L);
List<SuperLot> nuevosLotes = superLotService.agruparEnviosPorVentana(currentSimTime, horizonEnd);
```

### 3.2. Lógica de Velocidad Real-Time (Throttling)
Modificar `computeSleepPerCycleMs` para manejar el modo real-time.
- Si `isRealTime` es true: `sleepPerCycleMs` debe ser exactamente `saMinutes * 60,000`.
- Esto asegura que un ciclo de 10 minutos (por ejemplo) tome 10 minutos reales.

### 3.3. Reconstrucción del Pasado (Fast-Forward Offline)
Para permitir iniciar la simulación en un momento específico del día (ej: 10:30 AM):
- El sistema utiliza el estado `RECONSTRUCTING`.
- Durante esta fase, el bucle de simulación omite el `Thread.sleep` y la publicación de snapshots de aviones, procesando solo la lógica de eventos y planificación ALNS de manera acelerada.
- Al alcanzar el `startCycle` objetivo, el estado cambia a `RUNNING` y comienza la publicación 1:1.
- Los vuelos en tránsito iniciados en el "pasado simulado" aparecerán en su posición correcta al llegar al tiempo real.

## 4. Fase 3: Integración Frontend

### 4.1. Hook `useControlTowerController.js`
- Actualizar `startDayToDaySimulation` para enviar `planningHorizon=30` e `isRealTime=true`.
- Asegurar que la lógica de interpolación suave (`baseRatio`) se calcule como 1 cuando se detecte el modo real-time, evitando desfases visuales.

### 4.2. Componente `DayToDayConfig.jsx`
- Asegurar que al presionar "Iniciar", se invoque la función con los nuevos parámetros de tiempo real.

## 5. Fase 4: Validación y Pruebas

### 5.1. Escenario Simulación (5 días)
- Verificar que sigue funcionando con playback acelerado (ej: 30 minutos de playback para 5 días de simulación).
- Confirmar que la ventana de planificación sigue siendo de 4 horas (default).

### 5.2. Escenario Día a Día
- Verificar que el reloj avanza segundo a segundo en sincronía con el tiempo real.
- Confirmar vía logs que el ALNS solo toma datos en ventanas de 30 minutos.
- Validar que la velocidad visual es x1.

## 6. Cronograma de Archivos a Modificar
1. `backend/.../web/SimulationController.java`
2. `backend/.../service/SimulationService.java`
3. `frontend/src/hooks/useControlTowerController.js`
4. `frontend/src/components/scenarios/DayToDayConfig.jsx`
