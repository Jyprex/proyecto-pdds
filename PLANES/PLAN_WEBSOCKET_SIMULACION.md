# Plan: Simulacion Dia-a-Dia con WebSocket (Escalable)

Contexto del repo (verificado):

1. Frontend: el mapa es SVG (react-simple-maps) en `frontend/src/components/map/WorldMap.jsx` y los aviones se dibujan como elementos SVG posicionados con `plane.progress`.
1. Backend: la simulacion ya corre async (`@Async("simulationExecutor")` en `SimulationService`) y existe streaming SSE en `backend/src/main/java/com/tasfb2b/planificador/web/SimulationV2Controller.java`.

Objetivo:

1. Migrar el streaming de estado (snapshot/KPIs/eventLog) de SSE a WebSocket.
1. Mantener el patrón no-bloqueante: `POST /api/v1/simulation/run/{dias}` responde 202 inmediato con `sessionId`.
1. Asegurar que 5 dias simulados se puedan reproducir/visualizar durante 30 a 90 min (pacing de playback), sin esperar a que termine el algoritmo para renderizar.
1. Diseñar para escalar: multiples sesiones concurrentes, multiples clientes mirando una sesion, control de frecuencia y backpressure.

## 1) Arquitectura propuesta

Piezas:

1. Motor de simulacion (ya existe): `SimulationService` actualiza `SimulationProgressHolder` continuamente mientras corre.
1. Canal de streaming: WebSocket + STOMP.
1. Control: REST (start/pause/resume/speed) y opcionalmente comandos via WS (no requerido para primera migracion).

Data flow:

1. Front llama `POST /api/v1/simulation/run/{dias}` -> recibe `sessionId`.
1. Front abre WS a `/ws` y se suscribe a topics por sesion:
1. `/topic/sim/{sessionId}/snapshot`
1. `/topic/sim/{sessionId}/kpi`
1. `/topic/sim/{sessionId}/eventLog`
1. Backend publica periodicamente el estado de `SimulationProgressHolder` hacia esos topics.

## 2) Backend: agregar WebSocket (STOMP)

Cambios:

1. Dependencia Maven: agregar `spring-boot-starter-websocket`.
1. Configuracion:
1. `@EnableWebSocketMessageBroker`
1. Endpoint STOMP: `/ws` con SockJS habilitado (para compatibilidad y dev) o sin SockJS (si solo browsers modernos).
1. Broker simple: destinos `/topic/**`.
1. Prefijos app (si luego se agregan comandos): `/app/**`.

Seguridad/CORS:

1. Para el handshake WS, permitir origin del frontend (se reusa `app.cors.allowed-origins`).
1. Mantener `.csrf().disable()` como ya esta.

## 3) Backend: servicio de broadcasting

Implementacion recomendada:

1. Crear un `SimulationWsPublisher` que use `SimpMessagingTemplate`.
1. Publicar snapshots a una frecuencia controlada (configurable):
1. `tasf.sim.stream.intervalMs` (ej. 500ms a 2000ms).
1. Incluir `seq` incremental por sesion para orden y debugging.
1. Leer datos desde `SimulationProgressHolder` (sin bloquear el motor).

Modelo de mensajes:

1. `SimulationMapSnapshotDTO` (ya existe) para el mapa.
1. `SimulationKpiSnapshotDTO` (ya existe) para KPI.
1. `eventLog` como string (ya existe).
1. Enviar `snapshotEpochTime` (ya existe en SSE) para interpolacion en front.

Nota de escalabilidad:

1. Evitar un thread por cliente (problema tipico de SSE).
1. En WS se publica a un topic y el broker entrega a N subscribers.
1. Mantener limites: `limit` de rutas del mapa (ya existe) y throttling.

## 4) Playback 5 dias en 30-90 minutos (pacing)

Estado actual (verificado): en `SimulationService` hay loop hora-a-hora con `Thread.sleep(250)` y `progress = hour / 24.0`.

Plan de mejora:

1. Introducir una configuracion `tasf.sim.playback.targetMinutes` (30..90).
1. Calcular `msPerSimHour = (targetMinutes * 60_000) / (dias * 24)`.
1. Dormir `msPerSimHour` en vez de un fijo.
1. Calcular `progress` por vuelo usando `currentEpochTime` vs `departureTime/arrivalTime` (si `arrivalTime` esta presente).
1. Si el algoritmo tarda mas que el pacing, el playback real sera mayor; pero el front seguira recibiendo actualizaciones incrementales.

## 5) Frontend: migracion de SSE a WebSocket

Cambios:

1. Agregar deps: `@stomp/stompjs` y `sockjs-client`.
1. Reemplazar `EventSource` en `useControlTowerController.js` por un cliente STOMP.
1. Suscribirse a los topics de sesion y actualizar `liveStatus` igual que hoy:
1. snapshot -> `activeRoutes`, `simulatedTime`, `currentEpochTime`.
1. kpi -> percent, SLA, occupancy, etc.
1. eventLog -> append incremental.

Compatibilidad:

1. Mantener SSE temporalmente (feature flag) para rollback.
1. Cuando WS este estable, deprecar `/api/v2/simulation/stream/{sessionId}`.

## 6) Plan de escalado (pasar de 1 sesion/1 cliente a N)

1. Topics por sesion (aislamiento): `/topic/sim/{sessionId}/...`.
1. Limitar frecuencia de mensajes en backend (intervalMs) y rutas (limit).
1. Deduplicar payload (opcional): enviar solo diffs o comprimir (solo si hace falta).
1. Observabilidad:
1. logs con `sessionId` y `seq`.
1. metricas: mensajes/seg por sesion, subscripciones activas.
1. Limpieza: cuando `status != RUNNING`, dejar de publicar y permitir `progressHolder.remove(sessionId)` bajo politica TTL.

## 7) Entregables por iteracion

1. Iteracion 1: WS conectado, front recibe `kpi` y `snapshot` y el mapa muestra aviones moviendose.
1. Iteracion 2: pacing 30-90 min y progreso por vuelo realista.
1. Iteracion 3: comandos (pause/resume/speed) y hardening (limites, TTL, errores).
