# SYSTEM CONTEXT — Tasf.B2B Luggage Management System

> **Propósito de este documento:**
> Este archivo centraliza las restricciones, datos clave y reglas de negocio del sistema a desarrollar para la empresa **Tasf.B2B**. Está diseñado para ser incluido como **contexto base en cualquier prompt** enviado a una IA generativa, garantizando que el modelo comprenda el dominio, los límites del sistema y los requerimientos académicos del proyecto antes de generar cualquier respuesta, código o diseño.

---

## 1. DESCRIPCIÓN GENERAL DEL SISTEMA

**Nombre del cliente:** Tasf.B2B
**Dominio:** Transporte aéreo de equipaje extraviado entre aerolíneas.
**Alcance geográfico:** Aeropuertos de América, Asia y Europa (un único aeropuerto por ciudad).
**Usuarios del sistema:** Aerolíneas (clientes) que envían/reciben maletas directamente en las oficinas de Tasf.B2B ubicadas en aeropuertos.

El sistema a desarrollar es una solución informática con tres componentes principales:

| #   | Componente       | Descripción                                                                                                                                                           |
| --- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Registro**     | Registrar la cantidad de maletas a ser enviadas.                                                                                                                      |
| 2   | **Planificador** | Planificar y replanificar rutas de maletas, respetando plazos de entrega (SLA) ante cancelaciones de vuelos. Implementado con dos algoritmos metaheurísticos en Java. |
| 3   | **Visualizador** | Mapa interactivo en tiempo real del monitoreo de operaciones. Accesible desde cualquier dispositivo, con múltiples zonas de interacción simultáneas.                  |

---

## 2. ENTIDADES Y CONCEPTOS CLAVE

- **Maleta:** Unidad estándar de equipaje (peso y medidas estandarizados). No hay diferenciación de tipo.
- **Aeropuerto:** Punto de origen o destino. Una ciudad = un aeropuerto.
- **Vuelo:** Medio de traslado de maletas entre aeropuertos. Puede ser intra-continental o inter-continental.
- **Ruta:** Plan de viaje asignado a una maleta o grupo de maletas. Generado por el planificador.
- **Almacén:** Depósito de maletas en cada aeropuerto. Tiene capacidad limitada.
- **Reporte de monitoreo:** Documento que indica la ubicación actual de la maleta según su plan de viaje. Se actualiza manualmente al llegar a cada aeropuerto.

---

## 3. RESTRICCIONES DE NEGOCIO (SLA / PLAZOS DE ENTREGA)

Estas son las reglas más críticas del sistema. El planificador **debe respetarlas obligatoriamente**:

| Tipo de ruta        | Plazo máximo de entrega (SLA) | Tiempo de traslado estimado |
| ------------------- | ----------------------------- | --------------------------- |
| Mismo continente    | **1 día**                     | Medio día (0.5 días)        |
| Distinto continente | **2 días**                    | 1 día completo              |

> ⚠️ **Regla crítica:** El tiempo de traslado ya consumido debe restarse del SLA disponible al momento de planificar o replanificar. Un vuelo cancelado que genera replanificación debe ajustar el SLA de los paquetes pendientes a la nueva hora de disponibilidad (ready time), no extenderlo.

---

## 4. RESTRICCIONES DE CAPACIDAD

### 4.1 Capacidad de vuelos

| Tipo de vuelo       | Capacidad de maletas                  |
| ------------------- | ------------------------------------- |
| Mismo continente    | Entre **150 y 250** maletas por vuelo |
| Distinto continente | Entre **150 y 400** maletas por vuelo |

### 4.2 Frecuencia de vuelos

| Tipo de vuelo       | Frecuencia                                                            |
| ------------------- | --------------------------------------------------------------------- |
| Mismo continente    | **Una o más veces al día**                                            |
| Distinto continente | **Al menos una vez al día** (no garantizado entre todas las ciudades) |

### 4.3 Capacidad de almacenes (por aeropuerto)

| Capacidad mínima | Capacidad máxima |
| ---------------- | ---------------- |
| **500 maletas**  | **800 maletas**  |

> ⚠️ El sistema debe prevenir el **colapso de almacenes**. Si un almacén supera su capacidad, se considera un evento de colapso operacional.

---

## 5. ESCENARIOS DE SIMULACIÓN

El sistema debe soportar **tres escenarios de simulación** configurables mediante parámetros:

| #   | Escenario                    | Descripción                                                                                                        |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | **Operaciones día a día**    | Simulación en tiempo real de las operaciones.                                                                      |
| 2   | **Simulación de periodo**    | Simulación de 5 dias. **Duración de ejecución: entre 30 y 90 minutos.** Este es el primer escenario en resolverse. |
| 3   | **Simulación hasta colapso** | Simulación continua hasta que las operaciones de Tasf.B2B colapsen.                                                |

> ⚠️ El planificador debe poder resolver los 3 escenarios configurando parámetros, sin cambiar la lógica base del sistema.
> ⚠️ El visualizador debe presentar información de desempeño relevante para los 3 escenarios.

---

## 6. REQUERIMIENTOS DE CALIDAD (QUALITY REQUIREMENTS)

Estos son los requerimientos académicos y técnicos no funcionales del proyecto:

1. **Dos algoritmos metaheurísticos** implementados en Java para el componente planificador.
   - Ambos deben ser evaluados mediante **experimentación numérica** (comparativa de desempeño).
   - Los algoritmos compiten entre sí para demostrar cuál resuelve mejor el problema.

2. **Semáforo de colores** (verde / ámbar / rojo) en todas las visualizaciones que lo requieran.
   - Los rangos de cada color deben ser **configurables como parámetros** del sistema.

3. **Proceso de desarrollo** evaluado con la norma **NTP-ISO/IEC 29110-5-1-2 (VSE)**.
   - El proceso seguido importa tanto como el producto final.

---

## 7. SERVICIOS ENTREGABLES AL CLIENTE (POR CADA ENVÍO)

Por cada maleta o grupo de maletas gestionado, el sistema debe generar:

- **Plan de viaje:** Ruta asignada (aeropuertos intermedios, vuelos, tiempos estimados).
- **Reporte de monitoreo:** Estado actual de la maleta (ciudad, aeropuerto, estado del viaje). Se actualiza al llegar a cada nodo de la ruta.

---

## 8. RESTRICCIONES ARQUITECTÓNICAS Y TÉCNICAS

Derivadas del contexto académico y decisiones de diseño del proyecto:

- Lenguaje de implementación del planificador: **Java**.
- Visualizador: Accesible desde **cualquier dispositivo** (cliente web), en **tiempo real**.
- Los datos de experimentación numérica deben ser **reproducibles** (uso de semillas o condiciones controladas).
- El sistema de cancelación de vuelos debe distinguir entre:
  - **Cancelaciones operacionales** (durante simulación normal).
  - **Modo colapso** (cuando el sistema llega al límite de capacidad).

---

## 9. DATOS NUMÉRICOS DE REFERENCIA RÁPIDA

| Parámetro                         | Valor                     |
| --------------------------------- | ------------------------- |
| SLA mismo continente              | 1 día                     |
| SLA distinto continente           | 2 días                    |
| Tiempo traslado intra-continental | 0.5 días                  |
| Tiempo traslado inter-continental | 1 día                     |
| Cap. vuelo intra-continental      | 150 – 250 maletas         |
| Cap. vuelo inter-continental      | 150 – 400 maletas         |
| Cap. almacén por aeropuerto       | 500 – 800 maletas         |
| Duración simulación de periodo    | 30 – 90 minutos           |
| Algoritmos del planificador       | 2 (metaheurísticos, Java) |
| Número de continentes cubiertos   | 3 (América, Asia, Europa) |

---

## 10. INSTRUCCIONES DE USO PARA PROMPTS

Al usar este documento como contexto en un prompt de IA generativa, se recomienda:

1. **Incluir este archivo completo al inicio del prompt**, antes de cualquier instrucción específica.
2. Indicar explícitamente: _"Este es el contexto del sistema sobre el que debes trabajar. No asumas datos fuera de lo indicado aquí."_
3. Para tareas específicas (código, diseño, análisis), añadir después del contexto:
   - Qué componente se está trabajando (Planificador / Visualizador / Registro).
   - Qué escenario aplica (día a día / periodo / colapso).
   - Si es relevante, qué algoritmo metaheurístico se está usando (HGA, ALNS, etc.).
4. Si se pide generar código Java del planificador, recordar al modelo que los datos numéricos de la tabla §9 son las restricciones duras del sistema.

---

_Fuente base: `CASE.md` — Documento de caso del proyecto Tasf.B2B (Proyecto DP1)._
_Última actualización: Mayo 2026._
