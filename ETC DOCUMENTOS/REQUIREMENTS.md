## REQUIREMENTS

Agrupador
ID
Descripción
Dificultad
Prioridad
RT
Comentarios
M1 - Gestión de clientes
R-001
El sistema debe permitir registrar, consultar, actualizar y desactivar las aerolíneas que contratan el servicio
Baja
Exigibles
Pendiente

M7 - Visualización
R-002
El sistema debe permitir configurar las variables de inicio de los dos algoritmos matemáticos (por ejemplo, tamaño de población o tasa de mutación si se usa un Algoritmo Genético) antes de ejecutar las simulaciones.
Baja
Exigibles
Pendiente

M7 - Visualización
R-003
El sistema debe permitir seleccionar qué algoritmo metaheurístico (Opción A u Opción B) se utilizará para calcular el plan de viaje durante una sesión de simulación.
Baja
Exigibles
Pendiente

M6 - Gestión de vuelos y flota
R-004
El sistema debe permitir filtrar el monitoreo gráfico para visualizar las operaciones enfocadas exclusivamente en un continente específico (América, Asia o Europa).
Baja
Exigibles
Pendiente

M6 - Gestión de vuelos y flota
R-005
El sistema debe registrar en la bitácora el tiempo exacto de simulación y el nodo específico (aeropuerto o vuelo) que excedió su capacidad máxima en primer lugar.
Baja
Exigibles
Pendiente

M7 - Visualización
R-006
El sistema debe permitir exportar los resultados comparativos (tiempos de ejecución y rutas generadas) de ambos algoritmos metaheurísticos a un archivo plano o de reporte.
Baja
Exigibles
Pendiente

M1 - Gestión de clientes
R-029
El sistema debe permitir crear un usuario.
Baja
Deseables
Pendiente

M5 - Gestión de infraestructura logística
R-030
El sistema debe mantener un registro histórico que relacione el itinerario original de una maleta afectada por cancelación y el nuevo itinerario asignado por el planificador.
Baja
Deseables
Pendiente

M2 - Gestión de envíos
R-007
El sistema debe validar que una aerolínea se encuentra activa o registrada antes de registrar envíos.
Baja
Exigibles
Pendiente

M2 - Gestión de envíos
R-008
El sistema debe registrar un envío con origen, destino, cantidad de maletas y aerolínea ligada.
Baja
Exigibles
Pendiente

M2 - Gestión de envíos
R-009
El sistema debe asignar un identificador único a cada envío.
Baja
Exigibles
Pendiente

M2 - Gestión de envíos
R-010
El sistema debe asignar un identificador único a cada maleta.
Baja
Exigibles
Pendiente

M2 - Gestión de envíos
R-011
El sistema debe relacionar cada maleta con el envío respectivo.
Baja
Exigibles
Pendiente

M2 - Gestión de envíos
R-012
El sistema debe validar el rango de maletas disponibles para los envíos.
Baja
Exigibles
Pendiente

M2 - Gestión de envíos
R-013
El sistema debe poder modificar un envío en caso de cambio de lugar de destino de la maleta.
Media
Exigibles
Pendiente

M2 - Gestión de envíos
R-014
El sistema debe poder enviar las maletas en sub-lotes en caso no haya suficiente almacenamiento.
Media
Exigibles
Pendiente

M2 - Gestión de envíos
R-015
El sistema debe poder cancelar envío.
Baja
Exigibles
Pendiente

M2 - Gestión de envíos
R-016
El sistema debe mostrar el estado del envío en todo momento. (pendiente, en tránsito, recepcionado, entregado).
Baja
Exigibles
Pendiente

M2 - Gestión de envíos
R-017
El sistema debe calcular tiempo estimado de entrega.
Media
Deseables
Pendiente

M2 - Gestión de envíos
R-032
El sistema debe generar y almacenar un plan de viaje estructurado por cada maleta, detallando los aeropuertos por los que pasará.
Media
Exigibles
Pendiente

M2 - Gestión de envíos
R-033
El sistema debe notificar la ocurrencia de un vuelo cancelado y presentar el consolidado de la cantidad de maletas que requieren ser replanificadas.
Baja
Exigibles
Pendiente

M2 - Gestión de envíos
R-034
El sistema debe permitir simular la llegada de maletas en intervalos de tiempo aleatorios para el escenario de tiempo teal.
Media
Exigibles
Pendiente

M2 - Gestión de envíos
R-035
El sistema debe asignar un estado rojo a maletas que superen el 95% del plazo o que ya estén retrasadas.
Baja
Exigibles
Pendiente

M2 - Gestión de envíos
R-076
El sistema debe permitir cargar la lista de paquetes y almacenes desde un archivo de texto para facilitar el escenario de "colapso logístico"
Baja
Exigibles
Pendiente

M2 - Gestión de envíos
R-077
El sistema debe permitir definir la tasa acelerada de ingreso de equipaje para preparar la simulación de estrés operativo.
Baja
Exigibles
Pendiente

M6 - Gestión de vuelos y flota
R-079
El sistema debe marcar y reportar aquellas maletas cuya ruta planificada superó el SLA establecido (1 día mismo continente, 2 días distinto continente) debido a saturación de la red.
Baja
Exigibles
Pendiente

M2 - Gestión de envíos
R-092
El sistema debe generar y exportar el "plan de viaje" detallado para cada maleta o grupo de maletas ingresado.
Baja
Exigibles
Pendiente

M3 - Planificador de rutas
R-026
El planificador debe detectar vuelos cancelados y disparar automáticamente el proceso de re-planificación para maletas afectadas.
Alta
Exigibles
Pendiente

M3 - Planificador de rutas
R-027
El sistema debe registrar un log detallado de cada decisión de enrutamiento para fines de auditoría y experimentación.
Media
Exigibles
Pendiente

M3 - Planificador de rutas
R-028
El planificador debe generar una "ruta de respaldo" automática para envíos de alta prioridad.
Alta
Deseables
Pendiente

M3 - Planificador de rutas
R-081
El sistema debe asignar automáticamente los paquetes pendientes a los aviones disponibles que tengan capacidad suficiente.
Media
Exigibles
Pendiente

M3 - Planificador de rutas
R-082
El sistema debe trazar una ruta de entrega para cada avión utilizando una heurística sencilla (ej. ir siempre al punto de entrega más cercano desde la posición actual).
Media
Exigibles
Pendiente

M3 - Planificador de rutas
R-084
Si ingresa un "paquete urgente" durante la operación, el sistema debe asignarlo al avión en tránsito más cercano que tenga capacidad y recalcular su ruta.
Media
Exigibles
Pendiente

M3 - Planificador de rutas
R-089
Implementar un primer algoritmo metaheurístico en Java (ej. Algoritmo Genético) para encontrar rutas óptimas que minimicen el tiempo o los recursos.
Alta
Exigibles
Pendiente

M3 - Planificador de rutas
R-090
Implementar un segundo algoritmo metaheurístico en Java para contrastar resultados en la experimentación.
Alta
Exigibles
Pendiente

M3 - Planificador de rutas
R-091
Ante la cancelación de un vuelo, el sistema debe reasignar automáticamente las maletas afectadas a nuevos vuelos cumpliendo las restricciones originales.
Alta
Exigibles
Pendiente

M3 - Planificador de rutas
R-095
El planificador debe garantizar que las rutas propuestas cumplan el plazo máximo de 1 día (mismo continente) o 2 días (distinto continente).
Media
Exigibles
Pendiente

M4 - Monitoreo
R-036
El sistema deberá poder reiniciarse desde el principio en caso de un cierre inesperado en las simulaciones.
Media
Exigibles
Pendiente

M4 - Monitoreo
R-042
El sistema debe generar un listado de todas las maletas que superaron las 24h/48h.
Baja
Exigibles
Pendiente

M4 - Monitoreo
R-051
El sistema permitirá seleccionar "Terminar" para detener la simulación de periodo (3, 5 o 7 días).
Baja
Exigibles
Pendiente

M4 - Monitoreo
R-052
El sistema permitirá mostrar el tiempo transcurrido en la simulación de periodo
Baja
Exigibles
Pendiente

M4 - Monitoreo
R-053
El sistema visualizará la fecha y hora simulada del traslado de las maletas durante los 3,5 o 7 días.
Baja
Exigibles
Pendiente

M4 - Monitoreo
R-054
El sistema permitirá mostrar la fecha transcurrida en la simulación de periodo.
Media
Exigibles
Pendiente

M4 - Monitoreo
R-055
El sistema permitirá seleccionar una fecha de inicio en la simulación hasta el colapso.
Baja
Exigibles
Pendiente

M4 - Monitoreo
R-056
El sistema mostrará un indicador visual de carga "Cargando" durante la ejecución del metaheurístico de colapso.
Baja
Exigibles
Pendiente

M4 - Monitoreo
R-057
El sistema permitirá seleccionar "Terminar" para detener la simulación hasta el colapso.
Baja
Exigibles
Pendiente

M4 - Monitoreo
R-058
El sistema permitirá mostrar el tiempo transcurrido en la simulación hasta el colapso.
Baja
Exigibles
Pendiente

M4 - Monitoreo
R-059
El sistema permitirá mostrar la fecha transcurrida en la simulación hasta el colapso.
Baja
Exigibles
Pendiente

M4 - Monitoreo
R-060
El sistema deberá calcular el tiempo de ejecución de la simulación hasta el punto de saturación de maletas.
Media
Exigibles
Pendiente

M4 - Monitoreo
R-061
El sistema debe permitir definir la tasa acelerada de ingreso de equipaje para preparar la simulación de estrés operativo.
Baja
Exigibles
Pendiente

M4 - Monitoreo
R-062
El sistema debe permitir definir la tasa acelerada de ingreso de equipaje para preparar la simulación de estrés operativo..
Baja
Deseables
Pendiente

M4 - Monitoreo
R-063
El sistema debe permitir definir la tasa acelerada de ingreso de equipaje para preparar la simulación de estrés operativo.
Baja
Deseables
Pendiente

M4 - Monitoreo
R-069
El sistema permitirá filtrar los envíos de maletas que están en operación en tiempo real.
Media
Deseables
Pendiente

M4 - Monitoreo
R-070
El sistema permitirá seleccionar y visualizar en tiempo real el seguimiento de envíos específicos.
Media
Exigibles
Pendiente

M4 - Monitoreo
R-072
El sistema permitirá mostrar el tiempo transcurrido en las operaciones día a día.
Baja
Deseables
Pendiente

M4 - Monitoreo
R-073
El sistema permitirá mostrar la fecha transcurrida en las operaciones sincronizada con cada aeropuerto
Baja
Exigibles
Pendiente

M4 - Monitoreo
R-085
El sistema debe permitir simular el bloqueo de una ruta o avería, forzando al avión afectado a detenerse.
Media
Deseables
Pendiente

M4 - Monitoreo
R-094
El algoritmo debe asegurar que en ningún momento se exceda la capacidad del vuelo asignado ni la del almacén del aeropuerto de escala/destino
Media
Exigibles
Pendiente

M4 - Monitoreo
R-097
El sistema debe permitir configurar mediante parámetros los umbrales numéricos (porcentajes) que disparan los colores verde, ámbar y rojo para el monitoreo.
Baja
Exigibles
Pendiente

M5 - Gestión de infraestructura logística
R-018
El sistema debe registrar un aeropuerto por país, ciudad y continente.
Baja
Exigibles
Pendiente

M5 - Gestión de infraestructura logística
R-019
El sistema debe validar el registro de un aeropuerto por ciudad.
Baja
Exigibles
Pendiente

M5 - Gestión de infraestructura logística
R-020
El sistema debe poder editar los datos del aeropuerto.
Baja
Exigibles
Pendiente

M5 - Gestión de infraestructura logística
R-021
El sistema debe poder listar los aeropuertos por continente.
Baja
Exigibles
Pendiente

M5 - Gestión de infraestructura logística
R-022
El sistema debe poder consultar vuelos por aeropuertos.
Baja
Exigibles
Pendiente

M5 - Gestión de infraestructura logística
R-031
El sistema debe validar que cada envío solo utilice un aeropuerto por ciudad, según la política de la empresa.
Baja
Exigibles
Pendiente

M5 - Gestión de infraestructura logística
R-044
El sistema debe emitir una alerta visual cuando un almacén supere el 90% de su capacidad.
Baja
Exigibles
Pendiente

M5 - Gestión de infraestructura logística
R-080
El sistema debe permitir configurar un tiempo constante (ej. 5 minutos virtuales) para las operaciones de carga en origen y descarga en destino.
Baja
Exigibles
Pendiente

M5 - Gestión de infraestructura logística
R-100
El sistema debe permitir registrar aeropuertos en América, Asia y Europa, configurando su capacidad máxima de almacenamiento (entre 500 y 800 maletas).
Baja
Exigibles
Pendiente

M6 - Gestión de vuelos y flota
R-023
El sistema debe registrar vuelos con origen y destino.
Baja
Exigibles
Pendiente

M6 - Gestión de vuelos y flota
R-024
El sistema debe poder registrar cancelación de vuelo.
Baja
Exigibles
Pendiente

M6 - Gestión de vuelos y flota
R-025
El sistema debe registrar la capacidad de almacenamiento de cada avión.
Baja
Exigibles
Pendiente

M6 - Gestión de vuelos y flota
R-078
El sistema debe validar que la cantidad de maletas asignadas a un vuelo específico no exceda su límite establecido (rango de 150 a 400 maletas, dependiendo del tipo de ruta).
Baja
Exigibles
Pendiente

M6 - Gestión de vuelos y flota
R-096
El sistema debe permitir la carga (manual o mediante archivo) de eventos de cancelación de vuelos para forzar la replanificación.
Media
Exigibles
Pendiente

M6 - Gestión de vuelos y flota
R-098
El sistema debe registrar las solicitudes de las aerolíneas cliente, indicando cantidad de maletas estandarizadas, aeropuerto de origen y aeropuerto destino.
Baja
Exigibles
Pendiente

M6 - Gestión de vuelos y flota
R-099
El sistema debe permitir registrar itinerarios de vuelos, definiendo origen, destino, y capacidad (150-250 para mismo continente; 150-400 intercontinental).
Baja
Exigibles
Pendiente

M7 - Visualización
R-037
El sistema debe mostrar el plan de viaje detallado de una maleta al hacer clic en su identificador dentro de la interfaz.
Baja
Exigibles
Pendiente

M7 - Visualización
R-038
El sistema permitirá realizar zoom en los diferentes mapas.
Media
Deseables
Pendiente

M7 - Visualización
R-039
El sistema deberá mostrar un gráfico de barras que represente la cantidad de paquetes enviados por mes.
Baja
Exigibles
Pendiente

M7 - Visualización
R-040
El sistema deberá mostrar un gráfico circular (tipo pastel) que visualice la proporción de entregas realizadas: a tiempo, con retraso o no entregadas
Media
Deseables
Pendiente

M7 - Visualización
R-041
El sistema debe asignar un estado ámbar a maletas con tiempo de entrega proyectado entre 70% y 95% del plazo máximo.
Baja
Exigibles
Pendiente

M7 - Visualización
R-043
El sistema debe mostrar el porcentaje de carga ocupada de cada avión antes de su salida simulada.
Baja
Exigibles
Pendiente

M7 - Visualización
R-045
El sistema debe presentar un panel lateral con el conteo total de maletas actualmente en tránsito separadas por continente.
Baja
Exigibles
Pendiente

M7 - Visualización
R-050
El sistema debe aplicar la configuración de colores de semáforo (verde, ámbar y rojo) directamente sobre aeropuertos en el mapa interactivo, reflejando su nivel de capacidad física actual respecto a su límite
Media
Exigibles
Pendiente

M7 - Visualización
R-064
El sistema mostrará información del avión en periodo: código, ruta, maletas, GPS y capacidad (150-400).
Media
Exigibles
Pendiente

M7 - Visualización
R-065
El sistema mostrará información del avión en colapso: código, ruta, maletas, GPS y capacidad máxima superada.
Media
Exigibles
Pendiente

M7 - Visualización
R-066
El sistema mostrará información del almacén en periodo: código, maletas, capacidad (500-800) y ciudad.
Media
Exigibles
Pendiente

M7 - Visualización
R-067
El sistema mostrará información del almacén en colapso: código, maletas, capacidad y estado de saturación.
Media
Exigibles
Pendiente

M7 - Visualización
R-068
El sistema mostrará información de envíos: ID, vuelo, maleta, ruta, fecha estimada y estado de entrega.
Media
Exigibles
Pendiente

M7 - Visualización
R-071
El sistema permitirá mostrar un mapa interactivo en las operaciones en tiempo real.
Alta
Exigibles
Pendiente

M7 - Visualización
R-074
El sistema permitirá mostrar la cantidad de aviones activos en las operaciones en tiempo real.
Media
Deseables
Pendiente

M7 - Visualización
R-075
El sistema permitirá mostrar la cantidad de almacenes operativos en las ciudades de América, Asia y Europa
Media
Deseables
Pendiente

M7 - Visualización
R-083
El sistema debe calcular el tiempo estimado de llegada a cada punto basándose en la distancia en línea recta y una velocidad constante del avión.
Baja
Exigibles
Pendiente

M7 - Visualización
R-086
El sistema debe poseer un reloj interno que gestione el avance del tiempo en la simulación (independiente del reloj del sistema operativo).
Media
Exigibles
Pendiente

M7 - Visualización
R-087
El sistema debe poder ejecutarse a velocidad normal, donde 1 segundo de simulación equivale a 1 segundo real, mostrando el flujo continuo.
Baja
Exigibles
Pendiente

M7 - Visualización
R-088
El sistema debe procesar un volumen de datos correspondiente a 7 días en un lapso corto (ej. pocos minutos), mostrando gráficamente el proceso a alta velocidad.
Media
Exigibles
Pendiente

M7 - Visualización
R-093
El backend debe contar con un motor de tiempo independiente que actualice el estado de los vuelos (0.5 días local, 1 día intercontinental).
Media
Exigibles
Pendiente

M8 - Funcionalidad
R-046
El sistema debe mostrar una tabla comparativa final entre el Algoritmo 1 y el Algoritmo 2, basada en el tiempo de ejecución y maletas entregadas a tiempo.
Alta
Exigibles
Pendiente

M6 - Gestión de vuelos y flota
R-047
El sistema debe permitir la inyección de múltiples cancelaciones de vuelos simultáneas mediante la carga de un archivo, para evaluar la respuesta en estrés del componente planificador.
Baja
Exigibles
Pendiente

M8 - Funcionalidad
R-048
El sistema debe mostrar el avance de la simulación con una barra de progreso.
Baja
Deseables
Pendiente

M8 - Funcionalidad
R-049
El sistema debe calcular porcentaje de entregas realizadas dentro del plazo.
Baja
Exigibles
Pendiente
