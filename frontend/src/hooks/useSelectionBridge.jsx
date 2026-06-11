import { createContext, useCallback, useContext, useRef, useState } from 'react';

/**
 * SelectionBridge — Puente de estado compartido entre Panel y Mapa.
 *
 * Centraliza:
 * 1. focusedEntity      → Entidad seleccionada (vuelo, aeropuerto o envío)
 * 2. mapCommand         → Instrucción reactiva para el mapa (flyTo, highlight, drawRoute)
 * 3. trackedRoute       → Ruta multi-hop para Track & Trace de una maleta/envío
 * 4. exceptionHighlight → Bloqueo/avería enfocada con su overlay visual
 * 5. activeFilters      → Filtros por semáforo que Panel y Mapa comparten
 */

const SelectionBridgeContext = createContext(null);

export const SelectionBridgeProvider = ({ children }) => {
  // ── 1. Entidad enfocada ──────────────────────────────────────────────────
  const [focusedEntity, setFocusedEntityRaw] = useState(null);
  // { type: 'airport'|'flight'|'shipment', id: string, source: 'panel'|'map' }

  const setFocusedEntity = useCallback((type, id, source = 'panel') => {
    setFocusedEntityRaw({ type, id, source, ts: Date.now() });
  }, []);

  const clearFocusedEntity = useCallback(() => {
    setFocusedEntityRaw(null);
  }, []);

  // ── 2. Comando para el mapa ──────────────────────────────────────────────
  const [mapCommand, setMapCommandRaw] = useState(null);
  // { action: 'flyTo'|'highlight', payload: { coordinates, zoom, targetId, type, from, to }, ts }

  const dispatchMapCommand = useCallback((action, payload = {}) => {
    setMapCommandRaw({ action, payload, ts: Date.now() });
  }, []);

  const clearMapCommand = useCallback(() => {
    setMapCommandRaw(null);
  }, []);

  // ── 3. Track & Trace (ruta multi-hop) ────────────────────────────────────
  const [trackedRoute, setTrackedRoute] = useState(null);
  // { shipmentId: string, hops: [{ from, to, flightId, status }] }

  const clearTrackedRoute = useCallback(() => {
    setTrackedRoute(null);
  }, []);

  // ── 4. Highlight de excepciones ──────────────────────────────────────────
  const [exceptionHighlight, setExceptionHighlight] = useState(null);
  // { type: 'TRAMO'|'NODO'|'AVERIA', origenIcao, destinoIcao?, averiaType?, ts }

  const clearExceptionHighlight = useCallback(() => {
    setExceptionHighlight(null);
  }, []);

  // ── 5. Filtros visuales por semáforo ─────────────────────────────────────
  const [activeFilters, setActiveFilters] = useState({
    semaphoreLevel: null, // null = todos, 'green', 'amber', 'red'
    flightStatus: null,   // null = todos, 'normal', 'critical', 'rescued', 'cancelled'
  });

  const resetFilters = useCallback(() => {
    setActiveFilters({ semaphoreLevel: null, flightStatus: null });
  }, []);

  const value = {
    // 1. Focused Entity
    focusedEntity,
    setFocusedEntity,
    clearFocusedEntity,
    // 2. Map Command
    mapCommand,
    dispatchMapCommand,
    clearMapCommand,
    // 3. Track & Trace
    trackedRoute,
    setTrackedRoute,
    clearTrackedRoute,
    // 4. Exception Highlight
    exceptionHighlight,
    setExceptionHighlight,
    clearExceptionHighlight,
    // 5. Visual Filters
    activeFilters,
    setActiveFilters,
    resetFilters,
  };

  return (
    <SelectionBridgeContext.Provider value={value}>
      {children}
    </SelectionBridgeContext.Provider>
  );
};

/**
 * Hook para consumir el bridge desde cualquier componente.
 * Lanza error si se usa fuera del Provider.
 */
export const useSelectionBridge = () => {
  const ctx = useContext(SelectionBridgeContext);
  if (!ctx) {
    throw new Error('useSelectionBridge debe usarse dentro de <SelectionBridgeProvider>');
  }
  return ctx;
};
