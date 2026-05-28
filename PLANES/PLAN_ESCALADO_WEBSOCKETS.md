# Plan: Escalado y hardening del streaming por WebSocket

Este plan asume que ya existe:

1. WS STOMP endpoint `/ws`.
1. Topics por sesion `/topic/sim/{sessionId}/...`.
1. Simulacion corre async y actualiza `SimulationProgressHolder`.

## 1) Objetivos de escalabilidad

1. Soportar N sesiones concurrentes sin degradar el backend.
1. Soportar M clientes mirando una sesion (broadcast eficiente).
1. Controlar frecuencia y tamaño de payload para evitar saturacion.
1. Evitar fugas de memoria (sesiones terminadas) y fugas de threads.

## 2) Publicacion eficiente (backend)

1. Publicar por sesion solo si hay subscribers (fase 2):
1. Implementar `ApplicationListener<SessionSubscribeEvent>` y contar subs por topic.
1. Si subs=0, no publicar para esa sesion.
1. Mantener un TTL para reactivar si vuelve un subscriber.

1. Throttling por sesion:
1. `tasf.sim.stream.intervalMs` global y override por sesion (opcional).
1. No enviar mas de X mensajes/seg por sesion.

1. Payload bounds:
1. `tasf.sim.stream.routeLimit` para mapa.
1. Enviar `activeRoutes` como DTO (ya existe) y evitar Maps crudos.
1. (Si crece) enviar diffs por ruta: solo cambios de progress/status.

## 3) Broker y topologia (cuando crezca)

Fase 1 (simple broker):

1. `enableSimpleBroker("/topic")` es suficiente para dev y cargas moderadas.

Fase 2 (produccion / alto volumen):

1. Migrar a broker externo (RabbitMQ STOMP o ActiveMQ Artemis) con `enableStompBrokerRelay`.
1. Beneficios:
1. Backpressure real.
1. Escalar horizontalmente instancias de backend.
1. Persistencia/monitor de colas.

## 4) Multi-instancia (horizontal scaling)

Problema: con multiples instancias, el publisher necesita estado compartido.

Opciones:

1. Externalizar el publisher:
1. El motor de simulacion publica eventos a un bus (Kafka/Rabbit).
1. Un servicio de streaming consume y emite por WS.

1. Mantener motor en 1 instancia (sticky sessions):
1. Load balancer con sticky para `/ws`.
1. Simulacion/holder viven en la misma instancia.
1. Limite: no escala bien si sesiones crecen.

Recomendacion: si esperan volumen, ir a broker relay + bus de eventos.

## 5) Gestion de sesiones y memoria

1. TTL para sesiones terminadas:
1. Guardar `endedAtEpochMs` en `SimulationSessionState` (fase 2).
1. Scheduler de limpieza: borrar del holder despues de N minutos.
1. Si un cliente pide status final, usar REST antes de borrar o persistir resumen.

1. EventLog:
1. Limitar tamaño (ej. max 5k lineas) para evitar crecer indefinido.
1. Si se requiere auditoria, persistir logs en disco/DB.

## 6) Resiliencia del cliente (frontend)

1. Reconnect:
1. STOMP client con `reconnectDelay` (ya).
1. Al reconectar, hacer un `GET /api/v1/simulation/status/{sessionId}` para resincronizar.

1. Orden:
1. Usar `seq` del envelope para descartar mensajes viejos si hiciera falta.

## 7) Observabilidad

1. Log con `sessionId` y rate de publicacion.
1. Metric (Micrometer si lo agregan): subs por topic, msg/seg, bytes/seg.
