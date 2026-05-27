# 🎤 GUÍA DE PRESENTACIÓN TÉCNICA — application.properties
## "Configuración de Infraestructura del Backend"

---

## El archivo completo (5 líneas)

```properties
spring.application.name=backend
spring.h2.console.enabled=true
spring.h2.console.path=/h2-console
spring.datasource.url=jdbc:h2:mem:testdb
tasf.data.path=C:/Users/Mathias/Documents/proyecto-pdds-main/backend/data
```

> **¿Por qué este archivo importa?**
> Este archivo es el "tablero de control" del backend. Sin tocar una sola línea de código Java,
> puedo cambiar la base de datos, la ruta de los datos o habilitar herramientas de diagnóstico.
> Es el principio de **configuración externalizada** de los 12-Factor Apps.

---

## LÍNEA 1: `spring.application.name=backend`

### ¿Qué hace?
Le da un nombre identificador al microservicio. Spring Boot lo usa en:
- Los logs: `[backend] [main]` — lo ves en cada línea del log de arranque
- Métricas de monitoreo (Spring Actuator, Prometheus)
- Registro en service discovery (si hubiera Eureka o Kubernetes)

### En los logs del arranque:
```
2026-05-14T19:27:35.153-05:00 INFO [backend] [main] com.tasfb2b.BackendApplication : Starting BackendApplication...
                                     ↑
                                 Este "backend" viene de aquí
```

### ¿Qué decir en la exposición?
> "En un sistema distribuido real, esta propiedad permite distinguir entre microservicios
> cuando todos escriben en el mismo sistema de logs centralizado. Si tuviéramos
> un servicio de autenticación, uno de planificación y uno de reportes, cada uno
> tendría su nombre y los logs serían rastreables por servicio."

---

## LÍNEAS 2 y 3: Consola H2

```properties
spring.h2.console.enabled=true
spring.h2.console.path=/h2-console
```

### ¿Qué hace?
Habilita una **interfaz web de administración de base de datos** integrada en el servidor.
Accesible en `http://localhost:8080/h2-console` mientras el backend está corriendo.

### ¿Qué puedes ver en esa consola?
- Todas las tablas creadas automáticamente por Hibernate: `AEROPUERTOS`, `VUELOS`, `ENVIOS`
- Ejecutar SQL directo: `SELECT COUNT(*) FROM ENVIOS WHERE FECHA = '2026-01-15'`
- Ver los índices y constraints: el `CONSTRAINT_INDEX_7` de unicidad `(CODIGO_PEDIDO, ORIGEN_ID)`
- Verificar cuántos registros cargó la simulación

### Datos de conexión de la consola:
```
URL:      jdbc:h2:mem:testdb
Usuario:  SA
Password: (vacío)
```

### ¿Qué decir en la exposición?
> "Esta consola es nuestra herramienta de diagnóstico en tiempo real. Si el profesor
> quiere ver exactamente cuántas maletas cargó el sistema o cómo están estructuradas
> las tablas, puedo abrir el navegador en `/h2-console` y mostrarlo en vivo.
> Es el equivalente a pgAdmin para PostgreSQL, pero embebido en la aplicación."

### ¿Por qué `enabled=true` solo en desarrollo?
> "En producción, esto estaría en `false`. Exponer una consola de BD sin autenticación
> sería una vulnerabilidad de seguridad crítica. Spring Boot lo desactiva por defecto
> en el perfil `production`. Nosotros lo dejamos en `true` porque este es el entorno
> de desarrollo y demo."

---

## LÍNEA 4: `spring.datasource.url=jdbc:h2:mem:testdb`

### ¿Qué hace?
Define la cadena de conexión a la base de datos. Esta es la línea más técnicamente
densa del archivo. Se descompone en:

```
jdbc : h2 : mem : testdb
  ↑      ↑    ↑      ↑
  │      │    │      └── Nombre de la BD en memoria (puede ser cualquier nombre)
  │      │    └───────── "mem" = in-memory (vive solo mientras el proceso está vivo)
  │      └────────────── Motor de BD: H2
  └───────────────────── Protocolo: Java DataBase Connectivity
```

### ¿Qué significa `mem` (in-memory)?

| Característica | H2 `mem` (lo que tenemos) | H2 `file` | PostgreSQL |
|---|---|---|---|
| Dónde vive | RAM | Disco | Servidor externo |
| Persiste al reiniciar | ❌ No | ✅ Sí | ✅ Sí |
| Velocidad | ⚡ Máxima | Rápida | Depende de red |
| Setup requerido | Cero | Cero | Instalar servidor |
| Para producción | ❌ | ⚠️ Solo pequeña escala | ✅ |

### ¿Por qué elegimos `mem` y no `file`?
> "Decisión arquitectónica consciente. El sistema **nunca necesita persistir datos entre
> reinicios** porque siempre recarga desde los archivos `.txt` del dataset.
> Una BD in-memory garantiza que cada sesión de prueba empiece limpia, sin datos
> corruptos de corridas anteriores. Además, las operaciones de escritura son hasta
> 10x más rápidas que en disco — importante cuando cargamos miles de envíos."

### ¿Cómo cambiaríamos a PostgreSQL en producción?
```properties
# Solo cambiar ESTA línea:
spring.datasource.url=jdbc:postgresql://db.tasf.internal:5432/tasfb2b

# Y agregar estas:
spring.datasource.username=${DB_USER}
spring.datasource.password=${DB_PASS}
spring.datasource.driver-class-name=org.postgresql.Driver
```
> "El código Java de los repositorios y servicios no cambiaría ni una línea.
> Spring Data JPA abstrae completamente el motor de BD."

### ¿Cómo quedaría en AWS?

```properties
# RDS PostgreSQL en AWS:
spring.datasource.url=jdbc:postgresql://tasfb2b.c9abc123.us-east-1.rds.amazonaws.com:5432/tasfb2b
spring.datasource.username=${RDS_USERNAME}      # variable de entorno en EC2
spring.datasource.password=${RDS_PASSWORD}      # variable de entorno en EC2
```
> "Con AWS RDS, la BD correría en una instancia administrada separada del backend.
> Alta disponibilidad, backups automáticos, y el backend solo cambia este archivo."

---

## LÍNEA 5: `tasf.data.path=C:/Users/Mathias/Documents/proyecto-pdds-main/backend/data`

### ¿Qué hace?
Es una **propiedad personalizada** (no es de Spring). Define la ruta absoluta a la
carpeta que contiene los 28 archivos `_envios_*.txt` y los archivos de aeropuertos y vuelos.

### ¿Cómo la usan los servicios?
```java
// En cualquier servicio que necesite acceder al filesystem:
@Value("${tasf.data.path}")
private String dataPath;

// Luego:
Path folder = Path.of(dataPath);  // C:/Users/.../backend/data
```
Los servicios que la inyectan:
- `EnvioService.java` — para cargar los `_envios_*.txt`
- `NumericExperimentService.java` — para calcular los niveles DOE
- `AeropuertoService.java` — para cargar el archivo de aeropuertos
- `VueloService.java` — para cargar el archivo de vuelos

### ¿Qué archivos hay en esa carpeta?
```
backend/data/
├── c.1inf54.26.1.v1.Aeropuerto.husos.v1.20250818__estudiantes.txt  ← ~200 aeropuertos
├── planes_vuelo.txt                                                  ← rutas aéreas
├── _envios_SKBO_.txt   (Bogotá)
├── _envios_LEMD_.txt   (Madrid)
├── _envios_OMDB_.txt   (Dubai)
├── _envios_VIDP_.txt   (Delhi)
├── ... (28 archivos en total)
└── _envios_SVMI_.txt   (Caracas)
```

### ¿Cómo cambiaría en un servidor?
```properties
# En servidor Linux/AWS EC2:
tasf.data.path=/opt/tasf/data

# En Docker:
tasf.data.path=/app/data
# (con volumen: docker run -v /host/data:/app/data ...)

# Con variable de entorno:
tasf.data.path=${TASF_DATA_PATH:/opt/tasf/data}
#                                  ↑
#                          valor por defecto si la variable no está definida
```

### ¿Qué decir en la exposición?
> "Esta propiedad es el punto de acoplamiento entre el código y el filesystem.
> Al tenerla externalizada aquí, si el dataset cambia de ubicación en el servidor,
> o si desplegamos en Docker con un volumen montado, solo cambiamos esta línea.
> En producción, la pondríamos como variable de entorno del contenedor para no
> hardcodear rutas absolutas."

---

## LO QUE NO ESTÁ EN EL ARCHIVO (pero Spring configura automáticamente)

Spring Boot Auto-configuration infiere estas propiedades si no las defines:

| Propiedad implícita | Valor por defecto | Qué hace |
|---|---|---|
| `spring.jpa.hibernate.ddl-auto` | `create-drop` con H2 | Crea las tablas al arrancar, las borra al apagar |
| `spring.jpa.show-sql` | `false` | No imprime las queries SQL (en dev se puede poner `true`) |
| `spring.security.user.password` | UUID generado | Contraseña random para el login de Spring Security |
| `server.port` | `8080` | Puerto del servidor Tomcat embebido |
| `spring.jpa.open-in-view` | `true` | Mantiene la sesión JPA abierta durante el rendering (genera warning) |

> "Spring Boot sigue el principio de 'convención sobre configuración'. El 90% de las
> propiedades tienen valores sensatos por defecto. Solo configuramos lo que es específico
> de nuestro sistema."

---

## FLUJO COMPLETO DE ARRANQUE (lo que ocurre al hacer `mvn spring-boot:run`)

```
1. Spring lee application.properties
   ├── Nombre: "backend"
   ├── Crea pool de conexiones HikariCP → jdbc:h2:mem:testdb
   └── Inyecta tasf.data.path en todos los @Value

2. Hibernate crea el schema automáticamente
   → CREATE TABLE aeropuertos (id BIGINT, icao_code VARCHAR UNIQUE, ...)
   → CREATE TABLE vuelos (id BIGINT, origen_id BIGINT, ...)
   → CREATE TABLE envios (id BIGINT, codigo_pedido VARCHAR, ...)
   → CREATE UNIQUE INDEX constraint_index_7 ON envios(codigo_pedido, origen_id)

3. DataInitializer.init() carga datos base
   → AeropuertoService.cargarDesdeArchivo("Aeropuerto.husos.txt") → ~200 aeropuertos
   → VueloService.cargarDesdeArchivo("planes_vuelo.txt")           → rutas aéreas
   → Envíos: DESACTIVADO (carga diferida bajo demanda)

4. Tomcat abre el puerto 8080
   → API REST lista en http://localhost:8080
   → Consola H2 lista en http://localhost:8080/h2-console

Tiempo total de arranque: ~3.2 segundos
```

---

## PREGUNTAS QUE PUEDE HACER EL PROFESOR

**P: "¿Por qué no usaron una BD real como PostgreSQL desde el principio?"**
> "H2 eliminó la necesidad de gestionar infraestructura durante el desarrollo. El equipo
> puede clonar el repo y levantar el backend sin instalar nada extra. La migración a
> PostgreSQL sería una sola línea en este archivo. Para el volumen del proyecto académico,
> H2 maneja perfectamente los ~2 millones de registros que generamos."

**P: "¿Qué pasa con los datos si el servidor se reinicia?"**
> "Se pierden, intencionalmente. El sistema siempre recarga desde los archivos `.txt`.
> Es una arquitectura 'stateless' a nivel de BD: los datos de verdad viven en los archivos,
> la BD es solo un caché de trabajo para las queries SQL durante la simulación."

**P: "¿Cómo escalarían a producción?"**
> "Tres cambios en este archivo: cambiar la URL a RDS PostgreSQL, agregar credenciales
> como variables de entorno, y apuntar `tasf.data.path` al volumen S3 montado.
> El código Java no cambia. Eso es el valor de la abstracción JPA."

**P: "¿Cómo habilitarían logs SQL para debuggear?"**
> "Agregaríamos `spring.jpa.show-sql=true` y `spring.jpa.properties.hibernate.format_sql=true`.
> Spring imprimiría cada query que Hibernate genera. Es útil para detectar el problema N+1."
