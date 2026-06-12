# Registros de Planificación: Arquitectura de Horizonte de 4 Horas

Este documento registra los cambios realizados para implementar el horizonte móvil de 4 horas y la re-planificación global en el sistema TASF.B2B.

## Estado de Implementación

### Fase 1: Reestructuración del Estado del Planificador (COMPLETADO)
- [x] Redefinición del Pool de Envíos en `SimulationService` (`planifiablePool`).
- [x] Protección de rutas en vuelo en `ALNSPlannerService` y Operadores `Destroy`.
- [x] Ajuste de tiempos de cómputo del ALNS (3000ms ventana).

### Fase 2: Horizonte Móvil y Disparadores (COMPLETADO)
- [x] Implementación de ventana dinámica de 240 minutos (Horizonte Móvil).
- [x] Integración de re-planificación global en cada ciclo de simulación.

### Fase 4: Adaptación del Visualizador (COMPLETADO)
- [x] Gestión de plan maestro en el frontend (`masterPlan` state).
- [x] Sincronización por versiones de plan mediante `planId`.
- [x] Visualización de "Rutas Sombra" (Shadow Routes): Proyecciones punteadas que muestran las próximas 4 horas de operación planificada, actualizándose dinámicamente ante re-planificaciones.

---

## Cambios Técnicos Detallados

### Backend
1.  **Solution.java**: Agregado `planId` (UUID) para identificar cada ejecución del ALNS.
2.  **SimulationProgressHolder.java**:
    *   `WsFrame` ahora incluye `planId` y `plannedRoutes`.
    *   `SimulationSessionState` persiste el `currentPlanId`.
3.  **SimulationMapSnapshotDTO.java**: Agregados campos `planId` y `masterPlan`.
4.  **SimulationWsPublisher.java**: Adaptado para leer y publicar el `planId` y el `masterPlan` en el tópico de snapshot.
5.  **SimulationService.java**:
    *   Mantiene la referencia al `masterPlan` (List<Route>) generado en cada ciclo.
    *   `updateProgress` transforma el plan maestro a un formato ligero para el frontend.
    *   Se sincroniza el envío del `planId` en cada micro-step de la simulación.
    *   Implementado Pool Global de Planificación para re-evaluación de envíos en almacén.
    *   Horizonte móvil aumentado a **240 minutos (4 horas)**.

### Frontend
1.  **useControlTowerController.js**: 
    *   Nuevo estado `masterPlan` para almacenar la visión de largo plazo.
    *   Lógica de sincronización reactiva: detecta cambios en `planId` del WebSocket y actualiza el plan maestro sin interrumpir la fluidez visual.
2.  **App.jsx**: Orquestación del flujo de datos del plan maestro hacia los componentes visuales.
3.  **WorldMap.jsx**:
    *   Implementación de capas visuales para el horizonte futuro.
    *   Renderizado de líneas discontinuas sutiles para tramos planificados que aún no han despegado, brindando una visión predictiva de la red.
