# Guion de Exposición — 27.dis.diag.clases.v01.md

---

## Objetivo

Este documento describe el modelo de clases del prototipo: qué piezas existen, cómo se relacionan entre sí y qué papel cumple cada una al momento de iniciar una simulación, calcular rutas de maletas y mostrar el avance en el mapa.

---

## TO-BE vs AS-IS

Al igual que en el documento de arquitectura, se trabaja con dos vistas. El **TO-BE** es el diseño formal del sistema —cómo se define el modelo a nivel de diseño—. El **AS-IS** es lo que realmente existe hoy en el código.

> "TO-BE es la arquitectura objetivo; AS-IS es el mapeo al repositorio para demostrar que esto no es teórico."

---

## Cómo Leer los Diagramas

Los diagramas usan flechas para mostrar cómo se relacionan las piezas del sistema. Antes de entrar a cada diagrama, conviene entender qué significa cada tipo de flecha.

`A --> B` significa que **A usa o llama a B**: A depende de B para funcionar. Por ejemplo, el controlador llama al servicio.

`A o-- B` significa que **A contiene una colección de B**: hay una relación de "uno contiene muchos". Por ejemplo, un almacén de sesiones contiene múltiples estados de simulación.

`X ..|> Y` significa que **X implementa el contrato definido por Y**: Y define el "qué debe hacer" y X define el "cómo lo hace".

Las etiquetas entre `<<` y `>>` —como `<<Service>>` o `<<RestController>>`— indican el **rol** de esa clase dentro del sistema: si atiende solicitudes web, si contiene lógica de negocio, si almacena datos, etc.

---

## Backend vs Frontend

Este documento cubre dos realidades distintas. En el **servidor (backend)**, el sistema sigue el paradigma orientado a objetos con clases y responsabilidades bien separadas. En la **interfaz web (frontend)**, el comportamiento no vive en clases tradicionales, sino en Hooks: fragmentos de código funcional que gestionan el estado de la pantalla. Por eso, en el frontend se documenta una jerarquía de dependencias de estado, no un diagrama de clases convencional.

---

## Backend — Clases Principales de Simulación

`SimulationSessionState` representa el estado de una simulación en curso: guarda el día actual, el porcentaje de avance, las rutas activas y los indicadores clave como el SLA.

`SimulationProgressHolder` es el almacén en memoria de esos estados, organizado por identificador de sesión. Permite consultar el avance de cualquier simulación activa sin necesidad de ir a la base de datos.

`SimulationService` ejecuta la lógica: inicia la simulación, llama al planificador día a día y va actualizando el estado en el almacén.

`SimulationV2Controller` es la puerta de salida hacia el navegador: lee el estado actual desde el almacén y lo envía como actualizaciones automáticas al mapa.

`HGAPlannerService` y `ALNSPlannerService` son los motores de planificación: el primero genera el plan de rutas base y el segundo lo repara cuando ocurre una cancelación.

---

## Frontend — Componentes Principales

`useControlTowerController.js` es el cerebro de la interfaz: establece y mantiene la conexión con el servidor para recibir actualizaciones automáticas, y va actualizando el estado del mapa y los indicadores en tiempo real.

`App.jsx` organiza la pantalla: ensambla los paneles, los escenarios y el mapa en una sola vista coherente.

`WorldMap.jsx` se encarga exclusivamente de dibujar: no toma decisiones, solo pinta el estado que recibe.

---

## Estados del Sistema

El diseño formal propone cuatro estados para cualquier proceso: `IDLE` (en espera), `RUNNING` (en ejecución), `DONE` (terminado) y `FAILED` (con error).

En el prototipo actual, la simulación del servidor solo modela tres de ellos: `RUNNING`, `DONE` y `FAILED`. El estado de reposo lo gestiona directamente la interfaz web. Para los experimentos numéricos y la exportación de resultados, sí existe el estado `IDLE` en el servidor.

> "Es una diferencia de modelado: en simulación el servidor solo modela ejecución y cierre; el estado de reposo lo maneja la interfaz."

---

## Diagrama 3.1 — Coordinación y Estado de Simulación

Este diagrama muestra cómo se conectan las piezas para ejecutar una simulación, mantener su avance y enviarlo al mapa.

Cuando el usuario inicia una simulación, el sistema genera un identificador de sesión único. `SimulationProgressHolder` crea y guarda una entrada `SimulationSessionState` para esa sesión —aquí se almacenará todo el avance durante la ejecución.

`SimulationService` corre en segundo plano: calcula el resultado día a día y va actualizando campos como el porcentaje de avance, el día actual, las rutas activas y la carga de cada aeropuerto.

`SimulationV2Controller` no calcula nada: solamente lee el estado actual desde el almacén en memoria y lo envía a la interfaz web.

**Relaciones clave:**
- `SimulationProgressHolder "1" o-- "*" SimulationSessionState`: un almacén puede contener muchas sesiones activas al mismo tiempo.
- `SimulationV2Controller --> SimulationProgressHolder`: el controlador depende del almacén para obtener el estado que va a enviar.
- `SimulationService --> SimulationRunner`: el servicio delega la ejecución al motor de simulación.

---

## Diagrama 3.2 — Dominio de Rutas y Eventos

Este diagrama muestra el resultado del planificador y cómo se simula la ejecución de esas rutas.

`Solution` es el resultado global del planificador: contiene todas las rutas calculadas.

Cada `Route` está asociada a un `SuperLot` —un grupo de maletas con el mismo origen, destino y plazo— y usa uno o más vuelos (`Vuelo`) para transportarlas hasta el destino.

La simulación genera `Event` por cada llegada o salida de vuelo, clasificados según su `EventType`.

`SimulationDayReport` consolida lo ocurrido en un día: rutas ejecutadas, nivel de saturación de aeropuertos y métricas de cumplimiento —cuántas maletas se entregaron a tiempo y cuántas quedaron pendientes.

**Relaciones clave:**
- `Solution "1" o-- "*" Route`: una solución agrupa varias rutas.
- `Route "1" o-- "1" SuperLot`: cada ruta atiende a un lote de maletas.
- `Route "1" o-- "*" Vuelo`: cada ruta usa uno o más vuelos para llegar al destino.
- `Vuelo "*" --> "1" Aeropuerto`: cada vuelo conecta dos aeropuertos —origen y destino.

---

## Diagrama 3.3 — Objetos de Comunicación al Mapa

Estos son los objetos que el servidor envía al navegador. No son entidades de negocio: son estructuras diseñadas exclusivamente para comunicar información al mapa de forma eficiente.

`SimulationMapSnapshotDTO` contiene lo visual del mapa en un instante dado: la lista de rutas activas y su progreso de vuelo.

`SimulationMapRouteDTO` describe una ruta individual: aeropuerto de origen, aeropuerto de destino, porcentaje de progreso y tiempos de salida y llegada.

`SimulationKpiSnapshotDTO` contiene los indicadores de rendimiento: SLA —porcentaje de maletas entregadas a tiempo—, ocupación promedio de vuelos, aeropuertos en situación crítica y carga por aeropuerto.

Se separan en dos objetos distintos porque el mapa puede tener muchas rutas activas a la vez y necesita actualizarse muy seguido, mientras que los indicadores son pocos datos. Enviarlos por separado reduce el tamaño de cada mensaje y hace que el mapa responda más rápido.

**Relación:**
- `SimulationMapSnapshotDTO "1" o-- "*" SimulationMapRouteDTO`: una "foto" del mapa contiene varias rutas activas.

---

## Diagrama 3.4 — Planificador y Replanificación

Este diagrama muestra las piezas que calculan las rutas de maletas y la capacidad de replanificar cuando un vuelo se cancela.

`PlanningController` es la puerta de entrada: expone las acciones disponibles —ejecutar HGA, ejecutar ALNS, replanificar ante una cancelación, y consultar la solución actual.

`PlanningService` coordina el proceso: recibe la orden y la delega al motor correspondiente según la situación.

`PlanningSessionHolder` guarda en memoria la última solución vigente, lista para ser consultada o modificada rápidamente sin ir a la base de datos.

`RouteBuilder` construye las rutas físicas consultando la red de vuelos disponibles a través de `NetworkAdapter`.

La diferencia entre los dos motores es clara: **HGA** genera el plan de rutas base al inicio, buscando la solución más eficiente dentro del tiempo disponible. **ALNS** entra cuando hay un cambio inesperado —como la cancelación de un vuelo— y repara el plan existente de forma rápida, reasignando las maletas afectadas.

**Relaciones clave:**
- `PlanningController --> PlanningService`: el controlador delega al servicio todo el trabajo.
- `PlanningService --> HGAPlannerService` y `PlanningService --> ALNSPlannerService`: el servicio elige qué motor usar según la situación.
- `PlanningService --> PlanningSessionHolder`: el servicio guarda y consulta la solución vigente en memoria.
- `NetworkAdapterImpl ..|> NetworkAdapter`: la implementación concreta cumple el contrato definido por la interfaz.

---

## Diagrama 3.5 — Experimentación Numérica y Exportación

Este diagrama muestra cómo se ejecutan los experimentos numéricos y cómo se produce el archivo Excel de resultados.

`NumericExperimentController` expone las acciones disponibles: iniciar un experimento, consultar su avance e iniciar la exportación de resultados.

`NumericExperimentService` administra una sesión de experimento con su propio progreso e indicadores de avance.

`ExcelExportService` administra la sesión de exportación y genera el archivo de forma asíncrona, sin bloquear al servidor mientras el proceso ocurre.

`ExperimentSessionStatus` define el ciclo de vida: en espera (`IDLE`), en ejecución (`RUNNING`), terminado (`DONE`) o con error (`FAILED`).

**Relaciones clave:**
- `NumericExperimentController --> NumericExperimentService` y `NumericExperimentController --> ExcelExportService`: el controlador coordina dos servicios distintos —uno para experimentos y otro para exportación.
- `ExperimentSession --> ExperimentSessionStatus`: cada sesión tiene un estado del ciclo de vida.

---

## Cierre

Este documento es el mapa técnico del sistema: muestra qué piezas existen, quién depende de quién y qué datos se envían a la interfaz. Con esto se entiende por qué el sistema puede ejecutar simulaciones en segundo plano, mostrar el avance en el mapa de forma automática y soportar tanto la planificación de rutas como los experimentos numéricos.
