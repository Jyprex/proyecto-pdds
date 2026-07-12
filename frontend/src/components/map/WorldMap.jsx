import React, { useRef, useEffect, useState, useCallback, useMemo } from "react";
import DeckGL from "@deck.gl/react";
import Map from "react-map-gl/maplibre";
import 'maplibre-gl/dist/maplibre-gl.css';

import { WebMercatorViewport } from "@deck.gl/core";
import { useSelectionBridge } from "../../hooks/useSelectionBridge";
import { AIRPORTS, AIRPORT_BY_ICAO } from "../../data/airportsData";

function getFitViewState(width = 1200, height = 800) {
  const bounds = AIRPORTS.reduce((acc, ap) => {
    const [lng, lat] = ap.coordinates
    return {
      minLng: Math.min(acc.minLng, lng),
      maxLng: Math.max(acc.maxLng, lng),
      minLat: Math.min(acc.minLat, lat),
      maxLat: Math.max(acc.maxLat, lat),
    }
  }, { minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity })
  const padding = Math.min(width, height) * 0.12
  const viewport = new WebMercatorViewport({ width, height })
  const { longitude, latitude, zoom } = viewport.fitBounds(
    [[bounds.minLng, bounds.minLat], [bounds.maxLng, bounds.maxLat]],
    { padding }
  )
  return { longitude, latitude, zoom }
}

import { createAirportsLayers } from "./layers/AirportsLayer";
import { createFlightsLayer } from "./layers/FlightsLayer";
import { createRoutesLayers } from "./layers/RoutesLayer";
import { getStraightPath } from "./layers/utils";

const LEGEND_ITEMS = [
  { color: '#10b981', label: 'Nodo Estable (<70%)' },
  { color: '#f59e0b', label: 'Saturación Media (70-90%)' },
  { color: '#ef4444', label: 'Saturación Crítica (>90%)' },
  { color: '#3b82f6', label: 'Vuelo / UT en curso' },
  { color: '#f97316', label: 'Vuelo Crítico (carga alta)' },
  { color: '#6b7280', label: 'Cancelado' },
  { color: '#818cf8', label: 'Rescatado (ALNS)' },
  { color: 'rgba(255,255,255,0.25)', label: 'Completado (fade-out)' },
  { color: '#a78bfa', label: 'Ruta rastreada (Track & Trace)', style: 'dashed' },
];

const LegendButton = () => {
  const [visible, setVisible] = useState(false);
  return (
    <div style={{ position: 'absolute', bottom: 36, left: 62, zIndex: 200 }}>
      <button
        className="map-legend-btn"
        style={{ position: 'static' }}
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onClick={() => setVisible(v => !v)}
        onFocus={() => setVisible(true)}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setVisible(false) }}
        aria-label="Ver leyenda del mapa"
        aria-expanded={visible}
        title="Leyenda"
      >
        ⓘ
      </button>
      {visible && (
        <div className="map-legend-popup" role="region" aria-label="Leyenda del mapa" style={{ bottom: 40, left: 0 }}>
          <p>Leyenda Operativa</p>
          {LEGEND_ITEMS.map(item => (
            <div key={item.label} className="legend-row">
              <span className="legend-dot" style={{ background: item.color, borderStyle: item.style === 'dashed' ? 'dashed' : 'solid' }} />
              {item.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const MapZoomControls = ({ zoom, center, onMoveEnd, onBackgroundClick, onResetView }) => (
    <div className="map-zoom-controls" style={{ zIndex: 200, position: 'absolute' }}>
      <input
          type="range"
          min="1"
          max="10"
          step="0.1"
          value={zoom}
          onChange={(e) =>
              onMoveEnd({
                zoom: Number(e.target.value),
                coordinates: center
              })
          }
      />
      <button
          title="Centrar vista"
          onClick={() => {
              onBackgroundClick?.()
              onResetView?.()
          }}
      >
        ◎
      </button>
    </div>
);


const WorldMap = ({
  airports = [],
  activeMetrics = {},
  activeAircraft = [],
  masterPlan = { planId: null, routes: [] },
  airportByIcao = {},
  isCollapseScenario = false,
  selectedAirportCode = "",
  selectedFromAirport = null,
  selectedToAirport = null,
  onAirportSelect = () => {},
  selectedAircraftId = null,
  onAircraftSelect = () => {},
  showCityLabels = true,
  showFlightsWithoutShipments = true,
  showFlightsWithShipments = true,
  onMoveEnd = () => {},
  currentEpochTime = 0,
  systemClock = "--:--:--",
  simState = "idle",
  isDayToDay = false,
  onBackgroundClick = () => {},
  onReset = () => {},
}) => {
  // flightColorFilters y airportColorFilters ahora vienen del SelectionBridge (compartidos)
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
  const [isModalDismissed, setIsModalDismissed] = useState(false);

  useEffect(() => {
    if (simState !== "completed") {
      setIsModalDismissed(false);
    }
  }, [simState]);
  const {
    focusedEntity,
    setFocusedEntity,
    mapCommand,
    clearMapCommand,
    trackedRoute,
    clearTrackedRoute,
    exceptionHighlight,
    clearExceptionHighlight,
    activeFilters,
    flightColorFilters,
    setFlightColorFilters,
    airportColorFilters,
    setAirportColorFilters,
  } = useSelectionBridge();

  const [highlightedId, setHighlightedId] = useState(null);
  const highlightTimerRef = useRef(null);
  const containerRef = useRef(null);

  const [viewState, setViewState] = useState(() => ({
    ...getFitViewState(),
    pitch: 0,
    bearing: 0
  }));

  useEffect(() => {
    if (!containerRef.current) return
    const { clientWidth, clientHeight } = containerRef.current
    if (clientWidth > 0 && clientHeight > 0) {
      setViewState(prev => ({ ...prev, ...getFitViewState(clientWidth, clientHeight) }))
    }
  }, [])

  const handleViewStateChange = useCallback(({ viewState }) => {
    setViewState(viewState);
    onMoveEnd({
      zoom: viewState.zoom,
      coordinates: [viewState.longitude, viewState.latitude]
    });
  }, [onMoveEnd]);

  useEffect(() => {
    if (!mapCommand) return;
    const { action, payload } = mapCommand;

    if (action === 'flyTo' && payload.coordinates) {
      setViewState({
        longitude: payload.coordinates[0],
        latitude: payload.coordinates[1],
        zoom: payload.zoom || 5,
        pitch: 0,
        bearing: 0,
        transitionDuration: 1000
      });
      if (payload.targetId) {
        setHighlightedId(payload.targetId);
        clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = setTimeout(() => setHighlightedId(null), 3000);
      }
    }

    if (action === 'highlight' && payload.targetId) {
      setHighlightedId(payload.targetId);
      clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = setTimeout(() => setHighlightedId(null), 3000);
    }

    if (action === 'resetView') {
      const w = containerRef.current?.clientWidth || 1200;
      const h = containerRef.current?.clientHeight || 800;
      const fitted = getFitViewState(w, h);
      setViewState(prev => ({ ...prev, ...fitted, transitionDuration: 800 }));
      onMoveEnd({ zoom: fitted.zoom, coordinates: [fitted.longitude, fitted.latitude] });
      setHighlightedId(null);
    }

    clearMapCommand();
  }, [mapCommand, clearMapCommand]);

  useEffect(() => {
    return () => clearTimeout(highlightTimerRef.current);
  }, []);

  const lastSelectedAircraftRef = useRef(null);

  // Al seleccionar vuelo → zoom para ver ambos aeropuertos
  useEffect(() => {
    if (selectedAircraftId) {
      const plane = activeAircraft.find(p => p.id === selectedAircraftId);
      if (plane) {
        const from = airportByIcao[plane.from] || AIRPORT_BY_ICAO[plane.from];
        const to = airportByIcao[plane.to] || AIRPORT_BY_ICAO[plane.to];
        if (from && to && from.coordinates && to.coordinates) {
          if (lastSelectedAircraftRef.current !== selectedAircraftId) {
            lastSelectedAircraftRef.current = selectedAircraftId;
            const bounds = {
              minLng: Math.min(from.coordinates[0], to.coordinates[0]),
              maxLng: Math.max(from.coordinates[0], to.coordinates[0]),
              minLat: Math.min(from.coordinates[1], to.coordinates[1]),
              maxLat: Math.max(from.coordinates[1], to.coordinates[1]),
            };
            const w = containerRef.current?.clientWidth || 1200;
            const h = containerRef.current?.clientHeight || 800;
            const padding = Math.min(w, h) * 0.15;
            const viewport = new WebMercatorViewport({ width: w, height: h });
            const fitted = viewport.fitBounds(
              [[bounds.minLng, bounds.minLat], [bounds.maxLng, bounds.maxLat]],
              { padding }
            );
            setViewState(prev => ({
              ...prev,
              longitude: fitted.longitude,
              latitude: fitted.latitude,
              zoom: Math.min(fitted.zoom, 5),
              transitionDuration: 1000
            }));
          }
        }
      }
    } else {
      lastSelectedAircraftRef.current = null;
    }
  }, [selectedAircraftId, activeAircraft, airportByIcao]);

  const lastSelectedAirportRef = useRef(null);

  // Zoom al aeropuerto seleccionado
  useEffect(() => {
    if (selectedAirportCode) {
      if (lastSelectedAirportRef.current !== selectedAirportCode) {
        lastSelectedAirportRef.current = selectedAirportCode;
        const ap = airportByIcao[selectedAirportCode] || AIRPORT_BY_ICAO[selectedAirportCode];
        if (ap && ap.coordinates) {
          setViewState(prev => ({
            ...prev,
            longitude: ap.coordinates[0],
            latitude: ap.coordinates[1],
            zoom: 3,
            transitionDuration: 1500 // Slower, smoother zoom
          }));
        }
      }
    } else {
      lastSelectedAirportRef.current = null;
    }
  }, [selectedAirportCode, airportByIcao]);

  const airportPassesFilter = useCallback((airportIcao) => {
    if (activeFilters.continent) {
      const ap = airports.find(a => a.icao === airportIcao);
      if (ap && ap.continent !== activeFilters.continent) return false;
    }
    const metrics = activeMetrics[airportIcao];
    if (activeFilters.semaphoreLevel) {
      const stockBagsCheck = metrics?.storedBags ?? metrics?.load ?? 0;
      const levelCheck = stockBagsCheck === 0 && metrics ? "empty" : (metrics?.level ?? "green");
      if (levelCheck !== activeFilters.semaphoreLevel) return false;
    }
    
    // Dynamic color filters — same criterion as AirportsLayer.js
    const stockBags = metrics?.storedBags ?? metrics?.load ?? 0;
    const level = stockBags === 0 && metrics ? "empty" : (metrics?.level ?? "green");
    const isGray = !metrics || stockBags === 0;
    
    if (isGray && !airportColorFilters.gray) return false;
    if (!isGray && level === "green" && !airportColorFilters.green) return false;
    if (!isGray && level === "amber" && !airportColorFilters.yellow) return false;
    if (!isGray && level === "red" && !airportColorFilters.red) return false;

    return true;
  }, [activeFilters.semaphoreLevel, activeFilters.continent, activeMetrics, airports, airportColorFilters]);

  const flightPassesFilter = useCallback((capacityPercent, fromIcao, toIcao, ocupacionReal = null) => {
    const pct = capacityPercent ?? 0;
    if (activeFilters.flightStatus) {
      const matches =
        activeFilters.flightStatus === 'low' ? pct < 70 :
        activeFilters.flightStatus === 'medium' ? (pct >= 70 && pct <= 90) :
        activeFilters.flightStatus === 'high' ? pct > 90 :
        true;
      if (!matches) return false;
    }
    if (activeFilters.continent) {
      const fromAirport = airportByIcao[fromIcao];
      const toAirport = airportByIcao[toIcao];
      const fromMatch = fromAirport?.continent === activeFilters.continent;
      const toMatch = toAirport?.continent === activeFilters.continent;
      if (!fromMatch || !toMatch) return false;
    }
    if (activeFilters.semaphoreLevel) {
      const checkSemaphore = (icao) => {
        const m = activeMetrics[icao];
        return (m?.level ?? "green") === activeFilters.semaphoreLevel;
      };
      if (!checkSemaphore(fromIcao) && !checkSemaphore(toIcao)) return false;
    }

    // Dynamic color filters
    const isEmpty = ocupacionReal === 0 || pct === 0;
    if (isEmpty && !flightColorFilters.gray) return false;
    if (!isEmpty && pct < 70 && !flightColorFilters.green) return false;
    if (!isEmpty && pct >= 70 && pct <= 90 && !flightColorFilters.yellow) return false;
    if (!isEmpty && pct > 90 && !flightColorFilters.red) return false;

    return true;
  }, [activeFilters.flightStatus, activeFilters.continent, activeFilters.semaphoreLevel, activeMetrics, airportByIcao, flightColorFilters]);

  // Si el avión seleccionado ya no cumple los filtros, lo deseleccionamos automáticamente
  useEffect(() => {
    if (selectedAircraftId) {
      const plane = activeAircraft.find(p => p.id === selectedAircraftId);
      if (plane && !flightPassesFilter(plane.capacityPercent, plane.from, plane.to, plane.ocupacionReal)) {
        onAircraftSelect(null);
        onBackgroundClick();
      }
    }
  }, [selectedAircraftId, activeAircraft, flightPassesFilter, onAircraftSelect, onBackgroundClick]);

  const hasAnySelection = selectedAircraftId != null || (selectedAirportCode != null && selectedAirportCode !== "");
  const relatedAirportCodes = useMemo(() => {
    if (!selectedAirportCode) return new Set()
    const codes = new Set()
    activeAircraft.forEach(plane => {
      const isEmpty = !plane.ocupacionReal || plane.ocupacionReal === 0
      if (isEmpty) return
      if (plane.to === selectedAirportCode) codes.add(plane.from)
      if (plane.from === selectedAirportCode) codes.add(plane.to)
    })
    return codes
  }, [selectedAirportCode, activeAircraft])

  const layers = useMemo(() => {
    const layerDefs = [];

    // 1. Routes (Bottom)
    layerDefs.push(...createRoutesLayers({
      activeAircraft,
      airportByIcao,
      selectedFromAirport,
      selectedToAirport,
      trackedRoute,
      exceptionHighlight,
      selectedAircraftId,
      hasAnySelection,
      flightPassesFilter,
      selectedAirportCode,
      showFlightsWithoutShipments,
      showFlightsWithShipments,
    }));

    // 2. Airports
    layerDefs.push(...createAirportsLayers({
      airports,
      activeMetrics,
      isCollapseScenario,
      selectedAirportCode,
      focusedEntity,
      highlightedId,
      airportPassesFilter,
      hasAnySelection,
      relatedAirportCodes
    }));

    // 3. Flights (Top)
    layerDefs.push(createFlightsLayer({
      activeAircraft,
      airportByIcao,
      selectedAircraftId,
      highlightedId,
      trackedRoute,
      flightPassesFilter,
      showFlightsWithoutShipments,
      showFlightsWithShipments,
      hasAnySelection,
      selectedAirportCode
    }));

    return layerDefs;
  }, [
    airports, activeMetrics, activeAircraft, isCollapseScenario,
    selectedAirportCode, selectedAircraftId, focusedEntity, highlightedId,
    showFlightsWithoutShipments, showFlightsWithShipments, hasAnySelection,
    selectedFromAirport, selectedToAirport, trackedRoute, exceptionHighlight,
    airportPassesFilter, flightPassesFilter, airportByIcao, relatedAirportCodes
  ]);

  const onLayerClick = useCallback((info, event) => {
    if (!info.object) {
      onBackgroundClick();
      onAircraftSelect(null);
      return;
    }

    if (info.layer.id === 'airports-layer') {
      onAirportSelect(info.object.icao);
      setFocusedEntity('airport', info.object.icao, 'map');
    } else if (info.layer.id === 'flights-icon-layer' || info.layer.id === 'flights-text-layer') {
      onAircraftSelect(info.object.id);
      setFocusedEntity('flight', info.object.id, 'map');
    }
  }, [onAirportSelect, onAircraftSelect, onBackgroundClick, setFocusedEntity]);

  // Precompute full paths per route — recomputed only when activeAircraft changes, not every frame
  const routeFullPaths = useMemo(() => {
    const cache = {};
    const pathByRoute = {};
    activeAircraft.forEach(plane => {
      const from = airportByIcao[plane.from];
      const to = airportByIcao[plane.to];
      if (!from || !to) return;
      const key = `${plane.from}__${plane.to}`;
      if (!pathByRoute[key]) {
        pathByRoute[key] = getStraightPath(from.coordinates, to.coordinates);
      }
      cache[plane.id] = pathByRoute[key];
    });
    return cache;
  }, [activeAircraft, airportByIcao]);

  return (
    <div 
      ref={containerRef}
      className="ct-world-map" 
      aria-label="Mapa de operaciones global" 
      style={{ position: "relative", width: "100%", height: "100%", background: "#e5e3df" }}
    >
      <div className="ct-map-filter" style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
        <button
          onClick={() => setIsFilterPanelOpen(p => !p)}
          className={`ct-map-filter-btn${isFilterPanelOpen ? ' ct-map-filter-btn--active' : ''}`}
          title="Filtros del Mapa"
          style={{ borderRadius: '50%', width: '40px', height: '40px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', background: isFilterPanelOpen ? 'rgba(96, 165, 250, 0.2)' : 'rgba(15, 23, 42, 0.8)', border: isFilterPanelOpen ? '1px solid rgba(96, 165, 250, 0.5)' : '1px solid rgba(255,255,255,0.1)', transition: 'transform 0.3s ease', transform: isFilterPanelOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          {isFilterPanelOpen ? '✕' : '⚙️'}
        </button>

        <div style={{
          background: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', padding: '8px', display: 'flex', flexDirection: 'column', gap: '8px', width: 'max-content',
          opacity: isFilterPanelOpen ? 1 : 0,
          transform: isFilterPanelOpen ? 'translateY(0) scale(1)' : 'translateY(-10px) scale(0.95)',
          pointerEvents: isFilterPanelOpen ? 'auto' : 'none',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          transformOrigin: 'top right'
        }}>
          {/* Vuelos Section */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <div style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}><span>✈️</span> Vuelos</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px', color: '#e2e8f0' }}>
              <input type="checkbox" checked={flightColorFilters.gray} onChange={(e) => setFlightColorFilters(p => ({...p, gray: e.target.checked}))} style={{ accentColor: '#64748b', transform: 'scale(0.9)' }} />
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#64748b' }}></span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px', color: '#e2e8f0' }}>
              <input type="checkbox" checked={flightColorFilters.green} onChange={(e) => setFlightColorFilters(p => ({...p, green: e.target.checked}))} style={{ accentColor: '#10b981', transform: 'scale(0.9)' }} />
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }}></span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px', color: '#e2e8f0' }}>
              <input type="checkbox" checked={flightColorFilters.yellow} onChange={(e) => setFlightColorFilters(p => ({...p, yellow: e.target.checked}))} style={{ accentColor: '#f59e0b', transform: 'scale(0.9)' }} />
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f59e0b' }}></span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px', color: '#e2e8f0' }}>
              <input type="checkbox" checked={flightColorFilters.red} onChange={(e) => setFlightColorFilters(p => ({...p, red: e.target.checked}))} style={{ accentColor: '#ef4444', transform: 'scale(0.9)' }} />
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444' }}></span>
            </label>
          </div>

          <div style={{ height: '1px', background: 'rgba(255,255,255,0.1)' }}></div>

          {/* Almacenes Section */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <div style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}><span>🏭</span> Almacenes</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px', color: '#e2e8f0' }}>
              <input type="checkbox" checked={airportColorFilters.gray} onChange={(e) => setAirportColorFilters(p => ({...p, gray: e.target.checked}))} style={{ accentColor: '#64748b', transform: 'scale(0.9)' }} />
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#64748b' }}></span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px', color: '#e2e8f0' }}>
              <input type="checkbox" checked={airportColorFilters.green} onChange={(e) => setAirportColorFilters(p => ({...p, green: e.target.checked}))} style={{ accentColor: '#10b981', transform: 'scale(0.9)' }} />
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }}></span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px', color: '#e2e8f0' }}>
              <input type="checkbox" checked={airportColorFilters.yellow} onChange={(e) => setAirportColorFilters(p => ({...p, yellow: e.target.checked}))} style={{ accentColor: '#f59e0b', transform: 'scale(0.9)' }} />
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f59e0b' }}></span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px', color: '#e2e8f0' }}>
              <input type="checkbox" checked={airportColorFilters.red} onChange={(e) => setAirportColorFilters(p => ({...p, red: e.target.checked}))} style={{ accentColor: '#ef4444', transform: 'scale(0.9)' }} />
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444' }}></span>
            </label>
          </div>
        </div>
      </div>

      <LegendButton />
      <MapZoomControls 
        zoom={viewState.zoom} 
        center={[viewState.longitude, viewState.latitude]} 
        onMoveEnd={(pos) => {
          setViewState(prev => ({
            ...prev,
            zoom: pos.zoom,
            longitude: pos.coordinates[0],
            latitude: pos.coordinates[1],
            transitionDuration: 500
          }));
          onMoveEnd(pos);
        }}
        onBackgroundClick={onBackgroundClick}
        onResetView={() => {
          const w = containerRef.current?.clientWidth || 1200
          const h = containerRef.current?.clientHeight || 800
          const fitted = getFitViewState(w, h)
          setViewState(prev => ({ ...prev, ...fitted, transitionDuration: 800 }))
          onMoveEnd({ zoom: fitted.zoom, coordinates: [fitted.longitude, fitted.latitude] })
        }}
      />

      {exceptionHighlight && (
        <button
          onClick={(e) => { e.stopPropagation(); clearExceptionHighlight(); }}
          style={{
            position: 'absolute', bottom: 70, right: 20, zIndex: 200,
            background: 'rgba(239, 68, 68, 0.2)', border: '1px solid rgba(239, 68, 68, 0.5)',
            borderRadius: '8px', padding: '6px 14px', color: '#fca5a5',
            fontSize: '11px', fontWeight: 'bold', cursor: 'pointer',
            backdropFilter: 'blur(6px)',
          }}
          title="Limpiar highlight de excepción"
        >
          ✕ Limpiar excepción
        </button>
      )}

      <DeckGL
        viewState={viewState}
        onViewStateChange={handleViewStateChange}
        controller={true}
        layers={layers}
        onClick={onLayerClick}
        getCursor={({ isHovering }) => isHovering ? 'pointer' : 'grab'}
      >
        <Map
          mapStyle="https://basemaps.cartocdn.com/gl/voyager-nolabels-gl-style/style.json"
          reuseMaps
          preventStyleDiffing
        />
      </DeckGL>


      {simState === "completed" && !isModalDismissed && (
        <div style={{
          position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
          background: "rgba(15, 23, 42, 0.95)", border: `2px solid ${isCollapseScenario ? "#ef4444" : "#10b981"}`,
          borderRadius: "16px", padding: "32px 48px", textAlign: "center", zIndex: 1000,
          backdropFilter: "blur(12px)", boxShadow: "0 20px 50px rgba(0,0,0,0.7)", animation: "fadeIn 0.5s ease-out"
        }}>
          <button
            onClick={(e) => { e.stopPropagation(); setIsModalDismissed(true); }}
            style={{ position: "absolute", top: "12px", right: "16px", background: "transparent", border: "none", color: "#94a3b8", fontSize: "18px", cursor: "pointer", padding: "4px" }}
            aria-label="Cerrar"
            title="Cerrar modal y ver plan final"
          >
            ✕
          </button>
          <div style={{ fontSize: "24px", fontWeight: "900", color: isCollapseScenario ? "#fca5a5" : "#34d399", letterSpacing: "2px", marginBottom: "8px" }}>
            {isCollapseScenario ? "PUNTO DE QUIEBRE ALCANZADO" : "SIMULACIÓN COMPLETADA"}
          </div>
          <div style={{ fontSize: "14px", color: "#94a3b8", maxWidth: "300px", margin: "0 auto", lineHeight: "1.5" }}>
            {isCollapseScenario ? "El sistema ha detectado una saturación física o caída crítica del SLA que impide continuar la operación normal." : "Se han procesado todos los eventos del período solicitado exitosamente."}
          </div>
          <div style={{ marginTop: "24px", display: "flex", gap: "12px", justifyContent: "center" }}>
            <button
              onClick={(e) => { e.stopPropagation(); onReset(); }}
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#e2e8f0", padding: "8px 20px", borderRadius: "8px", fontSize: "13px", fontWeight: "600", cursor: "pointer" }}
            >
              Reiniciar
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorldMap;
