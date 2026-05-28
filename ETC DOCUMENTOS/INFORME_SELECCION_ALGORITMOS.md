# Informe de Selección de Algoritmos Metaheurísticos

**Proyecto:** Tasf.B2B - Sistema de Gestión y Enrutamiento de Equipajes
**Enfoque:** Alta Eficiencia y Prevención del Colapso Computacional en Java

---

## 1. Introducción y Contexto

El problema logístico de Tasf.B2B requiere planificar y replanificar rutas para miles de maletas estandarizadas a través de una red global de aeropuertos en América, Asia y Europa (un aeropuerto por ciudad), respetando las siguientes restricciones operacionales del negocio:

| Restricción                             | Mismo Continente  | Distinto Continente |
| --------------------------------------- | ----------------- | ------------------- |
| **SLA (plazo máximo de entrega)**       | 1 día             | 2 días              |
| **Tiempo de tránsito por vuelo**        | Medio día (12h)   | 1 día (24h)         |
| **Capacidad por vuelo**                 | 150 – 250 maletas | 150 – 400 maletas   |
| **Capacidad de almacén por aeropuerto** | 500 – 800 maletas | 500 – 800 maletas   |

Para cumplir con los requerimientos exigidos (R-089, R-090, R-026, R-091, R-032, R-094, R-095) y superar los tres escenarios de evaluación (operaciones día a día, simulación de periodo de 3/5/7 días, y simulación hasta el colapso logístico), se ha diseñado una arquitectura de **Planificación Programada** que orquesta dos algoritmos metaheurísticos complementarios:

1.  **Algoritmo Genético Híbrido (HGA):** Para la planificación masiva y periódica de rutas y asignación de maletas a vuelos (R-089).
2.  **Adaptive Large Neighborhood Search (ALNS):** Para la replanificación dinámica ágil ante eventualidades (cancelaciones de vuelos, envíos urgentes, saturación de almacenes) (R-090). ALNS incorpora internamente un criterio de aceptación de **Recocido Simulado (Simulated Annealing)**, lo cual satisface la sugerencia de R-090 de considerar SA como segundo algoritmo.

El objetivo principal de este diseño es garantizar que el **colapso del sistema sea puramente logístico (saturación física de la red) y no computacional (desbordamiento de memoria o CPU).**

> **Nota sobre nomenclatura:** La literatura académica refiere al marco genético híbrido como **HGS** (Hybrid Genetic Search), que emplea una representación de "giant-tour" y un algoritmo de división (SPLIT) para decodificar rutas en VRP clásicos. En este proyecto, se adopta la denominación **HGA** (Hybrid Genetic Algorithm) con una **codificación directa de ruta + asignación de vuelo**, más natural para este dominio de red aeroportuaria con capacidades heterogéneas por tramo y restricciones de SLA diferenciadas por continente. La codificación directa evita la complejidad computacional del SPLIT en grafos con capacidades y tiempos de tránsito no uniformes.
>
> Adicionalmente, la variante **DHGS (Dynamic HGS)** descrita en la literatura utiliza medidas de _lateness_ (retraso) para priorizar entregas urgentes de forma integrada. En la arquitectura propuesta, esta responsabilidad recae en el **ALNS**, que maneja la replanificación dinámica urgente mediante operadores específicos (`Ruin_Urgente`, `Regret_Insertion`), permitiendo que el HGA se enfoque en la optimización global del plan sin complejidad adicional.

---

## 2. Arquitectura de Planificación Programada y Time-Boxing

Para evitar que el crecimiento exponencial de datos bloquee el sistema (colapso de hilo principal), la ejecución de los algoritmos estará regida por el paradigma de **Planificación Programada**: la planificación de pedidos-rutas se ejecuta cada cierto tiempo fijo, independiente de otros aspectos o condiciones del negocio.

### 2.1. Conceptos Clave

| Símbolo   | Nombre                                   | Definición                                                                                                                                                                                                                                                                   |
| --------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **$T_a$** | Tiempo de ejecución del algoritmo        | Tiempo que demora ejecutar toda la planificación de pedidos-rutas. Varía por la cantidad de datos a procesar (no es lo mismo planificar 5 pedidos que 10,000 pedidos). Debe determinarse el rango de $T_a$ desde volúmenes pequeños hasta los cercanos al colapso logístico. |
| **$S_a$** | Salto del algoritmo                      | Intervalo de tiempo fijo que transcurre entre ejecución y ejecución de la planificación.                                                                                                                                                                                     |
| **$K$**   | Constante de proporcionalidad del tiempo | Permite acelerar la simulación. Depende de los algoritmos implementados.                                                                                                                                                                                                     |
| **$S_c$** | Salto de consumo                         | Salto de tiempo de simulación que se consume en paralelo al $S_a$.                                                                                                                                                                                                           |

**Relación fundamental:**

$$S_c = K \times S_a$$

### 2.2. Restricciones del Salto del Algoritmo ($S_a$)

La calibración de $S_a$ es crítica para la estabilidad del sistema:

- Si $S_a$ es **muy grande**: la probabilidad de colapso logístico es muy alta, ya que se acumulan demasiados pedidos sin planificar.
- Si $S_a$ es **muy pequeño**: cada vez que se lance la ejecución de la planificación, aún no ha concluido la anterior, generando un conflicto en la operación del software y potencialmente una caída de la solución.
- Si $S_a$ se fija "ligeramente superior a $T_a$": puede ocurrir que ese margen no sea suficiente en algún momento futuro, cuando haya más pedidos que procesar.

**Restricción estricta de estabilidad:** El algoritmo será interrumpido y obligado a retornar la mejor solución encontrada hasta el momento cuando:

$$T_a \ge S_a - \epsilon$$

donde $\epsilon$ es un margen de seguridad (ej. 50ms). Al ser algoritmos _Anytime_, siempre devolverán una solución válida aunque se interrumpan.

### 2.3. Condición de Colapso Computacional

El sistema entra en **colapso computacional** cuando la condición $T_a < S_a$ deja de cumplirse de forma sostenida, es decir, cuando el volumen de datos a procesar es tan grande que el algoritmo no logra terminar antes de que se acumule la siguiente ventana de planificación. Este diseño garantiza que el colapso sea logístico (saturación de almacenes o vuelos) y no computacional.

### 2.4. Configuración de Parámetros por Escenario de Evaluación

Los tres escenarios de evaluación exigidos requieren configuraciones diferenciadas de los parámetros de planificación programada:

| Parámetro                               | Día a Día (Tiempo Real)                | Simulación de Periodo (3/5/7 días)                        | Simulación hasta el Colapso                        |
| --------------------------------------- | -------------------------------------- | --------------------------------------------------------- | -------------------------------------------------- |
| **$K$ (Constante de proporcionalidad)** | 1 (tiempo real: 1s simulado = 1s real) | 60–300 (aceleración moderada para completar en 30-90 min) | 500–2000+ (aceleración extrema)                    |
| **$S_a$ (Salto del algoritmo)**         | 5–15 min (reales)                      | 5–10 s (reales), equivalente a 5–50 min simulados         | 2–5 s (reales), equivalente a 15–170 min simulados |
| **$S_c = K \times S_a$**                | 5–15 min simulados                     | 5–50 min simulados                                        | 15–170 min simulados                               |
| **Tasa de ingreso de maletas**          | Normal (según demanda real)            | Normal (histórica)                                        | Acelerada/creciente (R-077)                        |
| **Criterio de parada**                  | Manual o fin de jornada                | Fin del periodo simulado                                  | Saturación de almacenes/vuelos (R-005, R-060)      |

> **Nota:** Los valores de $K$ y $S_a$ son orientativos y deben calibrarse experimentalmente según los tiempos $T_a$ observados en cada volumen de datos.

### 2.5. Clustering: Reducción del Espacio de Búsqueda

Para reducir el tamaño del problema matemático, se implementará un paso previo de **Clustering (Agrupamiento)**: las maletas no se enrutan individualmente, sino agrupadas en "Super-Lotes" que comparten:

- Aeropuerto de Origen
- Aeropuerto de Destino
- Rango de SLA (1 día si mismo continente / 2 días si distinto continente)

---

## 3. Algoritmo 1: Algoritmo Genético Híbrido (HGA) — Planificación Periódica

**Propósito:** Procesar el gran volumen de maletas pendientes de enrutamiento al inicio de la simulación o durante la ventana periódica regular.
**Naturaleza Híbrida:** Combina la exploración global de un Algoritmo Genético con la explotación local (Búsqueda Local) para empaquetar eficientemente las capacidades de los vuelos.
**Requerimientos cubiertos:** R-089, R-032, R-081, R-082, R-094, R-095.

### 3.1. Adaptación al Dominio

- **Codificación (Cromosoma):** Representación en `int[][]` donde cada fila corresponde a un Super-Lote y contiene dos componentes:
  - **Gen de Ruta:** Secuencia ordenada de aeropuertos intermedios que forman el camino del origen al destino.
  - **Gen de Asignación:** ID de vuelo concreto asignado a cada tramo (arista) de la ruta.
- **Fitness (Función de Costo):**

$$F(x) = T_{viaje} + (P_{cap} \times E_{cap}) + (P_{sla} \times E_{sla})$$

Donde:
| Componente | Descripción |
|---|---|
| $T_{viaje}$ | Tiempo total de tránsito. Suma de tiempos por tramo: 12h (mismo continente) o 24h (distinto continente). |
| $P_{cap}$ | Penalización extrema si se excede la capacidad de algún almacén (500-800) o vuelo (150-250 mismo continente / 150-400 distinto continente). |
| $E_{cap}$ | Cantidad de exceso sobre la capacidad. |
| $P_{sla}$ | Penalización por no cumplir el plazo acordado (1 día mismo continente / 2 días distinto continente). |
| $E_{sla}$ | Cantidad de tiempo excedido sobre el SLA. |

### 3.2. Fase 1 — Metaheurística de Rutas

Determina la **secuencia óptima de aeropuertos** (camino) para cada Super-Lote. Esta fase opera sobre el grafo de la red de aeropuertos y utiliza los operadores genéticos:

- **Población Inicial Voraz (R-082):** Se genera usando la heurística de "punto más cercano": para cada Super-Lote, se traza la ruta seleccionando siempre el aeropuerto con conexión más directa al destino, priorizando rutas con menor número de escalas y menor tiempo de tránsito acumulado.
- **Crossover de Rutas:** Intercambia sub-secuencias de aeropuertos intermedios entre dos padres, produciendo nuevas rutas que combinan tramos eficientes.
- **Mutación — Desvío Aleatorio:** Reemplaza un aeropuerto intermedio por otro aeropuerto alternativo que mantenga la conexión entre el tramo anterior y el siguiente.

### 3.3. Fase 2 — Asignación de Rutas a Vuelos

Una vez determinada la secuencia de aeropuertos, asigna los lotes a **vuelos concretos disponibles** en cada tramo de la ruta:

- Para cada tramo (arista Aeropuerto_A → Aeropuerto_B), selecciona el vuelo con capacidad disponible suficiente, respetando los límites (150-250 para mismo continente, 150-400 para distinto continente).
- Si un vuelo no tiene capacidad suficiente para todo el lote, se aplica **división en sub-lotes (R-014):** el lote se fracciona en partes que se asignan a vuelos distintos en el mismo tramo.
- Valida que la capacidad de almacén en el aeropuerto de escala/destino (500-800) no se exceda al momento de la llegada (R-094).
- **Búsqueda Local (componente "Híbrido"):** Intenta mover paquetes de vuelos casi llenos a vuelos con holgura para mejorar la distribución de carga.

### 3.4. Pseudocódigo HGA

```text
INICIO HGA(Lotes_Nuevos, Estado_Red_Actual, Sa)
    Inicio_Reloj = ObtenerTiempoSistema()
    Tiempo_Limite = Sa - Epsilon

    // ═══════════════════════════════════════════
    // PASO 0: Reducción del Espacio de Búsqueda
    // ═══════════════════════════════════════════
    SuperLotes = AgruparLotesPor(Origen, Destino, SLA_Limite, Lotes_Nuevos)

    // ═══════════════════════════════════════════
    // PASO 1: FASE RUTAS — Población Inicial Voraz (R-082)
    // ═══════════════════════════════════════════
    PARA CADA SuperLote EN SuperLotes HACER
        Ruta_Greedy = HeuristicaPuntoMasCercano(SuperLote.Origen, SuperLote.Destino, Estado_Red_Actual)
        // Ruta_Greedy = secuencia de aeropuertos [Origen → Intermedio_1 → ... → Destino]
    FIN PARA

    // ═══════════════════════════════════════════
    // PASO 2: FASE ASIGNACIÓN — Asignar rutas a vuelos concretos
    // ═══════════════════════════════════════════
    PARA CADA SuperLote EN SuperLotes HACER
        PARA CADA Tramo EN SuperLote.Ruta HACER
            Vuelo = SeleccionarVueloConCapacidad(Tramo, SuperLote.CantidadMaletas, Estado_Red_Actual)
            SI Vuelo.CapacidadDisponible < SuperLote.CantidadMaletas ENTONCES
                // R-014: División en sub-lotes
                SubLotes = DividirEnSubLotes(SuperLote, VuelosDisponibles(Tramo))
            FIN SI
            ValidarCapacidadAlmacen(Tramo.Destino, Estado_Red_Actual)  // R-094
        FIN PARA
    FIN PARA

    Poblacion = CrearPoblacionDesdeGreedy(SuperLotes)
    EvaluarFitness_Paralelo(Poblacion)  // ForkJoinPool en Java

    // ═══════════════════════════════════════════
    // PASO 3: Bucle Evolutivo Anytime (Time-Boxed)
    // ═══════════════════════════════════════════
    MIENTRAS (ObtenerTiempoSistema() - Inicio_Reloj < Tiempo_Limite) HACER
        Padres = SeleccionPorTorneoMultiple(Poblacion)

        // FASE RUTAS: Operadores genéticos sobre secuencias de aeropuertos
        Hijos = Crossover_Rutas(Padres)
        Mutar_DesvioRutaAleatoria(Hijos)

        // FASE ASIGNACIÓN: Reasignar vuelos a las nuevas rutas generadas
        PARA CADA Hijo EN Hijos HACER
            ReasignarVuelosATramos(Hijo, Estado_Red_Actual)
            // R-014: Subdividir lotes si no hay capacidad en un solo vuelo
            AplicarDivisionSubLotesSiNecesario(Hijo)
        FIN PARA

        // Búsqueda Local (componente "Híbrido")
        // Mueve paquetes de vuelos casi llenos a vuelos con holgura
        Hijos = OptimizacionLocalCapacidades(Hijos, Estado_Red_Actual)

        EvaluarFitness_Paralelo(Hijos)
        Poblacion = ReemplazoElitista(Poblacion, Hijos)
    FIN MIENTRAS

    MejorCromosoma = ObtenerMejorIndividuo(Poblacion)

    // ═══════════════════════════════════════════
    // PASO 4: Generar output — Plan de Viaje (R-032)
    // ═══════════════════════════════════════════
    PlanDeRutas = DesempaquetarSuperLotes(MejorCromosoma)
    // PlanDeRutas contiene por cada maleta:
    //   - Secuencia de aeropuertos
    //   - Vuelo asignado por tramo
    //   - Tiempo estimado de llegada por tramo

    RETORNAR PlanDeRutas
FIN HGA
```

---

## 4. Algoritmo 2: Adaptive Large Neighborhood Search (ALNS) — Replanificación Dinámica

**Propósito:** Responder de forma ágil a disrupciones sin recalcular toda la red mundial, modificando únicamente la vecindad afectada.
**Requerimientos cubiertos:** R-090, R-026, R-091, R-014, R-028, R-084, R-094, R-095.

### 4.1. Adaptación al Dominio

#### Operadores Destructivos (Ruin)

| Operador             | Descripción                                                                                                                                                 | Requerimiento |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `Ruin_Cancelados`    | Extrae las maletas asignadas a vuelos cancelados. Libera la capacidad de esos vuelos y las marca como "huérfanas" pendientes de reasignación.               | R-026, R-091  |
| `Ruin_CuelloBotella` | Extrae maletas de aeropuertos que superan el 90% de su capacidad de almacén (500-800). Prioriza la extracción de maletas cuyo destino final está más lejos. | R-044         |
| `Ruin_Urgente`       | En caso de paquete urgente (R-084), extrae maletas de menor prioridad de un avión en tránsito cercano para hacer espacio al envío urgente.                  | R-084         |

#### Operadores Reparadores (Repair)

| Operador              | Descripción                                                                                                                                                                                | Requerimiento |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| `Regret_Insertion`    | Inserta rutas calculando el "arrepentimiento" (diferencia de costo entre la mejor y la segunda mejor ruta posible). Prioriza las maletas urgentes que no tienen muchas rutas alternativas. | R-091, R-095  |
| `Repair_SubLote`      | Cuando no hay capacidad suficiente en un solo vuelo del tramo, divide el lote en sub-lotes asignándolos a vuelos distintos del mismo tramo.                                                | R-014         |
| `Repair_RutaRespaldo` | Para envíos de alta prioridad, genera automáticamente una ruta alternativa usando aeropuertos/vuelos distintos a la ruta principal, garantizando un plan B.                                | R-028         |

#### Criterio de Aceptación

**Recocido Simulado (Simulated Annealing):** Permite aceptar soluciones peores con cierta probabilidad para escapar de óptimos locales. La probabilidad de aceptación decrece con la temperatura:

$$P(\text{aceptar}) = e^{-\Delta\text{Costo} / T}$$

### 4.2. Fase 1 — Reconstrucción de Rutas

Ante una disrupción, el ALNS reconstruye las rutas afectadas:

- Los operadores destructivos (Ruin) identifican las maletas que necesitan nueva ruta y las extraen de la solución actual.
- Los operadores reparadores (Repair) calculan nuevas secuencias de aeropuertos para las maletas huérfanas, respetando los tiempos de tránsito (12h mismo continente / 24h distinto continente) y los plazos SLA residuales.
- Para envíos de alta prioridad, `Repair_RutaRespaldo` (R-028) genera una ruta alternativa en paralelo a la ruta principal.

### 4.3. Fase 2 — Reasignación a Vuelos

Una vez definidas las nuevas rutas, se asignan a vuelos concretos:

- Selecciona vuelos con capacidad disponible en cada tramo de la nueva ruta, respetando los límites de capacidad (150-250 / 150-400 según tipo de ruta).
- Si no hay capacidad suficiente, `Repair_SubLote` (R-014) divide el lote y lo distribuye entre múltiples vuelos.
- Valida que la capacidad acumulada de cada almacén de escala no se exceda (R-094).
- Para paquetes urgentes (R-084), asigna al avión en tránsito más cercano que tenga capacidad, recalculando su ruta.

### 4.4. Pseudocódigo ALNS

```text
INICIO ALNS(Solucion_Base, Disrupciones, Sa, Estado_Red_Actual)
    Inicio_Reloj = ObtenerTiempoSistema()
    Tiempo_Limite = Sa - Epsilon
    Temperatura = T_Inicial

    MejorSol = Solucion_Base
    Sol_Actual = Solucion_Base

    // Inicialización adaptativa de pesos de operadores
    Pesos_Ruin = InicializarPesosUniformemente()   // {Cancelados, CuelloBotella, Urgente}
    Pesos_Repair = InicializarPesosUniformemente() // {Regret, SubLote, RutaRespaldo}

    // ═══════════════════════════════════════════
    // Bucle Adaptativo Anytime (Time-Boxed)
    // ═══════════════════════════════════════════
    MIENTRAS (ObtenerTiempoSistema() - Inicio_Reloj < Tiempo_Limite) HACER
        Op_Ruin = RuletaSeleccion(Pesos_Ruin)
        Op_Repair = RuletaSeleccion(Pesos_Repair)

        // ═════════════════════════════════════
        // FASE RUTAS: Destruir y reconstruir secuencias de aeropuertos
        // ═════════════════════════════════════
        Sol_Parcial, Lotes_Huerfanos = Aplicar(Op_Ruin, Sol_Actual, Disrupciones)
        Nuevas_Rutas = ReconstruirRutas(Op_Repair, Sol_Parcial, Lotes_Huerfanos, Estado_Red_Actual)
        // Nuevas_Rutas = nuevas secuencias de aeropuertos para lotes huérfanos
        // Valida tiempos de tránsito: 12h (mismo cont.) / 24h (distinto cont.)
        // Valida SLA residual: 1 día (mismo cont.) / 2 días (distinto cont.)

        // ═════════════════════════════════════
        // FASE ASIGNACIÓN: Asignar nuevas rutas a vuelos concretos
        // ═════════════════════════════════════
        PARA CADA Lote EN Lotes_Huerfanos HACER
            PARA CADA Tramo EN Lote.NuevaRuta HACER
                Vuelo = SeleccionarVueloConCapacidad(Tramo, Lote.Cantidad, Estado_Red_Actual)
                SI Vuelo.CapacidadDisponible < Lote.Cantidad ENTONCES
                    // R-014: División en sub-lotes
                    SubLotes = DividirEnSubLotes(Lote, VuelosDisponibles(Tramo))
                FIN SI
                ValidarCapacidadAlmacen(Tramo.Destino, Estado_Red_Actual)  // R-094
            FIN PARA
            // R-028: Generar ruta de respaldo para envíos de alta prioridad
            SI Lote.EsAltaPrioridad ENTONCES
                Lote.RutaRespaldo = GenerarRutaAlternativa(Lote, Estado_Red_Actual)
            FIN SI
        FIN PARA

        Sol_Candidata = ConstruirSolucion(Nuevas_Rutas, Asignaciones_Vuelos)
        DeltaCosto = Fitness(Sol_Candidata) - Fitness(Sol_Actual)

        // Criterio de Aceptación: Recocido Simulado
        SI (DeltaCosto < 0 O Aleatorio(0,1) < e^(-DeltaCosto / Temperatura)) ENTONCES
            Sol_Actual = Sol_Candidata
            SI (Fitness(Sol_Actual) < Fitness(MejorSol)) ENTONCES
                MejorSol = Sol_Actual
            FIN SI
            ActualizarPesos(Pesos_Ruin, Pesos_Repair, EXITO)
        SINO
            ActualizarPesos(Pesos_Ruin, Pesos_Repair, FRACASO)
        FIN SI

        Temperatura = Temperatura * Tasa_Enfriamiento
    FIN MIENTRAS

    // ═══════════════════════════════════════════
    // Output: Plan de Viaje actualizado (R-032)
    // ═══════════════════════════════════════════
    // MejorSol contiene por cada maleta replanificada:
    //   - Nueva secuencia de aeropuertos
    //   - Vuelo asignado por tramo
    //   - Tiempo estimado de llegada actualizado
    //   - Ruta de respaldo (si aplica, R-028)

    RETORNAR MejorSol
FIN ALNS
```

---

## 5. Buenas Prácticas de Ingeniería (Java) para Retrasar el Colapso

Para asegurar que el tiempo computacional $T_a$ se mantenga bajo y permitir simulaciones de estrés masivas, la implementación en Java debe seguir las siguientes directrices de alto rendimiento:

1.  **Object Pooling (Mitigación del Garbage Collector):** La creación constante de objetos `Ruta` o `Solucion` durante las iteraciones ahogará la JVM. Se implementará un patrón _Object Pool_ para reciclar estructuras de memoria de los individuos descartados, evitando pausas ("Stop-The-World") del Garbage Collector.
2.  **Estructuras de Datos Primitivas:** El núcleo matemático de los algoritmos no utilizará colecciones de Java (`ArrayList<Integer>`, `HashMap`), debido al _boxing/unboxing_ y pérdida de localidad en caché. Se usarán matrices primitivas (`int[]`, `int[][]`) donde los índices corresponden a los IDs numéricos de aeropuertos y vuelos.
3.  **Evaluación Concurrente Inteligente:** La evaluación del fitness, que requiere iterar sobre las matrices de capacidad temporal de los aeropuertos, se dividirá en lotes (chunks) ejecutados paralelamente usando `java.util.concurrent.ForkJoinPool` o `.parallelStream()`, aprovechando todos los núcleos del servidor.
4.  **Delta Evaluation:** En lugar de recalcular el costo completo de una ruta tras una pequeña mutación, los algoritmos calcularán solo el costo marginal (Delta) de las aristas eliminadas y agregadas, reduciendo la complejidad computacional de $O(n)$ a $O(1)$ en la fase de evaluación.
