# Registros de Implementación: Registrar Envío

Se ha implementado con éxito la funcionalidad de "Registrar envío" como una página independiente, permitiendo a los usuarios autorizados ingresar nuevos pedidos de manera manual o mediante la carga de archivos CSV.

## Cambios Realizados

### Backend
1.  **DTO `UserEnvioRequest`:** Creado para estructurar los datos de entrada del usuario (fecha, hora, origen, destino, maletas, cliente).
2.  **`EnvioService`:** 
    -   `registrarManual`: Valida aeropuertos, genera un código aleatorio de **9 dígitos** y persiste el envío.
    -   `registrarLoteUsuario`: Procesa líneas de un CSV, valida aeropuertos en lote y genera códigos de 9 dígitos para cada entrada.
3.  **`EnvioController`:** 
    -   `POST /api/v1/envios/manual`: Endpoint para registro individual.
    -   `POST /api/v1/envios/archivo`: Endpoint para carga masiva de archivos del usuario.

### Frontend
1.  **Página `ShipmentRegistrationPage.jsx`:** 
    -   Nueva interfaz moderna y coherente con el estilo del sistema.
    -   Formulario reactivo para ingreso manual con selectores de aeropuertos.
    -   Zona de carga de archivos CSV con validación visual.
    -   Botón de retorno rápido al Centro de Control.
2.  **Ruteo:** Integración en `main.jsx` con la ruta `/registrar-envio`.
3.  **Header:** Agregado el botón **📥 Registrar envío** en el `ScenarioHeader`, ubicado estratégicamente a la izquierda de las pestañas de operación.

## Instrucciones de Uso

### Registro Manual
- Navegar a "Registrar envío".
- Completar los campos requeridos (Fecha, Hora, Origen, Destino, Maletas, Cliente ID).
- Presionar "Confirmar y Registrar Envío".

### Carga Masiva
- El archivo debe ser un CSV sin cabeceras.
- Formato por línea: `AAAA-MM-DD, HH:mm, ORIGEN_ICAO, DESTINO_ICAO, CANTIDAD, CLIENTE_ID`
- Ejemplo: `2026-06-15, 14:30, SKBO, EDDI, 5, 1234567`

## Notas de Arquitectura
- No se han modificado ni eliminado funciones existentes de carga de datos maestros.
- Los nuevos métodos son totalmente independientes, asegurando que el sistema actual permanezca íntegro y estable.
- El código de pedido de 9 dígitos se genera exclusivamente para estos ingresos de usuario para evitar colisiones con los códigos de 7 dígitos de los archivos de sistema.
