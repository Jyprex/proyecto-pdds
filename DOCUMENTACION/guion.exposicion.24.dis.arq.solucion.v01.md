# Guion de Exposición — 24.dis.arq.solucion.v01.md

---

## Objetivo

Este documento describe cómo está organizado el sistema de Tasf.B2B: qué partes lo componen, cómo se comunican entre sí y por qué se tomaron ciertas decisiones de diseño. Para ello se distingue entre dos vistas: **TO-BE**, que es el diseño objetivo —el plano del sistema tal como lo definimos—, y **AS-IS**, que es lo que existe hoy en el prototipo funcional.

---

## Convención TO-BE vs AS-IS

Este documento se lee en dos capas. La primera es el **TO-BE**: la arquitectura objetivo que formaliza la solución, el "deber ser" del sistema. La segunda es el **AS-IS**: el mapeo al prototipo real, lo que ya existe en el código y funciona hoy.

> "TO-BE define el destino; AS-IS demuestra que ya existe una base funcional y medible."

---

## Arquitectura General

El sistema combina cuatro elementos principales:

Primero, llamadas HTTP estándar para acciones puntuales: iniciar una simulación, consultar resultados o descargar el reporte en Excel.

Segundo, una conexión persistente del servidor hacia el navegador, para que el mapa se actualice de forma automática sin que el usuario tenga que recargar la página.

Tercero, el planificador de rutas corre dentro del mismo servidor —no en un servicio externo— para no perder tiempo enviando grandes volúmenes de datos a través de la red.

Cuarto, durante la simulación se usa un almacenamiento temporal en memoria, para no saturar la base de datos con escrituras continuas mientras todo está en marcha.

---

## TO-BE — Capas del Sistema

El sistema se organiza en cuatro capas bien definidas.

La **capa de Presentación** es la interfaz web tipo Torre de Control que ve el operador, construida con React y Vite.

La **capa de Aplicación** es el servidor que recibe las órdenes, coordina la lógica y gestiona la comunicación con el navegador, implementada con Spring Boot.

La **capa de Planificación** contiene los motores que calculan y reparan las rutas de maletas: el HGA, que genera el plan inicial, y el ALNS, que lo repara ante cancelaciones.

La **capa de Datos** es donde se persisten aeropuertos, vuelos y envíos, usando una base de datos relacional con Spring Data JPA.

> "La arquitectura es intencionalmente pragmática: el planificador vive dentro del mismo servidor porque mover miles de rutas a través de la red sería muy costoso en tiempo."

---

## AS-IS — Backend en Capas Real

El backend del prototipo sigue cuatro bloques bien diferenciados.

Los **Controladores** son la puerta de entrada del sistema. Reciben las solicitudes del navegador pero no hacen ningún cálculo. Por ejemplo, `SimulationV2Controller` recibe la solicitud de inicio y abre el canal para enviar actualizaciones automáticas al mapa.

Los **Servicios** contienen la lógica de negocio y toman las decisiones. `SimulationService`, por ejemplo, decide cuándo correr HGA o ALNS y va actualizando el estado de la simulación día a día.

Los **Almacenes en memoria** —los Session Holders— guardan el estado de cada simulación activa de forma rápida, sin necesidad de consultar la base de datos. `SimulationProgressHolder` almacena el avance, las rutas activas y las métricas de cada sesión en curso.

Los **Repositorios** son la conexión a la base de datos. Se usan para cargar los datos al inicio y guardar los resultados al final de la simulación.

> "Gracias a este diseño, la simulación puede escribir rápido y el mapa puede leer rápido sin bloquearse mutuamente."

---

## Comunicación — Cómo se comunican las partes

Existen tres canales de comunicación en el sistema.

El primero va del **navegador al servidor**, usando HTTP estándar, para dar órdenes: iniciar la simulación, consultar el estado o descargar el reporte Excel.

El segundo va del **servidor al navegador** a través de una conexión persistente. El servidor envía actualizaciones continuas —rutas activas, indicadores y bitácora de eventos— sin que el usuario tenga que pedir nada. El mapa simplemente se actualiza solo.

El tercero es una **llamada directa en memoria** entre los servicios del servidor y el planificador. No pasa por la red, lo que elimina cualquier demora innecesaria durante el cálculo de rutas.

> "El mapa no se actualiza porque el usuario recarga la página; se actualiza porque el servidor le avisa de forma automática y continua."

---

## Decisiones Arquitectónicas

Se tomaron tres decisiones clave durante el diseño.

La primera fue usar una conexión persistente del servidor hacia el navegador para actualizar el mapa, porque actualizar el mapa con solicitudes repetidas del navegador saturaba la conexión y generaba una experiencia lenta e inestable.

La segunda fue mantener el planificador dentro del mismo servidor, para evitar el costo de transferir miles de estructuras de rutas a través de la red hacia un servicio externo.

La tercera fue generar el reporte Excel al final de la simulación, y no durante su ejecución, para no consumir memoria adicional mientras todo el sistema está trabajando.

---

## Implementación Actual (AS-IS)

En el prototipo hoy:

La base de datos utilizada es H2, una base de datos ligera que vive dentro del mismo servidor —ideal para un prototipo funcional.

La simulación corre en un hilo separado del servidor, de modo que no bloquea la atención de otras solicitudes mientras está en marcha.

El componente `SseEmitter` mantiene abierta la conexión con el navegador y envía periódicamente eventos del tipo `snapshot`, `kpi` y `eventLog` para mantener el mapa actualizado.

El almacén de estado `SimulationProgressHolder` guarda el avance por sesión, y `PlanningSessionHolder` conserva la solución vigente del planificador.

---

## Cierre

Este documento responde al "¿dónde vive cada responsabilidad?" y al "¿cómo fluye la información?". El siguiente documento —el número 27— baja al nivel de clases y muestra el diagrama que soporta este flujo.
