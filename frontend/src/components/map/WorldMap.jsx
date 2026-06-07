import { useRef, useEffect, useState } from "react";
import { ComposableMap, Geographies, Geography, Marker, Line, ZoomableGroup } from "react-simple-maps";
import { interpolateCoordinates } from "../../data/airportsData";

const GEO_URL = "/world-110m.json";

const PROJECTION_CONFIG = {
  rotate: [-20, 0, 0],
  scale: 220,
  center: [15, 10],
};

/**
 * useSmoothProgress — Interpola suavemente el progress de cada avión.
 *
 * WorldMap — Componente raíz del mapa interactivo.
 *
 * Utiliza transiciones CSS (GPU) en los Markers para interpolación lineal fluida,
 * eliminando tirones causados por recálculos de React a 60fps.
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
  zoom = 1,
  center = [0, 20],
  onMoveEnd = () => {},
  systemClock = "--:--:--",
}) => {
  // Estados para Tooltip de Aviones y Desvanecimiento de líneas
  const [selectedPlane, setSelectedPlane] = useState(null);
  const [completedPlanes, setCompletedPlanes] = useState([]);
  const prevActivePlanesRef = useRef([]);

  // Detectar vuelos completados para desvanecimiento
  useEffect(() => {
    const prevPlanes = prevActivePlanesRef.current;
    const currentIds = new Set(activeAircraft.map(p => p.id));
    
    // Encontrar aviones que estaban activos pero ya no lo están
    const newlyCompleted = prevPlanes.filter(p => !currentIds.has(p.id));
    
    if (newlyCompleted.length > 0) {
      const now = Date.now();
      setCompletedPlanes(prev => [
        ...prev,
        ...newlyCompleted.map(p => ({ ...p, completedAt: now }))
      ]);
    }
    
    prevActivePlanesRef.current = activeAircraft;
  }, [activeAircraft]);

  // Limpiar vuelos desvanecidos después de 3 segundos
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setCompletedPlanes(prev => prev.filter(p => now - p.completedAt < 3000));
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Mantener actualizado el avión seleccionado en tooltip
  useEffect(() => {
    if (selectedPlane) {
      const current = activeAircraft.find(p => p.id === selectedPlane.id);
      if (current) {
        setSelectedPlane(current);
      } else {
        const completed = completedPlanes.find(p => p.id === selectedPlane.id);
        if (!completed) {
          setSelectedPlane(null);
        }
      }
    }
  }, [activeAircraft, completedPlanes, selectedPlane]);

  const getStrokeColor = (status) => {
    switch (status) {
      case "cancelled": return "#f43f5e"; // rojo neón
      case "critical": return "#f59e0b"; // ámbar neón
      case "blocked": return "#e11d48"; // rosa neón
      case "rescued": return "#3b82f6"; // azul neón
      default: return "#10b981"; // verde neón
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
      <ComposableMap
        projection="geoMercator"
        projectionConfig={PROJECTION_CONFIG}
        className="ct-world-map__svg"
      >
        <ZoomableGroup zoom={zoom} center={center} onMoveEnd={onMoveEnd} maxZoom={8}>

          {/* ── Países ──────────────────────────────────────────────────────── */}
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

          {/* ── Lógica de atenuación (Focus) ── */}
          {(() => {
            const hasSelection = selectedAircraftId != null || selectedPlane != null;
            const isPlaneSelected = (planeId) => selectedAircraftId === planeId || (selectedPlane?.id === planeId);
            const getOpacity = (planeId, baseOpacity) => hasSelection ? (isPlaneSelected(planeId) ? baseOpacity : 0.15) : baseOpacity;

            return (
              <>
                {/* ── Arcos de vuelos en tránsito (Activos - Líneas Neón de Alto Contraste) ── */}
                {activeAircraft.map((plane) => {
                  const from = airportByIcao[plane.from];
                  const to   = airportByIcao[plane.to];
                  if (!from || !to) return null;
                  const strokeColor = getStrokeColor(plane.status);
                  const isSelected = isPlaneSelected(plane.id);
                  return (
                    <Line
                      key={`arc-${plane.id}`}
                      from={from.coordinates}
                      to={to.coordinates}
                      stroke={strokeColor}
                      strokeWidth={isSelected ? 3.5 : 2.5}
                      style={{
                        filter: isSelected ? `drop-shadow(0 0 6px ${strokeColor})` : `drop-shadow(0 0 2px ${strokeColor})`,
                        opacity: getOpacity(plane.id, 0.85),
                        transition: "opacity 0.3s ease, stroke-width 0.3s ease, filter 0.3s ease",
                        cursor: "pointer"
                      }}
                      strokeLinecap="round"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedPlane(plane);
                        onAircraftSelect(plane.id);
                      }}
                    />
                  );
                })}

                {/* ── Arcos de vuelos recién finalizados (Desvanecimiento automático) ── */}
                {completedPlanes.map((plane) => {
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
                        animation: "ct-fade-out-line 3s forwards ease-out",
                        strokeDasharray: "4 4",
                        opacity: getOpacity(plane.id, 1)
                      }}
                      strokeLinecap="round"
                    />
                  );
                })}

                {/* ── Aviones con movimiento suavizado e Interactivo (onClick) ── */}
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

                  return (
                    <Marker
                      key={`plane-${plane.id}`}
                      coordinates={position}
                      style={{ transition: "transform 1.05s linear" }}
                    >
                      <g
                        className={`ct-aircraft-pin ct-aircraft-pin--${plane.status} ${
                          isSelected ? "ct-aircraft-pin--selected" : ""
                        }`}
                        role="button"
                        tabIndex={0}
                        aria-label={`Vuelo ${plane.from} → ${plane.to}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedPlane(plane);
                          onAircraftSelect(plane.id);
                        }}
                        onKeyDown={(e) => e.key === "Enter" && onAircraftSelect(plane.id)}
                        style={{ 
                          cursor: "pointer", 
                          color: isCancelled ? "#ef4444" : isRescued ? "#3b82f6" : undefined,
                          opacity: getOpacity(plane.id, 1),
                          transition: "opacity 0.3s ease, color 0.3s ease"
                        }}
                      >
                        <circle r={isSelected ? 13 : 10} fill="rgba(15, 23, 42, 0.4)" stroke={getStrokeColor(plane.status)} strokeWidth={isSelected ? 2 : 1} style={{ transition: "all 0.3s ease" }} />
                        <text
                          textAnchor="middle"
                          dominantBaseline="central"
                          className={isBlocked ? "ct-aircraft-pin__blocked" : "ct-aircraft-pin__icon"}
                          y={0}
                          style={{ fontSize: isBlocked || isCancelled ? "12px" : "15px", fill: "currentColor", transition: "font-size 0.3s ease" }}
                        >
                          {isBlocked ? "✖" : isCancelled ? "✖" : "✈"}
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

            return (
              <Marker key={airport.icao} coordinates={airport.coordinates}>
                <g
                  className={`ct-airport-marker ct-airport-marker--${level} ${
                    isSaturated ? "ct-airport-marker--saturated" : ""
                  } ${isSelected ? "ct-airport-marker--selected" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`Aeropuerto ${airport.icao}`}
                  onClick={() => onAirportSelect(airport.icao)}
                  onKeyDown={(e) => e.key === "Enter" && onAirportSelect(airport.icao)}
                  style={{ cursor: "pointer" }}
                >
                  <circle r={isSaturated ? 11 : 8} className="ct-airport-marker__ring" />
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
            
            // Opción 1: Detección de bordes dinámica usando latitud.
            // Si la latitud es muy al sur (menor a -20), dibujamos el Tooltip hacia arriba en lugar de hacia abajo.
            const isNearBottomEdge = position[1] < -20;
            const tooltipY = isNearBottomEdge ? 20 : -55;

            return (
              <Marker coordinates={position}>
                <foreignObject
                  x={-85}
                  y={tooltipY}
                  width={170}
                  height={60}
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
