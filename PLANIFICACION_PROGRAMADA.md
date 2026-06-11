# PLANIFICACION PROGRAMADA

## QUE ES

La planificacion de los pedidos-rutas se realiza cada cierto tiempo fijo, por ejemplo cada 5,10 o 15 minutos; independiente de otros aspectos/condiciones del negocio

## CONCEPTOS CLAVES

- Tiempo de ejecuion del algoritmo (Ta):
  Tiempo que demora ejecutar toda la plnificacion de los pedidos-rutas. Este tiempo varia por la cantidad de datos a procesar. No es lo mismo planificar con 5 pedidos que hacerlo con 10000 pedidos.
  Nota: El ta puede variar en el tiempo, en funcion al volumen de pedido, por lo que deberia determinar entre que rangos se mueve este valor para volumenes pequeños hasta mas grandes (los cercanos al colapso logistico).
- Salto del algoritmo (Sa):
  Tiempo que transcurre entre ejecucion y ejecucion.
  Nota:
  - Se debe fijar este valor de Sa.
  - Si fija Sa muy grande, la probablidad del colapso es muy alta.
  - Si fija Sa grande la probablidad del colapso es alta.
  - Si Sa muy pequeño, esto significa que cada vez que se lance (inicie) la ejecicion de la planificacion, aun no ha concluido la anterior, generando un conflicto en la operacion del software y potencialmente una caida de la solucion.
  - Si se fija Sa "ligeramente superior a Ta", puede ocurrir que eso que denomina "ligeramente" no sea suficiente en algun momento futuro... Cuando haya más pedidos que procesar.
- Constante de proporcionalidad del tiempo (K):
  Permite acelerar la simulacion. Depende mucho de los algoritmos que se tengan.
- Salto de consumo (Sc):
  Salto de tiempo que se va a consumir en paralelo al Sa.
  Formula:
  Sc = K\*Sa
