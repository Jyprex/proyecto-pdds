# Estándares de Programación y Arquitectura - React (JavaScript)

## 1. Filosofía Core

- **Clean Code:** Escribe código para que lo lean humanos, no solo máquinas.
- **Responsabilidad Única (SRP):** Un componente, un hook o una función debe hacer exactamente una cosa. Si un componente gestiona llamadas a la API, renderiza UI compleja y maneja estado global, debe dividirse.
- **Inmutabilidad:** El estado en React es sagrado. Nunca mutes objetos o arrays directamente. Usa `...spread`, `map`, `filter` o `reduce`.

## 2. Convenciones de Nomenclatura (Naming)

- **Componentes y Archivos:** Usa `PascalCase` para nombres de archivos de componentes y su declaración (`MiComponente.jsx`).
- **Hooks:** Usa `camelCase` y el prefijo `use` (`useCarrito.js`).
- **Funciones y Variables:** Usa `camelCase` con verbos de acción claros (`obtenerUsuarios`, `manejarClick`, `estaCargando`).
- **Constantes Globales:** Usa `UPPER_SNAKE_CASE` para valores fijos (`MAX_INTENTOS`, `API_URL`).
- **Eventos:** Prefija los handlers con `handle` (ej. `handleClick`) y los props de eventos con `on` (ej. `onClick`, `onSubmit`).

## 3. Estructura de Componentes

- **Solo Componentes Funcionales:** Prohibido el uso de componentes de clase. Usa `arrow functions`.
- **Estructura Interna:** Ordena el código dentro del componente de forma lógica:
  1. Hooks de estado (`useState`, `useReducer`).
  2. Hooks de contexto (`useContext`).
  3. Refs (`useRef`).
  4. Efectos secundarios (`useEffect`).
  5. Funciones auxiliares / Handlers.
  6. Return (JSX).
- **Early Returns:** Evita la anidación profunda. Devuelve los estados de carga o error antes de la lógica principal.

  ```javascript
  // ❌ Mal
  if (!loading) {
    if (data) {
      return <Vista data={data} />;
    }
  } else {
    return <Loader />;
  }

  // ✅ Bien
  if (loading) return <Loader />;
  if (error) return <ErrorMessage error={error} />;
  return <Vista data={data} />;
  ```
