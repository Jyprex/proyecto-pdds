# 🎤 GUÍA DE PRESENTACIÓN TÉCNICA — MATHIAS MEDINA
## Rol: Infraestructura, Datos y Experimentación Numérica

> **Idea central que debes transmitir:**
> "Yo construí el pipeline completo desde los datos crudos en archivos `.txt` hasta los resultados
> estadísticos del experimento. Me encargué de que el sistema sea robusto, sin corrupción de datos,
> y de que los algoritmos sean comparables bajo condiciones controladas."

---

## ARCHIVO 1: `application.properties`
### ¿Qué es esto?

Es el **archivo de configuración central** del backend Spring Boot. Le dice al sistema cómo conectarse a la base de datos, dónde están los archivos de datos, y qué funcionalidades activar.

```properties
spring.application.name=backend

# Base de datos H2 en memoria
spring.h2.console.enabled=true
spring.h2.console.path=/h2-console
spring.datasource.url=jdbc:h2:mem:testdb

# Ruta absoluta al dataset de envíos
tasf.data.path=C:/Users/Mathias/Documents/proyecto-pdds-main/backend/data
```

### ¿Qué decir en la exposición?

**Sobre H2 en memoria:**
> "Elegimos H2 en memoria de manera deliberada. El sistema no necesita persistir datos entre
> reinicios porque siempre lee desde los archivos `.txt` del dataset. Esto nos da una BD que
> arranca limpia, sin acumulación de basura, ideal para pruebas repetibles y para el DOE."

**Sobre `tasf.data.path`:**
> "Esta variable es inyectada con `@Value` en todos los servicios que necesitan acceder
> al filesystem. Si el profesor pregunta cómo cambiamos la ruta en producción, simplemente
> cambiamos esta línea. Si fuera en AWS, apuntaría a un volumen EBS o un bucket S3 montado."

**Sobre escalabilidad futura:**
> "Si quisiéramos migrar a PostgreSQL en AWS RDS, solo cambiaríamos el `datasource.url`
> aquí y agregaríamos el driver. El resto del código no se toca gracias al ORM."

---

## ARCHIVO 2: `EnvioService.java`
### ¿Qué hace este servicio?

Es el **responsable de todo el ciclo de vida de los datos de envíos**: leerlos desde los 28
archivos `.txt`, parsearlos, validarlos, y guardarlos en la BD sin duplicados.

---

### FUNCIÓN 1: `cargarPorFecha(inicio, fin, dataPath)`
**Líneas 93–120 · `@Transactional(REQUIRES_NEW)`**

#### ¿Qué hace?
Es el punto de entrada. Cuando el usuario inicia una simulación, esta función escanea la
carpeta de datos y carga solo los envíos del rango de fechas solicitado.

#### ¿Cómo lo hace? (paso a paso)

```
1. Convierte las fechas a formato YYYYMMDD para comparación rápida de strings
   → startStr = "20260115"  endStr = "20260120"

2. Abre un DirectoryStream apuntando a la carpeta tasf.data.path
   → Filtra solo archivos con patrón: _envios_*.txt
   → Esto incluye los 28 archivos (SKBO, LEMD, OMDB, VIDP, etc.)

3. Por cada archivo, lee línea por línea con BufferedReader
   → Extrae el campo fecha (posición guion+1 a guion+8) SIN hacer split completo
   → Comparación lexicográfica: "20260115" >= startStr && "20260115" <= endStr
   → Si la fecha cae en el rango: añade la línea a la lista

4. Si la lista del archivo no está vacía:
   → Llama a cargarDesdeLineasArchivo(nombreArchivo, lineas)
```

#### ¿Por qué extrae la fecha sin hacer `split`?
> "Optimización consciente. Cada archivo tiene miles de líneas. Hacer `split("-")` en cada
> una para luego descartar el 90% sería muy costoso. En cambio, `substring(guion+1, guion+9)`
> extrae los 8 caracteres de la fecha directamente por posición de memoria — es O(1) por línea."

---

### FUNCIÓN 2: `cargarDesdeLineasArchivo(nombreArchivo, lineas)`
**Líneas 33–92 · `@Transactional(REQUIRES_NEW)`**

#### ¿Qué hace?
Transforma las líneas de texto crudas en entidades `Envio` y las persiste en la BD,
garantizando cero duplicados y cero corrupción del ORM.

#### ¿Cómo lo hace? (paso a paso)

```
1. CACHE DE AEROPUERTOS
   → aeropuertoCache = { "SKBO" → Aeropuerto(...), "LEMD" → Aeropuerto(...), ... }
   → Cargado UNA SOLA VEZ al inicio del método (evita N+1 queries)

2. ORIGEN DESDE EL NOMBRE DE ARCHIVO
   → NombreArchivoParser.extraerIcao("_envios_SKBO_.txt") → "SKBO"
   → Si "SKBO" no está en el cache → omite el archivo completo (aeropuerto no registrado)

3. PRE-FILTRO ANTI-DUPLICADOS (la parte más importante)
   → existentes = SELECT codigoPedido FROM envios WHERE origen.icaoCode = 'SKBO'
   → Resultado: Set{"000001234", "000005032", "000005033", ...}
   → Este Set se consulta en O(1) por código

4. LOOP POR LÍNEA
   Para cada línea:
   a. EnvioParser.parse(linea) → descompone en ParsedEnvio(codigo, fecha, hora, destino, cantidad, cliente)
   b. if (existentes.contains(codigo)) → SKIP silencioso (no toca Hibernate)
   c. aeropuertoCache.get(destinoIcao) → valida que el destino existe
   d. Construye Envio con el builder de Lombok y lo añade al batch

5. PERSISTENCIA EN LOTES
   → Cuando batch.size() == 500: envioRepo.saveAll(batch) → INSERT de 500 en 1 statement SQL
   → Al terminar el loop: guarda el lote final (el que quedó < 500)
```

#### ¿Por qué el pre-filtro y no el try-catch?

> "Esta es la decisión de diseño más importante de este método. La alternativa obvia sería
> intentar guardar y capturar la excepción de duplicado. El problema: cuando Hibernate
> intenta un `save()` que falla por violación de unicidad, la sesión JPA queda en estado
> corrupto — el objeto fue añadido al contexto de persistencia con `id = null`, y la sesión
> ya no puede procesar nada más. Hibernate lanza `HHH000099 AssertionFailure`.
>
> La solución: consultar ANTES qué códigos ya existen y saltarlos en memoria. De esta forma
> el motor de persistencia nunca ve un duplicado y la sesión nunca se corrompe."

#### ¿Qué es `@Transactional(REQUIRES_NEW)`?
> "Cada archivo se procesa en su propia transacción independiente. Si un archivo falla,
> los demás no se ven afectados. Es aislamiento de fallos a nivel de archivo."

---

### FUNCIÓN 3: `getDemandaRealPorFecha(inicio, fin)`
**Líneas 127–136 · `@Transactional(readOnly = true)`**

#### ¿Qué hace?
Consulta la BD y devuelve un mapa `{"20260115" → 45320, "20260116" → 51890, ...}` con
el total de maletas reales por día. El frontend lo usa para mostrar la demanda histórica.

```java
return envioRepo.findDailyTotalsByRange(inicio, fin).stream()
    .collect(Collectors.toMap(
        dt -> dt.getFecha().format(BASIC_ISO_DATE),  // clave: "20260115"
        DailyTotal::getTotal,                         // valor: 45320L
        Long::sum,                                    // merge: si hay duplicados, suma
        TreeMap::new                                  // ordenado cronológicamente
    ));
```

> "`readOnly = true` le dice a Hibernate que no necesita rastrear cambios en las entidades
> cargadas. Reduce el overhead del ORM en un ~30% para consultas de solo lectura."

---

## ARCHIVO 3: `NumericExperimentService.java`
### ¿Qué hace este servicio?

Es el **cerebro del experimento numérico DOE**. Determina automáticamente los 5 niveles
de estrés a partir de los datos históricos reales, ejecuta cada nivel contra el algoritmo
elegido (HGA o ALNS), y recolecta métricas de rendimiento comparables.

---

### FUNCIÓN 1: `calculateDOELevels()`
**Líneas 81–181**

#### ¿Qué hace?
Escanea los 28 archivos `.txt` en busca de la distribución estadística de demanda,
y determina automáticamente las 5 fechas históricas que representan los 5 niveles DOE.
**No usa la BD. Lee directo del filesystem.**

#### ¿Cómo lo hace? (paso a paso)

```
1. ESCANEO MASIVO (stream línea a línea)
   → Itera todos los _envios_*.txt
   → Por cada línea: extrae fecha (guion+1, guion+9) y cantidad (partes[5])
   → Acumula en: resumenDiario = { "20290115" → 45320L, "20290116" → 51890L, ... }
   → NUNCA carga todo en RAM — procesa y descarta línea a línea

2. ESTADÍSTICAS SOBRE EL RESUMEN DIARIO
   minVal  = menor demanda diaria histórica  → Nivel 1 (MIN)
   maxVal  = mayor demanda diaria histórica  → Nivel 5 (MAX)
   avg     = promedio de todos los días      → Nivel 3 (AVG)
   midLow  = (min + avg) / 2                → Nivel 2 (MID_LOW)
   midHigh = (avg + max) / 2                → Nivel 4 (MID_HIGH)

3. SELECCIÓN DE FECHAS REALES
   → Para MIN y MAX: directamente las fechas con ese valor exacto
   → Para MID_LOW, AVG, MID_HIGH: findClosestDate() busca la fecha real
     cuya demanda sea más cercana al target (sin repetir fechas ya usadas)

4. CONSTRUCCIÓN DE LevelDefinition (×5)
   Cada nivel tiene: nombre, tag (MIN/MID_LOW/AVG/MID_HIGH/MAX), fecha, suitcaseCount
```

#### ¿Por qué leer del filesystem y no de la BD?
> "Este método se llama antes de iniciar el experimento, cuando la BD puede estar vacía.
> Al leer directo de los archivos, el DOE es completamente independiente del ciclo de
> simulación. Además, escanear 28 archivos con stream es más rápido que cargar millones
> de registros en memoria."

#### ¿Qué decir sobre los 5 niveles?
> "No elegimos los 5 niveles de forma arbitraria. Los calculamos estadísticamente a partir
> de los datos reales. Nivel 1 es el día más tranquilo de la historia del dataset.
> Nivel 5 es el pico máximo registrado. Los niveles 2, 3 y 4 son intermedios calculados
> como promedios ponderados, y cada uno corresponde a una fecha real específica para que
> los datos sean auténticos, no sintéticos."

---

### FUNCIÓN 2: `createSession(algorithm, levels)` + `getSession(id)`
**Líneas 187–199**

#### ¿Qué hace?
Crea una sesión de experimento identificada por UUID y la almacena en memoria.
El frontend hace polling a `/experiment/status/{sessionId}` para ver el progreso.

```java
// En memoria: Map<String UUID, ExperimentSession>
private final Map<String, ExperimentSession> activeSessions = new ConcurrentHashMap<>();

// ConcurrentHashMap porque el experimento corre en un thread separado (@Async)
// y el frontend accede desde threads HTTP — necesitamos thread-safety
```

> "`ConcurrentHashMap` es clave aquí. El experimento corre en el thread `tasf-sim-1`
> (asíncrono). El frontend hace polling desde threads HTTP. Si usáramos `HashMap` normal
> tendríamos condiciones de carrera — lecturas y escrituras simultáneas sin sincronización."

---

### FUNCIÓN 3: `runExperiment(sessionId)` — El motor principal
**Líneas 205–248 · `@Async("simulationExecutor")`**

#### ¿Qué hace?
Ejecuta los 5 niveles DOE en secuencia, actualizando el progreso en tiempo real.
Corre en un thread pool separado para no bloquear el servidor HTTP.

#### ¿Cómo lo hace? (paso a paso)

```
1. Recupera la sesión del ConcurrentHashMap
2. Marca status = RUNNING

3. Carga mapa de aeropuertos UNA SOLA VEZ para toda la batería
   → airportMap = { "SKBO" → Aeropuerto, "LEMD" → Aeropuerto, ... }
   → Se reutiliza en los 5 niveles (no N queries repetidas)

4. LOOP por cada nivel (0..4):
   a. session.setProgressPercent(i * 100 / 5) → el frontend ve 0%, 20%, 40%, 60%, 80%
   b. agruparDia(fechaDelNivel) → carga los SuperLots del día histórico desde .txt
   c. runSingleLevel(i, levelDef, algorithm, airportMap, lots) → ejecuta el algoritmo
   d. session.getResults().add(result) → guarda el resultado del nivel

5. Al terminar: status = DONE, progressPercent = 100
6. Si falla: status = FAILED, guarda el mensaje de error
```

> "`@Async` significa que cuando el frontend llama `POST /experiment/start`, el backend
> responde inmediatamente con el `sessionId` (HTTP 202 Accepted) y el experimento
> empieza a correr en segundo plano. El frontend hace polling cada 2 segundos al
> endpoint de status y actualiza la barra de progreso en vivo."

---

### FUNCIÓN 4: `runSingleLevel(...)` — El ciclo de un nivel
**Líneas 262–371 · Privada**

#### ¿Qué hace?
Ejecuta el algoritmo elegido sobre un nivel de demanda específico y calcula todas las
métricas de resultado. Es donde ocurre la **comparación real** entre HGA y ALNS.

#### ¿Cómo lo hace? (paso a paso)

```
PASO 1 — CAPTURAR RECURSOS DEL SISTEMA ANTES
   → OperatingSystemMXBean: CPU%, RAM usada en MB
   → Estos son los recursos ANTES de que el algoritmo empiece

PASO 2 — SELECCIONAR VENTANA DE TIEMPO
   ALNS → windowMs = 6.500 ms  (escenario TIEMPO_REAL: replanificación urgente)
   HGA  → windowMs = 45.000 ms (escenario PERIODO: planificación estructural)
   → Esto es lo que justifica la diferencia de tiempos en las diapositivas

PASO 3 — CRONOMETRAR Y EJECUTAR
   t1 = System.currentTimeMillis()
   if ALNS: sol = alnsPlanner.plan(lots, windowMs)
   if HGA:  sol = hgaPlanner.plan(lots, null, windowMs)
   planningTimeMs = System.currentTimeMillis() - t1

PASO 4 — DETECCIÓN DE COLAPSO COMPUTACIONAL
   if (planningTimeMs >= SA_THRESHOLD_MS)  donde SA = 15.000 ms
     → log.warn("[COLAPSO COMPUTACIONAL] Ta=Xms >= Sa=15000ms")
     → colapsoComputacional = true
   Esto significa: el algoritmo tardó más que el tiempo disponible antes del despegue

PASO 5 — SIMULAR EL DÍA
   t2 = System.currentTimeMillis()
   SimulationState state = simulationRunner.run(routes, airportMap, epochStart)
   simulationTimeMs = t2 - ...

PASO 6 — CALCULAR KPIs LOGÍSTICOS
   Para cada Route en la solución:
     - isNoAtendido() ? lotesNoAtendidos++ : lotesAtendidos++
     - totalAtendidas += capacidadAsignada
     - totalDelayHoras += (arrivalTime - lot.readyTime) / 3_600_000

   ecap = max(0, demandaTotal - atendidas - capacidadAlmacenaje)
   compliance = (atendidas / demandaTotal) * 100
   satAero = state.getSaturacionAeropuerto()

PASO 7 — FUNCIÓN OBJETIVO
   F(S) = 10·A − 0.005·Ecap − 2·Dh − 12·Saero
   Donde:
     A    = lotes atendidos
     Ecap = maletas sin ruta y sin almacén
     Dh   = horas de retraso promedio
     Saero = saturación de aeropuertos [0..1]

PASO 8 — CONSTRUIR ExperimentRunResult CON TODAS LAS MÉTRICAS
   → occupancyRate, leadTimeAvg, complianceRate, fitnessScore
   → planningTimeMs, simulationTimeMs, executionTimeMs
   → memoryUsedMb, cpuUsagePercent
   → colapsoComputacional (true/false)
```

#### ¿Qué decir sobre la Función Objetivo?
> "La función objetivo no es arbitraria. Cada término tiene un peso que refleja su impacto
> operativo. Atender un lote (+10) tiene más valor que el costo de retraso (-2·horas)
> porque en logística aérea la prioridad es mover la carga, aunque llegue tarde.
> El coeficiente de saturación (-12) es el más alto porque un aeropuerto saturado
> genera efecto dominó en toda la red."

---

### FUNCIÓN 5: `agruparDia(fecha, airportMap)`
**Líneas 386–443 · Privada**

#### ¿Qué hace?
Lee los 28 archivos `.txt` y agrupa todos los envíos de UNA fecha específica en
**SuperLots** por par origen-destino. Es la "alimentación" del algoritmo.

#### ¿Qué es un SuperLot?
> "Un SuperLot es la unidad de planificación. En lugar de tratar cada maleta como un
> objeto independiente (lo que sería computacionalmente inmanejable), agrupamos todas
> las maletas que van del mismo aeropuerto A al mismo aeropuerto B en ese día.
> Si hay 342 maletas que van de SKBO a LEMD, eso es un SuperLot con totalMaletas=342."

#### ¿Cómo lo hace? (paso a paso)

```
1. Convierte la fecha a YYYYMMDD para comparación de strings

2. Por cada _envios_XXXX_.txt:
   a. Extrae ICAO del origen desde el nombre del archivo
   b. Lee línea a línea con BufferedReader
   c. Filtro rápido: substring(guion+1, guion+9) == fechaStr
   d. Si coincide: extrae destinoIcao (p[4]) y cantidad (p[5])
   e. Acumula en: acum["SKBO-LEMD"] += cantidad

3. DailyAccumulator (clase interna, líneas 486-491):
   → Objeto mínimo: {origen, destino, totalMaletas}
   → computeIfAbsent: si "SKBO-LEMD" no existe, crea; si existe, suma

4. Construye SuperLots desde los acumuladores:
   → SLA intercontinental: 48h
   → SLA nacional/continental: 24h
   → readyTime: medianoche UTC del día de la fecha
```

---

### FUNCIÓN 6: `findClosestDate(data, target, excluidas)`
**Líneas 450–469 · Privada · Utilidad DOE**

#### ¿Qué hace?
De todos los días del dataset, encuentra el que tiene la demanda más cercana a un
valor objetivo, sin repetir fechas ya asignadas a otro nivel.

```java
// Búsqueda lineal simple pero efectiva
for (Map.Entry<String, Long> e : data.entrySet()) {
    if (excluidas.contains(e.getKey())) continue;         // ya asignada
    double diff = Math.abs(e.getValue() - target);         // distancia al target
    if (diff < bestDiff) { bestDiff = diff; best = e.getKey(); }
}
```

> "Este algoritmo garantiza que los 5 niveles del DOE correspondan a 5 días DISTINTOS
> del dataset real. No podríamos tener el mismo día representando dos niveles porque
> eso haría los resultados estadísticamente inválidos."

---

### FUNCIONES AUXILIARES (líneas 471–491)

| Función | Qué hace |
|---------|----------|
| `toIsoDate("20290115")` | Convierte `"20290115"` → `"2029-01-15"` para compatibilidad con `LocalDate.parse()` |
| `round1(v)` | Redondea a 1 decimal: `45.678` → `45.7` (para métricas de porcentaje) |
| `round2(v)` | Redondea a 2 decimales: `1234.5678` → `1234.57` (para fitness score) |
| `DailyAccumulator` | Clase interna mínima: acumula maletas por par origen-destino durante el escaneo |

---

## RESUMEN DE MÉTRICAS QUE PRODUCE EL EXPERIMENTO

Cada nivel produce un `ExperimentRunResult` con:

| Categoría | Métrica | Qué mide |
|-----------|---------|----------|
| **Logística** | `complianceRate` | % de maletas entregadas dentro del SLA |
| **Logística** | `leadTimeAvg` | Tiempo promedio de retraso en horas |
| **Logística** | `occupancyRate` | % de capacidad de vuelos utilizada |
| **Optimización** | `fitnessScore` | F(S) = 10A − 0.005Ecap − 2Dh − 12Saero |
| **Tiempo** | `planningTimeMs` | Tiempo que tardó el algoritmo en planificar |
| **Tiempo** | `simulationTimeMs` | Tiempo de la simulación del día |
| **Recursos** | `memoryUsedMb` | RAM consumida durante el nivel |
| **Recursos** | `cpuUsagePercent` | CPU del sistema durante el nivel |
| **Colapso** | `colapsoComputacional` | ¿Tardó más de 15s? (Ta ≥ Sa) |
| **Volumen** | `totalProcessed` | Total de maletas del día histórico |
| **Volumen** | `totalAttended` | Maletas efectivamente enrutadas |
| **Volumen** | `totalEcap` | Maletas sin ruta y sin almacén disponible |

---

## PREGUNTAS QUE PUEDE HACER EL PROFESOR Y CÓMO RESPONDER

**P: "¿Por qué no guardaron los envíos en la BD desde el principio?"**
> "Diseñamos una carga diferida intencional. Los archivos `.txt` tienen cientos de miles
> de líneas. Cargarlos todos al arrancar el servidor tomaría minutos. En cambio, solo
> cargamos el rango de fechas necesario cuando el usuario inicia una simulación.
> Esto hace el sistema responsivo desde el primer segundo."

**P: "¿Cómo validan que no hay corrupción de datos en la carga masiva?"**
> "Dos mecanismos. Primero, la restricción `@UniqueConstraint` en la entidad asegura que
> la BD rechaza duplicados a nivel de motor. Segundo, el pre-filtro en `EnvioService`
> consulta qué códigos ya existen antes de intentar insertar, evitando que Hibernate
> genere excepciones que corrompen la sesión JPA."

**P: "¿Por qué H2 y no PostgreSQL?"**
> "H2 es suficiente para el volumen del proyecto académico y elimina la necesidad de
> gestionar un servidor de BD externo. Si el sistema escalara, el cambio sería
> únicamente en `application.properties` — el código del servicio no cambia."

**P: "¿Por qué ALNS tiene 6.5s y HGA tiene 45s?"**
> "Porque modelan escenarios distintos. ALNS es para TIEMPO_REAL: una cancelación de vuelo
> debe replanificarse en segundos porque el avión despega en minutos. HGA es para PERIODO:
> la planificación nocturna tiene toda la madrugada disponible. Darle 45s al HGA refleja
> esa realidad operativa y es lo que justifica estadísticamente que sus resultados sean
> mejores en planificación estructural."

**P: "¿Qué es el colapso computacional?"**
> "Es cuando el tiempo de planificación `Ta` supera el umbral operativo `Sa = 15 segundos`.
> Esto significa que el algoritmo no terminó de planificar antes de que el siguiente
> vuelo crítico deba despegar. En la práctica: el vuelo potencialmente sale sin solución
> para sus maletas. El sistema lo detecta, lo registra en el log, y lo reporta en el
> resultado del experimento."
