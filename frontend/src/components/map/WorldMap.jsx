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
  const lastUpdateRef = useRef(Date.now());
  const dynamicSmoothingRef = useRef(smoothingMs);

  // Actualizar targets cuando llegan nuevos datos del backend
  useEffect(() => {
    const now = Date.now();
    const timeSinceLast = now - lastUpdateRef.current;
    if (timeSinceLast > 100 && timeSinceLast < 30000) {
      dynamicSmoothingRef.current = timeSinceLast;
    }
    lastUpdateRef.current = now;

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

        // Avance proporcional al delta: alcanza el target en ~dynamicSmoothingRef
        const step = diff * Math.min(1, delta / dynamicSmoothingRef.current);
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
  showCityLabels = true,
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

            const progress = smoothedProgress[plane.id] ?? plane.progress ?? 0;
            if (progress <= 0 || progress >= 1) return null;

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
            if (progress <= 0 || (progress >= 1 && targetRef.current[plane.id] >= 1 && Math.abs(progress - 1) < 0.001)) return null;

            const position   = interpolateCoordinates(from, to, progress);
            const isBlocked  = plane.status === "blocked";
            const isCancelled= plane.status === "cancelled";
            const isRescued  = plane.status === "rescued";
            const isSelected = selectedAircraftId === plane.id;

            const dx = to.coordinates[0] - from.coordinates[0];
            const dy = to.coordinates[1] - from.coordinates[1];
            const angle = Math.atan2(-dy, dx) * (180 / Math.PI) + 90;

            return (
              <Marker
                key={`plane-${plane.id}`}
                coordinates={position}
                // Sin transition CSS — el movimiento lo controla useSmoothProgress vía rAF
              >
                <g
                  className={`ct-aircraft-pin ct-aircraft-pin--${plane.status} ${
                    isSelected ? "ct-aircraft-pin--selected" : ""
                  }`}
                  role="button"
                  tabIndex={0}
                  aria-label={`Vuelo ${plane.from} → ${plane.to}${isBlocked ? " — BLOQUEADO" : ""}${isCancelled ? " — CANCELADO" : ""}${isRescued ? " — RESCATADO" : ""}`}
                  onClick={() => onAircraftSelect(plane.id)}
                  onKeyDown={(e) => e.key === "Enter" && onAircraftSelect(plane.id)}
                  style={{ cursor: "pointer", color: isCancelled ? '#ef4444' : isRescued ? '#10b981' : undefined }}
                >
                  <g transform={`rotate(${angle}) scale(0.6)`}>
                    {isCancelled ? (
                      <text textAnchor="middle" dominantBaseline="central" fontSize="20" transform={`rotate(${-angle})`}>💥</text>
                    ) : isBlocked ? (
                      <text textAnchor="middle" dominantBaseline="central" fontSize="20" transform={`rotate(${-angle})`}>⚠️</text>
                    ) : (
                      <path
                        d="M10,2 L14,8 L22,8 C23.1,8 24,8.9 24,10 C24,11.1 23.1,12 22,12 L14,12 L10,18 L7,18 L9,12 L3,12 L1,14 L-1,14 L0,10 L-1,6 L1,6 L3,8 L9,8 L7,2 L10,2 Z"
                        transform="translate(-12, -10)"
                        fill="currentColor"
                      />
                    )}
                  </g>
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
                  {/* Anillo exterior (pulso) */}
                  <circle r={isSaturated ? 11 : 8} className="ct-airport-marker__ring" />
                  {/* Punto central */}
                  <circle r={isSaturated ? 6 : 4.5} className="ct-airport-marker__dot" />
                  {/* Etiqueta ICAO */}
                  <text
                    y={-13}
                    textAnchor="middle"
                    className="ct-airport-marker__label"
                  >
                    {airport.icao}
                  </text>
                  {/* Etiqueta ciudad (se oculta en mobile via CSS) */}
                  {showCityLabels && (
                    <text
                      y={22}
                      textAnchor="middle"
                      className="ct-airport-marker__city"
                    >
                      {airport.city}
                    </text>
                  )}
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
