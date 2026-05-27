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
 * El backend actualiza progress cada ~250 ms en saltos discretos (1 valor por hora).
 * Este hook mantiene un estado interno que avanza hacia el target usando rAF,
 * produciendo una animación continua sin saltos.
 *
 * @param {Array} activeAircraft - Lista de aviones con { id, progress, from, to, status }
 * @param {number} smoothingMs   - Tiempo (ms) para alcanzar el target (default 800 ms)
 */
function useSmoothProgress(activeAircraft, smoothingMs = 800) {
  const [smoothed, setSmoothed] = useState({});
  const targetRef  = useRef({});
  const currentRef = useRef({});
  const rafRef     = useRef(null);
  const lastRef    = useRef(null);

  // Actualizar targets cuando llegan nuevos datos del backend
  useEffect(() => {
    activeAircraft.forEach((plane) => {
      const id = plane.id;
      targetRef.current[id] = plane.progress ?? 0;
      // Inicializar si es la primera vez que vemos este avión
      if (currentRef.current[id] == null) {
        currentRef.current[id] = plane.progress ?? 0;
      }
    });
  }, [activeAircraft]);

  // Loop de animación: avanza currentRef hacia targetRef en cada frame
  useEffect(() => {
    function animate(timestamp) {
      if (lastRef.current == null) lastRef.current = timestamp;
      const delta = Math.min(timestamp - lastRef.current, 50); // cap a 50 ms/frame
      lastRef.current = timestamp;

      let changed = false;

      Object.keys(targetRef.current).forEach((id) => {
        const target  = targetRef.current[id] ?? 0;
        const current = currentRef.current[id] ?? 0;
        const diff    = target - current;

        if (Math.abs(diff) < 0.0001) {
          if (currentRef.current[id] !== target) {
            currentRef.current[id] = target;
            changed = true;
          }
          return;
        }

        // Avance proporcional al delta: alcanza el target en ~smoothingMs
        const step = diff * Math.min(1, delta / smoothingMs);
        currentRef.current[id] = current + step;
        changed = true;
      });

      if (changed) {
        setSmoothed({ ...currentRef.current });
      }

      rafRef.current = requestAnimationFrame(animate);
    }

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return smoothed;
}

/**
 * WorldMap — Componente raíz del mapa interactivo.
 *
 * Los aviones usan useSmoothProgress para interpolar continuamente entre
 * los valores discretos que devuelve el backend, eliminando los saltos.
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
}) => {
  // Progreso suavizado por interpolación en cliente
  const smoothedProgress = useSmoothProgress(activeAircraft, 900);

  return (
    <div className="ct-world-map" aria-label="Mapa de operaciones global">
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
            />
          )}

          {/* ── Arcos de vuelos en tránsito ─────────────────────────────── */}
          {activeAircraft.map((plane) => {
            const from = airportByIcao[plane.from];
            const to   = airportByIcao[plane.to];
            if (!from || !to) return null;
            return (
              <Line
                key={`arc-${plane.id}`}
                from={from.coordinates}
                to={to.coordinates}
                className={`ct-map-flight-arc ct-map-flight-arc--${plane.status}`}
                strokeLinecap="round"
              />
            );
          })}

          {/* ── Aviones con movimiento suavizado ─────────────────────────── */}
          {activeAircraft.map((plane) => {
            const from = airportByIcao[plane.from];
            const to   = airportByIcao[plane.to];
            if (!from || !to) return null;

            // Usar progress suavizado (interpolado por rAF) en lugar del discreto
            const progress   = smoothedProgress[plane.id] ?? plane.progress ?? 0;
            const position   = interpolateCoordinates(from, to, progress);
            const isBlocked  = plane.status === "blocked";
            const isCancelled= plane.status === "cancelled";
            const isRescued  = plane.status === "rescued";

            return (
              <Marker
                key={`plane-${plane.id}`}
                coordinates={position}
                // Sin transition CSS — el movimiento lo controla useSmoothProgress vía rAF
              >
                <g
                  className={`ct-aircraft-pin ct-aircraft-pin--${plane.status} ${
                    selectedAircraftId === plane.id ? "ct-aircraft-pin--selected" : ""
                  }`}
                  role="button"
                  tabIndex={0}
                  aria-label={`Vuelo ${plane.from} → ${plane.to}${isBlocked ? " — BLOQUEADO" : ""}${isCancelled ? " — CANCELADO" : ""}${isRescued ? " — RESCATADO" : ""}`}
                  onClick={() => onAircraftSelect(plane.id)}
                  onKeyDown={(e) => e.key === "Enter" && onAircraftSelect(plane.id)}
                  style={{ cursor: "pointer", color: isCancelled ? "#ef4444" : isRescued ? "#3b82f6" : undefined }}
                >
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    className={isBlocked ? "ct-aircraft-pin__blocked" : "ct-aircraft-pin__icon"}
                    y={0}
                    style={{ fontSize: isBlocked || isCancelled ? "12px" : "16px", fill: "currentColor" }}
                  >
                    {isCancelled ? "💥" : isBlocked ? "⚠️" : "✈"}
                  </text>
                </g>
              </Marker>
            );
          })}

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
                  aria-label={`Aeropuerto ${airport.icao} en ${airport.city}`}
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

        </ZoomableGroup>
      </ComposableMap>
    </div>
  );
};

export default WorldMap;
