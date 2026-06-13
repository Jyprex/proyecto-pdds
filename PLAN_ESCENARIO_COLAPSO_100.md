# Planificación: Implementación de Escenario de Colapso 100%

Este documento detalla el plan de acción para potenciar el escenario de "Colapso", asegurando una ventana de planificación de 24 horas, velocidad dinámica (meta 1 min/día) y terminación estricta por saturación o incumplimiento.

## 1. Objetivos
- **Ventana de 24 Horas:** El algoritmo ALNS debe consumir lotes de envío en un horizonte de **1440 minutos** exclusivamente para el modo colapso.
- **Velocidad Dinámica:** Meta de 1 minuto real por 1 día simulado. El sistema debe ralentizarse automáticamente si el algoritmo excede el tiempo presupuestado (Control de Drift).
- **Terminación Estricta:** La simulación finaliza inmediatamente si:
    - Se excede la capacidad de cualquier almacén/aeropuerto.
    - Se incumple la entrega de una maleta (SLA < 100% o Ecap > 0).
- **Reporte de Colapso:** Al finalizar, mostrar la razón técnica, el día exacto y la última planificación realizada.

## 2. Fase 1: Backend - Lógica de Terminación y Horizonte

### 2.1. Ajuste de Horizonte en `SimulationController.java`
Modificar el endpoint `/run-collapse/{dias}` para pasar `planningHorizon = 1440` (24 horas) al servicio.

### 2.2. Nuevas Condiciones en `CollapseEndCondition.java` y `CollapseHelper.java`
- Añadir `FAILED_DELIVERY` como condición.
- Refactorizar `checkEndCondition` para que sea más estricto:
    - Retornar `terminated = true` si hay maletas no atendidas en el reporte diario.
    - Retornar `terminated = true` si `endOfDayState.isColapsado()` es verdadero.

### 2.3. Ejecución de Larga Duración en `SimulationService.java`
- Permitir que el bucle `while` en modo colapso use un límite de días muy alto (ej: 90 días) para que solo termine por la condición de colapso real.

## 3. Fase 2: Backend - Velocidad Dinámica

### 3.1. Cálculo de Sleep para 1 min/día
En `SimulationService.java`, ajustar el cálculo de `playbackMinutes` para que en modo colapso se ignore el valor del frontend y se use `playbackMinutes = totalDays` (lo que resulta en 1 min por día).

### 3.2. Refuerzo del Control de Drift
Asegurar que `adjustedSleep` maneje correctamente casos donde el ALNS toma más de 500ms, eliminando el sleep del micro-step si es necesario para intentar recuperar el tiempo.

## 4. Fase 3: Frontend - Disparo y Reporte

### 4.1. `useControlTowerController.js`
- Actualizar `startCollapseSimulation` para no enviar una hora de inicio manual (usar 00:00:00 por defecto).
- Asegurar que `targetPlaybackMinutes` se sincronice con el número de días para la meta de 1min/día.

### 4.2. Visualización de Resultados
- Modificar el panel de resultados para que, si `isCollapseMode` es true, destaque la **Razón de Colapso** y permita ver el "Último Plan Maestro" generado antes del fallo.

## 5. Fase 4: Validación

### 5.1. Prueba de Estrés
- Ejecutar colapso con factor ×10 y verificar que termina rápidamente (ej: Día 1 o 2).
- Verificar que el reporte indica "Capacidad excedida".

### 5.2. Prueba de Horizonte
- Validar vía logs que el ALNS recibe datos de las próximas 24 horas en cada ciclo de planificación.
