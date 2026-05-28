// API helper para centralizar el origen del backend.
// En dev, dejar VITE_API_ORIGIN vacío para usar el proxy de Vite (/api -> localhost:8080).
// En despliegue separado, setear VITE_API_ORIGIN (ej: https://api.mi-dominio.com).

const normalizeOrigin = (origin = "") => {
  const trimmed = String(origin).trim();
  if (!trimmed) return "";
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
};

export const API_ORIGIN = normalizeOrigin(import.meta.env.VITE_API_ORIGIN);

export const apiUrl = (path = "") => {
  const p = String(path).startsWith("/") ? String(path) : `/${path}`;
  return `${API_ORIGIN}${p}`;
};

export const apiFetch = (path, options) => fetch(apiUrl(path), options);
