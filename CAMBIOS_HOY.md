# 📋 Cambios del día — 14 de Mayo 2026
**TASF.B2B · Grupo 4D**

---

## Mathias Medina — Infraestructura y Datos

### ✅ Backend: Manejo de duplicados sin colapso de sesión JPA
- **Problema:** Al correr la simulación por segunda vez sin reiniciar el servidor, Hibernate lanzaba `HHH000099 AssertionFailure` al intentar insertar envíos ya existentes.
- **Solución:** Se agregó un pre-filtro en `EnvioService.cargarDesdeLineasArchivo()` que consulta los códigos ya existentes en BD antes de insertar, evitando que la sesión JPA se corrompa.
- **Archivos:** `EnvioService.java`, `EnvioRepository.java`

### ✅ Frontend: Selector de fecha en escenario Día a Día
- Se añadió un date picker en el panel `DayToDayConfig` con fecha de hoy por defecto, atajos "Ayer / Hoy" y visualización de la fecha seleccionada en grande.
- Color del input corregido (texto negro sobre fondo claro).
- **Archivo:** `DayToDayConfig.jsx`

### ✅ Frontend: Panel de resumen de métricas en Día a Día
- Se añade automáticamente cuando hay una simulación activa: muestra vuelos activos, SLA cumplido, maletas atendidas/perdidas, nodos críticos, ocupación global y barra de progreso.
- **Archivo:** `DayToDayConfig.jsx`

### ✅ Documentación técnica generada
- `ESTRUCTURA_DEL_PROYECTO.md` — arquitectura completa del sistema
- `MATHIAS_PRESENTACION_TECNICA.md` — detalle función por función de los 3 archivos del rol
- `MATHIAS_APPLICATION_PROPERTIES.md` — guía de presentación del `application.properties`

---

## Cambios técnicos en código (resumen rápido)

| Archivo | Cambio |
|---|---|
| `EnvioRepository.java` | Nueva query `findCodigosByOrigenIcao()` |
| `EnvioService.java` | Pre-filtro anti-duplicados con `Set<String> existentes` |
| `DayToDayConfig.jsx` | Date picker + resumen de métricas + fix color input |
| `NumericExperimentService.java` | Limpieza de comentarios de sección |
