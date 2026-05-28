# Guion de exposición (2:50)

Notas (no leer):
- Duración objetivo: ~2:50 si se lee el texto entre marcadores a tu ritmo (calibrado por conteo de palabras).
- Intención comunicativa: describir y demostrar (mantenerlo explícito todo el guion).
- Apoyo visual: cuando digas “primera/segunda/tercera lámina”, señala la slide correspondiente.
- Voz/gesto (sugerencias):
	- Enfatiza “Ta < Sa” y “Score” con una pausa breve.
	- Al decir “Super‑Lotes”, abre las manos (gesto de agrupar).
	- Al nombrar “HGA” y “ALNS”, alterna mirada entre jurado y público.
	- En “replanificación”, acompaña con gesto de “quitar y volver a poner” (destroy/repair).

<!-- START_READ -->
Mi intención comunicativa es describir y demostrar cómo el prototipo Tasf.B2B planifica y replanifica el traslado de maletas extraviadas entre aeropuertos. El SLA es 24h mismo continente y 48h entre continentes.

Primera lámina: experimento y función objetivo. Usamos planificación programada: el planificador corre cada salto Sa, y buscamos estabilidad cumpliendo Ta < Sa, donde Ta es el tiempo real de ejecución. Para acelerar la simulación usamos K, y el salto consumido es Sc = K×Sa. El diseño experimental tiene cinco niveles de carga y diez iteraciones independientes por nivel.
Primera lámina: experimento y función objetivo. Usamos planificación programada: el planificador corre cada salto Sa, y buscamos estabilidad cumpliendo Ta < Sa, donde Ta es el tiempo real de ejecución. El diseño experimental tiene cinco niveles de carga y diez iteraciones independientes por nivel.

Medimos KPIs logísticos como Cumplimiento %, Ocupación %, Lead Time (h) y Saturación de Aeropuertos %, y también KPIs de infraestructura como tiempo de planificación y simulación en milisegundos, CPU % y memoria en MB. Todo se integra en el Score: 10×A − 0.005×Ecap − 2×Dh − 12×Saero. A es rutas atendidas, Ecap es exceso de demanda no cubierta, Dh es retraso en horas y Saero es la saturación de almacenes.

En el código, las atendidas se acumulan desde rutas con capacidad asignada. Con eso se calcula Cumplimiento como atendidas sobre total, y Ocupación como atendidas sobre la capacidad diaria de aviones. El Lead Time se deriva del retraso entre tiempos de ruta y disponibilidad del lote, y Saero viene del estado de simulación.

Segunda lámina: reducción del espacio de búsqueda. En lugar de enrutar cada maleta, agrupamos en Super‑Lotes por origen, destino y rango de SLA. Así evitamos la explosión combinatoria del VRP. En máximo estrés, los resultados muestran 34,849 maletas procesadas y 861 rutas, lo que hace viable ejecutar la planificación.

Tercera lámina: algoritmos y replanificación. Implementamos dos metaheurísticas en Java: HGA y ALNS. En ALNS usamos destroy y repair con recocido simulado. Ante una cancelación, el backend ofrece replanificación: se destruyen los lotes cuya ruta contiene el vuelo cancelado, se reparan filtrando por capacidad disponible, y luego se aplica un segundo filtro de conflictos de capacidad.

En ALNS, esto se implementa con 3 operadores de destrucción y 2 de reparación: AffectedByFlightDestroyOp, RelatedDestroyOp y WorstDestroyOp; y GreedyRepairOp y RegretRepairOp. La selección se ajusta con pesos adaptativos.

Con esto generamos rutas y un Excel para comparar HGA versus ALNS.
<!-- END_READ -->
