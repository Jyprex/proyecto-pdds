# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react-swc/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Backend API

- En desarrollo, este proyecto usa el proxy de Vite definido en `vite.config.js`:
  - Requests a `/api/**` se redirigen a `http://localhost:8080`
  - Por eso el frontend debe llamar rutas relativas como `/api/v1/...`

- Para despliegue con backend en otro origen (dominio/puerto distinto), configura:

  `VITE_API_ORIGIN=https://mi-backend` (sin slash final)

  El helper `src/hooks/api.js` genera URLs como `${VITE_API_ORIGIN}/api/v1/...`.
