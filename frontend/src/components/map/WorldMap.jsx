import React, { useRef, useEffect, useState, useCallback } from "react";
import { ComposableMap, Geographies, Geography, Marker, Line, ZoomableGroup } from "react-simple-maps";
import { interpolateCoordinates, AIRPORT_BY_ICAO } from "../../data/airportsData";
import { useSelectionBridge } from "../../hooks/useSelectionBridge";

const GEO_URL = "/world-110m.json";

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
        aria-label="Ver leyenda del mapa"
        title="Leyenda"
      >
        ⓘ
      </button>
      {visible && (
        <div className="map-legend-popup" style={{ bottom: 40, left: 0 }}>
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

const MapZoomControls = ({ zoom, center, onMoveEnd }) => (
  <div className="map-zoom-controls">
    <button
      title="Acercar"
      onClick={() => onMoveEnd({ zoom: Math.min(zoom + 0.5, 8), coordinates: center })}
    >+</button>
    <button
      title="Alejar"
      onClick={() => onMoveEnd({ zoom: Math.max(zoom - 0.5, 1), coordinates: center })}
    >−</button>
    <button
      title="Centrar vista"
      onClick={() => onMoveEnd({ zoom: 1, coordinates: [0, 20] })}
    >◎</button>
  </div>
);


const PROJECTION_CONFIG = {
  rotate: [-20, 0, 0],
  scale: 220,
  center: [15, 10],
};

const MapBackground = React.memo(({ isCollapseScenario }) => (
  <Geographies geography={GEO_URL}>
    {({ geographies }) =>
      geographies.map((geo) => (
        <Geography
          key={geo.rsmKey}
          geography={geo}
          className={`ct-map-country ${isCollapseScenario ? "ct-map-country--collapse" : ""}`}
          tabIndex={-1}
        />
      ))
    }
  </Geographies>
));

// Constante para el máximo de vuelos completados en fade-out
const MAX_COMPLETED_PLANES = 50;

/**
 * WorldMap — Componente raíz del mapa interactivo.
 *
 * Soporta:
 * - Vinculación bidireccional Panel↔Mapa via SelectionBridge
 * - Estela progresiva (trail) detrás del avión
 * - Track & Trace con ruta multi-hop
 * - Highlights de excepciones (bloqueos/averías)
 * - Filtros visuales por semáforo
 * - Aviones en tierra diferenciados
 */
const WorldMap = ({
  airports = [],
  activeMetrics = {},
  activeAircraft = [],
  airportByIcao = {},
  isCollapseScenario = false,
  selectedAirportCode = "",
  selectedFromAirport = null,
  selectedToAirport = null,
  onAirportSelect = () => {},
  selectedAircraftId = null,
  onAircraftSelect = () => {},
  showCityLabels = true,
  zoom = 1,
  center = [0, 20],
  onMoveEnd = () => {},
currentEpochTime = 0,
  systemClock = "--:--:--",
}) => {
  // ── Selection Bridge ─────────────────────────────────────────────────────
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
  } = useSelectionBridge();

  // Estados para Tooltip de Aviones y Desvanecimiento de líneas
  const [selectedPlane, setSelectedPlane] = useState(null);
  const completedPlanesRef = useRef([]);
  const [completedPlanesVersion, setCompletedPlanesVersion] = useState(0);
  const prevActivePlanesRef = useRef([]);

  // ── Highlight pulsante temporal ──────────────────────────────────────────
  const [highlightedId, setHighlightedId] = useState(null);
  const highlightTimerRef = useRef(null);

  // Detectar vuelos completados para desvanecimiento
  useEffect(() => {
    const prevPlanes = prevActivePlanesRef.current;
    const currentIds = new Set(activeAircraft.map(p => p.id));
    
    const newlyCompleted = prevPlanes.filter(p => !currentIds.has(p.id));
    
    if (newlyCompleted.length > 0) {
      const now = Date.now();
      const newEntries = newlyCompleted.map(p => ({ ...p, completedAt: now }));
      completedPlanesRef.current = [
        ...completedPlanesRef.current,
        ...newEntries,
      ].slice(-MAX_COMPLETED_PLANES);
      setCompletedPlanesVersion(v => v + 1);
    }
    
    prevActivePlanesRef.current = activeAircraft;
  }, [activeAircraft]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const now = Date.now();
      const before = completedPlanesRef.current.length;
      completedPlanesRef.current = completedPlanesRef.current.filter(p => now - p.completedAt < 2000);
      if (completedPlanesRef.current.length !== before) {
        setCompletedPlanesVersion(v => v + 1);
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [completedPlanesVersion]);

  useEffect(() => {
    if (selectedPlane) {
      const current = activeAircraft.find(p => p.id === selectedPlane.id);
      if (current) {
        setSelectedPlane(current);
      } else {
        const completed = completedPlanesRef.current.find(p => p.id === selectedPlane.id);
        if (!completed) {
          setSelectedPlane(null);
        }
      }
    }
  }, [activeAircraft, completedPlanesVersion, selectedPlane]);

  useEffect(() => {
    if (!mapCommand) return;
    const { action, payload } = mapCommand;

    if (action === 'flyTo' && payload.coordinates) {
      onMoveEnd({
        zoom: payload.zoom || 4,
        coordinates: payload.coordinates,
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

    clearMapCommand();
  }, [mapCommand, clearMapCommand, onMoveEnd]);

  useEffect(() => {
    return () => clearTimeout(highlightTimerRef.current);
  }, []);

  const getStrokeColor = (status) => {
    switch (status) {
      case "cancelled": return "#f43f5e";
      case "critical": return "#f59e0b";
      case "blocked": return "#e11d48";
      case "rescued": return "#3b82f6";
      default: return "#10b981";
    }
  };

  const getStatusLabel = (status) => {
    switch (status) {
      case "cancelled": return "CANCELADO";
      case "critical": return "CRÍTICO";
      case "blocked": return "BLOQUEADO";
      case "rescued": return "RESCATADO";
      default: return "A TIEMPO";
    }
  };

  const airportPassesFilter = useCallback((airportIcao) => {
    if (!activeFilters.semaphoreLevel) return true;
    const metrics = activeMetrics[airportIcao];
    const level = metrics?.level ?? "green";
    return level === activeFilters.semaphoreLevel;
  }, [activeFilters.semaphoreLevel, activeMetrics]);

  const flightPassesFilter = useCallback((status) => {
    if (!activeFilters.flightStatus) return true;
    return status === activeFilters.flightStatus;
  }, [activeFilters.flightStatus]);

  const getAveriaColor = (averiaType) => {
    switch (parseInt(averiaType)) {
      case 1: return '#f59e0b';
      case 2: return '#f97316';
      case 3: return '#ef4444';
      case 4: return '#1e1b4b';
      default: return '#ef4444';
    }
  };

  return (
    <div 
      className="ct-world-map" 
      aria-label="Mapa de operaciones global" 
      style={{ position: "relative", width: "100%", height: "100%" }}
      onClick={() => {
        setSelectedPlane(null);
        onAircraftSelect(null);
      }}
    >
      {/* ── Botón Flotante de Leyenda ( ⓘ ) ────────────────────────────────── */}
      <LegendButton />

      {/* ── Controles de Zoom Dark Mode ─────────────────────────────────────── */}
      <MapZoomControls zoom={zoom} center={center} onMoveEnd={onMoveEnd} />

      {/* ── Botón Limpiar Ruta Rastreada ────────────────────────────────────── */}
      {trackedRoute && (
        <button
          onClick={(e) => { e.stopPropagation(); clearTrackedRoute(); }}
          style={{
            position: 'absolute', bottom: 36, right: 20, zIndex: 200,
            background: 'rgba(167, 139, 250, 0.2)', border: '1px solid rgba(167, 139, 250, 0.5)',
            borderRadius: '8px', padding: '6px 14px', color: '#a78bfa',
            fontSize: '11px', fontWeight: 'bold', cursor: 'pointer',
            backdropFilter: 'blur(6px)',
          }}
          title="Limpiar ruta rastreada del mapa"
        >
          ✕ Limpiar ruta rastreada
        </button>
      )}

      {/* ── Botón Limpiar Highlight de Excepción ───────────────────────────── */}
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

      {/* Floating clock overlay on the map */}
      {systemClock && systemClock !== "--:--:--" && systemClock !== "--:--" && (
        <div style={{
          position: "absolute",
          top: "20px",
          right: "20px",
          zIndex: 10,
          background: "rgba(15, 23, 42, 0.85)",
          border: isCollapseScenario ? "1.5px solid #ef4444" : "1.5px solid #3b82f6",
          borderRadius: "8px",
          padding: "8px 16px",
          color: "white",
          fontFamily: "'Courier New', Courier, monospace",
          boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
          backdropFilter: "blur(6px)",
          display: "flex",
          flexDirection: "column",
          gap: "2px",
          alignItems: "flex-end",
          pointerEvents: "none"
        }}>
          <div style={{ fontSize: "10px", color: isCollapseScenario ? "#ef4444" : "#60a5fa", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "1px" }}>
            {isCollapseScenario ? "⚠️ Simulación Colapso" : "🕒 Tiempo Simulado"}
          </div>
          <div style={{ fontSize: "18px", fontWeight: "bold", letterSpacing: "0.5px" }}>
            {systemClock}
          </div>
        </div>
      )}

      <ComposableMap
        projection="geoMercator"
        projectionConfig={PROJECTION_CONFIG}
        className="ct-world-map__svg"
      >
        <ZoomableGroup zoom={zoom} center={center} onMoveEnd={onMoveEnd} maxZoom={8}>
          
          <MapBackground isCollapseScenario={isCollapseScenario} />

          <FlightLayer
            activeAircraft={activeAircraft}
            airportByIcao={airportByIcao}
            selectedAircraftId={selectedAircraftId}
            onAircraftSelect={onAircraftSelect}
            currentEpochTime={currentEpochTime}
          />

{/* ── Ruta seleccionada ──────────────────────────────────────────── */}
          {selectedFromAirport && selectedToAirport && (
            <Line
              from={selectedFromAirport.coordinates}
              to={selectedToAirport.coordinates}
              className="ct-map-route-line"
              strokeLinecap="round"
              stroke="#818cf8"
              strokeWidth={3}
              style={{ filter: "drop-shadow(0 0 4px #818cf8)", opacity: 0.9 }}
            />
          )}

          {/* ── Paso 4: Track & Trace — Ruta multi-hop ─────────────────────── */}
          {trackedRoute && trackedRoute.hops && trackedRoute.hops.map((hop, idx) => {
            const from = airportByIcao[hop.from] || AIRPORT_BY_ICAO[hop.from];
            const to = airportByIcao[hop.to] || AIRPORT_BY_ICAO[hop.to];
            if (!from || !to) return null;
            return (
              <Line
                key={`track-${trackedRoute.shipmentId}-${idx}`}
                from={from.coordinates}
                to={to.coordinates}
                stroke="#a78bfa"
                strokeWidth={3}
                strokeDasharray="8 4"
                style={{
                  filter: "drop-shadow(0 0 4px #a78bfa)",
                  opacity: 0.9,
                  animation: "ct-tracked-route-pulse 2s infinite ease-in-out",
                }}
                strokeLinecap="round"
              />
            );
          })}

          {/* ── Paso 4: Markers de parada intermedios para Track & Trace ──── */}
          {trackedRoute && trackedRoute.hops && trackedRoute.hops.map((hop, idx) => {
            const airport = airportByIcao[hop.from] || AIRPORT_BY_ICAO[hop.from];
            if (!airport) return null;
            return (
              <Marker key={`track-stop-${idx}`} coordinates={airport.coordinates}>
                <circle r={6} fill="rgba(167, 139, 250, 0.3)" stroke="#a78bfa" strokeWidth={2} />
                <text y={-10} textAnchor="middle" style={{ fontSize: '8px', fill: '#a78bfa', fontWeight: 'bold' }}>
                  {idx + 1}
                </text>
              </Marker>
            );
          })}
          {/* Marker final del Track & Trace */}
          {trackedRoute && trackedRoute.hops && trackedRoute.hops.length > 0 && (() => {
            const lastHop = trackedRoute.hops[trackedRoute.hops.length - 1];
            const airport = airportByIcao[lastHop.to] || AIRPORT_BY_ICAO[lastHop.to];
            if (!airport) return null;
            return (
              <Marker coordinates={airport.coordinates}>
                <circle r={6} fill="rgba(167, 139, 250, 0.3)" stroke="#a78bfa" strokeWidth={2} />
                <text y={-10} textAnchor="middle" style={{ fontSize: '8px', fill: '#a78bfa', fontWeight: 'bold' }}>
                  🏁
                </text>
              </Marker>
            );
          })()}

          {/* ── Paso 5: Highlight de Excepciones (bloqueos/averías) ──────── */}
          {exceptionHighlight && (() => {
            const exColor = exceptionHighlight.type === 'AVERIA'
              ? getAveriaColor(exceptionHighlight.averiaType)
              : '#ef4444';

            if (exceptionHighlight.type === 'TRAMO' && exceptionHighlight.origenIcao && exceptionHighlight.destinoIcao) {
              const from = airportByIcao[exceptionHighlight.origenIcao] || AIRPORT_BY_ICAO[exceptionHighlight.origenIcao];
              const to = airportByIcao[exceptionHighlight.destinoIcao] || AIRPORT_BY_ICAO[exceptionHighlight.destinoIcao];
              if (from && to) {
                return (
                  <Line
                    from={from.coordinates}
                    to={to.coordinates}
                    stroke={exColor}
                    strokeWidth={4}
                    strokeDasharray="6 3"
                    style={{
                      filter: `drop-shadow(0 0 8px ${exColor})`,
                      animation: "ct-exception-pulse 1.5s 3 ease-in-out",
                      opacity: 0.95,
                    }}
                    strokeLinecap="round"
                  />
                );
              }
            }

            if ((exceptionHighlight.type === 'NODO' || exceptionHighlight.type === 'AVERIA') && exceptionHighlight.origenIcao) {
              const airport = airportByIcao[exceptionHighlight.origenIcao] || AIRPORT_BY_ICAO[exceptionHighlight.origenIcao];
              if (airport) {
                return (
                  <Marker coordinates={airport.coordinates}>
                    <circle
                      r={18}
                      fill="transparent"
                      stroke={exColor}
                      strokeWidth={3}
                      style={{
                        animation: "ct-exception-pulse 1.5s 3 ease-in-out",
                        filter: `drop-shadow(0 0 10px ${exColor})`,
                      }}
                    />
                    <text y={28} textAnchor="middle" style={{ fontSize: '9px', fill: exColor, fontWeight: 'bold' }}>
                      {exceptionHighlight.type === 'AVERIA' ? `⚠ T${exceptionHighlight.averiaType}` : '🚫 BLOQUEADO'}
                    </text>
                  </Marker>
                );
              }
            }

            return null;
          })()}

          {/* ── Lógica de atenuación (Focus) + Filtros + Estela ── */}
          {(() => {
            const hasSelection = selectedAircraftId != null || selectedPlane != null;
            const isPlaneSelected = (planeId) => selectedAircraftId === planeId || (selectedPlane?.id === planeId);
            const getOpacity = (planeId, baseOpacity) => hasSelection ? (isPlaneSelected(planeId) ? baseOpacity : 0.15) : baseOpacity;

            return (
              <>
                {/* ── Paso 7: Arcos de vuelos con ESTELA progresiva ─────────── */}
                {activeAircraft.map((plane) => {
                  const from = airportByIcao[plane.from];
                  const to   = airportByIcao[plane.to];
                  if (!from || !to) return null;

                  // Paso 6: Filtro visual
                  const passesFilter = flightPassesFilter(plane.status);
                  const strokeColor = getStrokeColor(plane.status);
                  const isSelected = isPlaneSelected(plane.id);
                  const isHighlighted = highlightedId === plane.id;
                  const progress = plane.progress ?? 0;

                  // ── Paso 7: Estela progresiva ──
                  // La línea se dibuja desde el origen hasta la posición actual del avión,
                  // y se desvanece detrás.
                  const pathLength = 1000;
                  const trailPct = 0.20; // 20% del arco como estela visible
                  const drawnLength = progress * pathLength;
                  const trailLength = trailPct * pathLength;
                  
                  // Calcular dasharray: segmento visible = min(drawnLength, trailLength), luego gap largo
                  const visibleSegment = Math.min(drawnLength, trailLength);
                  const dashArray = `${visibleSegment} ${pathLength}`;
                  const dashOffset = -drawnLength + visibleSegment;

                  return (
                    <Line
                      key={`arc-${plane.id}`}
                      from={from.coordinates}
                      to={to.coordinates}
                      stroke={strokeColor}
                      strokeWidth={isSelected || isHighlighted ? 3.5 : 2.5}
                      strokeDasharray={dashArray}
                      strokeDashoffset={dashOffset}
                      style={{
                        filter: isSelected || isHighlighted
                          ? `drop-shadow(0 0 6px ${strokeColor})`
                          : `drop-shadow(0 0 2px ${strokeColor})`,
                        opacity: passesFilter ? getOpacity(plane.id, 0.85) : 0.08,
                        transition: "opacity 0.3s ease, stroke-width 0.3s ease, filter 0.3s ease, stroke-dashoffset 1s linear, stroke-dasharray 1s linear",
                        cursor: "pointer"
                      }}
                      strokeLinecap="round"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedPlane(plane);
                        onAircraftSelect(plane.id);
                        // Paso 3: Notificar al bridge (Mapa→Panel)
                        setFocusedEntity('flight', plane.id, 'map');
                      }}
                    />
                  );
                })}

                {/* ── Arcos de vuelos recién finalizados (Desvanecimiento automático) ── */}
                {completedPlanesRef.current.map((plane) => {
                  const from = airportByIcao[plane.from];
                  const to   = airportByIcao[plane.to];
                  if (!from || !to) return null;
                  const strokeColor = getStrokeColor(plane.status);
                  return (
                    <Line
                      key={`arc-completed-${plane.id}-${plane.completedAt}`}
                      from={from.coordinates}
                      to={to.coordinates}
                      stroke={strokeColor}
                      strokeWidth={2}
                      style={{
                        filter: `drop-shadow(0 0 3px ${strokeColor})`,
                        animation: "ct-fade-out-line 2s forwards ease-out",
                        strokeDasharray: "4 4",
                        opacity: getOpacity(plane.id, 1)
                      }}
                      strokeLinecap="round"
                    />
                  );
                })}

                {/* ── Paso 8: Aviones con movimiento suavizado + diferenciación en tierra ── */}
                {activeAircraft.map((plane) => {
                  const from = airportByIcao[plane.from];
                  const to   = airportByIcao[plane.to];
                  if (!from || !to) return null;

                  const progress   = plane.progress ?? 0;
                  const position   = interpolateCoordinates(from, to, progress);
                  const isBlocked  = plane.status === "blocked";
                  const isCancelled= plane.status === "cancelled";
                  const isRescued  = plane.status === "rescued";
                  const isSelected = isPlaneSelected(plane.id);
                  const isHighlighted = highlightedId === plane.id;
                  const passesFilter = flightPassesFilter(plane.status);

                  // ── Paso 8: Determinar si está en tierra ──
                  const isOnGround = progress <= 0.01 || progress >= 0.99;
                  const isPreDeparture = progress <= 0.01;
                  const isPostArrival = progress >= 0.99;

                  const dx = to.coordinates[0] - from.coordinates[0];
                  const dy = to.coordinates[1] - from.coordinates[1];
                  const angle = Math.atan2(-dy, dx) * (180 / Math.PI) + 45;

                  // Ícono según estado
                  let planeIcon = "✈";
                  let planeSize = "15px";
                  if (isBlocked || isCancelled) {
                    planeIcon = "✖";
                    planeSize = "12px";
                  } else if (isOnGround) {
                    planeIcon = isPreDeparture ? "⏳" : "🛬";
                    planeSize = "10px";
                  }

                  return (
                    <Marker
                      key={`plane-${plane.id}`}
                      coordinates={position}
                      style={{ transition: "transform 1.05s linear" }}
                    >
                      <g
                        className={`ct-aircraft-pin ct-aircraft-pin--${plane.status} ${
                          isSelected || isHighlighted ? "ct-aircraft-pin--selected" : ""
                        }`}
                        role="button"
                        tabIndex={0}
                        aria-label={`Vuelo ${plane.from} → ${plane.to}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedPlane(plane);
                          onAircraftSelect(plane.id);
                          // Paso 3: Notificar al bridge (Mapa→Panel)
                          setFocusedEntity('flight', plane.id, 'map');
                        }}
                        onKeyDown={(e) => e.key === "Enter" && onAircraftSelect(plane.id)}
                        style={{ 
                          cursor: "pointer", 
                          color: isCancelled ? "#ef4444" : isRescued ? "#3b82f6" : undefined,
                          opacity: passesFilter ? getOpacity(plane.id, 1) : 0.08,
                          transition: "opacity 0.3s ease, color 0.3s ease"
                        }}
                      >
                        <circle
                          r={isSelected || isHighlighted ? 13 : isOnGround ? 6 : 10}
                          fill={isOnGround ? "rgba(100,116,139,0.25)" : "rgba(15, 23, 42, 0.4)"}
                          stroke={isHighlighted ? "#facc15" : getStrokeColor(plane.status)}
                          strokeWidth={isSelected || isHighlighted ? 2.5 : 1}
                          style={{
                            transition: "all 0.3s ease",
                            animation: isHighlighted ? "ct-exception-pulse 1s 3 ease-in-out" : undefined,
                          }}
                        />
                        <text
                          textAnchor="middle"
                          dominantBaseline="central"
                          className={isBlocked ? "ct-aircraft-pin__blocked" : "ct-aircraft-pin__icon"}
                          y={0}
                          transform={isBlocked || isCancelled || isOnGround ? "" : `rotate(${angle})`}
                          style={{ fontSize: planeSize, fill: "currentColor", transition: "font-size 0.3s ease" }}
                        >
                          {planeIcon}
                        </text>
                      </g>
                    </Marker>
                  );
                })}
              </>
            );
          })()}

          {/* ── Marcadores de aeropuerto ──────────────────────────────────── */}
          {airports.map((airport) => {
            const metrics    = activeMetrics[airport.icao];
            const level      = metrics?.level ?? "green";
            const isSaturated= isCollapseScenario && metrics?.isSaturated;
            const isSelected = selectedAirportCode === airport.icao;
            const stockBags  = metrics?.load ?? 0;
            const maxCap     = metrics?.capacity ?? "—";
            const isHighlighted = highlightedId === airport.icao;
            const passesFilter = airportPassesFilter(airport.icao);

            return (
              <Marker key={airport.icao} coordinates={airport.coordinates}>
                <g
                  className={`ct-airport-marker ct-airport-marker--${level} ${
                    isSaturated ? "ct-airport-marker--saturated" : ""
                  } ${isSelected || isHighlighted ? "ct-airport-marker--selected" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`Aeropuerto ${airport.icao}`}
                  title={`Aeropuerto ${airport.icao}\nStock: ${stockBags} maletas / Capacidad: ${maxCap}`}
                  onClick={() => {
                    onAirportSelect(airport.icao);
                    // Paso 3: Notificar al bridge (Mapa→Panel)
                    setFocusedEntity('airport', airport.icao, 'map');
                  }}
                  onKeyDown={(e) => e.key === "Enter" && onAirportSelect(airport.icao)}
                  style={{
                    cursor: "pointer",
                    opacity: passesFilter ? 1 : 0.1,
                    transition: "opacity 0.3s ease",
                    pointerEvents: passesFilter ? "auto" : "none",
                  }}
                >
                  <circle
                    r={isSaturated ? 11 : isHighlighted ? 12 : 8}
                    className="ct-airport-marker__ring"
                    style={{
                      animation: isHighlighted ? "ct-exception-pulse 1s 3 ease-in-out" : undefined,
                      stroke: isHighlighted ? "#facc15" : undefined,
                    }}
                  />
                  <circle r={isSaturated ? 6 : 4.5} className="ct-airport-marker__dot" />
                  <text y={-13} textAnchor="middle" className="ct-airport-marker__label">
                    {airport.icao}
                  </text>
                  <text y={22} textAnchor="middle" className="ct-airport-marker__city">
                    {airport.city}
                  </text>
                </g>
              </Marker>
            );
          })}


          {/* ── Tooltip Interactivo Flotante sobre Avión Seleccionado (foreignObject) ── */}
          {selectedPlane && (() => {
            const from = airportByIcao[selectedPlane.from];
            const to   = airportByIcao[selectedPlane.to];
            if (!from || !to) return null;
            const progress = selectedPlane.progress ?? 0;
            const position = interpolateCoordinates(from, to, progress);
            
            const isNearBottomEdge = position[1] < -20;
            const tooltipY = isNearBottomEdge ? 20 : -55;

            return (
              <Marker coordinates={position}>
                <foreignObject
                  x={-85}
                  y={tooltipY}
                  width={170}
                  height={75}
                  style={{ pointerEvents: "auto", overflow: "visible" }}
                >
                  <div style={{
                    background: "rgba(15, 23, 42, 0.96)",
                    border: `1.5px solid ${getStrokeColor(selectedPlane.status)}`,
                    borderRadius: "6px",
                    padding: "6px 8px",
                    color: "white",
                    fontSize: "12px",
                    boxShadow: "0 4px 15px rgba(0,0,0,0.6)",
                    fontFamily: "sans-serif",
                    textAlign: "center",
                    backdropFilter: "blur(4px)"
                  }}>
                    <div style={{ fontWeight: "bold", color: "#60a5fa", marginBottom: "2px" }}>
                      ✈️ Vuelo {selectedPlane.id.toString().replace("vuelo-", "").split("-")[0]}
                    </div>
                    <div style={{ fontSize: "11px", color: "#e2e8f0" }}>
                      {selectedPlane.from} ➔ {selectedPlane.to} | {systemClock.split(" - ")[1] || systemClock}
                    </div>
                    {selectedPlane.ocupacionReal != null && selectedPlane.capacidadMax != null && (
                      <div style={{ fontSize: "10px", color: "#9ca3af", marginTop: "2px" }}>
                        Stock: {selectedPlane.ocupacionReal} / {selectedPlane.capacidadMax} maletas
                      </div>
                    )}
                  </div>
                </foreignObject>
              </Marker>
            );
          })()}

        </ZoomableGroup>
      </ComposableMap>

    </div>
  );
};

export default WorldMap;
