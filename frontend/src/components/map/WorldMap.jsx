import React, { useRef, useEffect, useState } from "react";
import { ComposableMap, Geographies, Geography, Marker, Line, ZoomableGroup } from "react-simple-maps";
import { interpolateCoordinates } from "../../data/airportsData";

const GEO_URL = "/world-110m.json";

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

const AirportMarkers = React.memo(({ airports, activeMetrics, isCollapseScenario, selectedAirportCode, showCityLabels, onAirportSelect }) => (
  <>
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
            {showCityLabels && (
              <text y={22} textAnchor="middle" className="ct-airport-marker__city">
                {airport.city}
              </text>
            )}
          </g>
        </Marker>
      );
    })}
  </>
));

const FlightLayer = React.memo(({ activeAircraft, airportByIcao, selectedAircraftId, onAircraftSelect, currentEpochTime }) => {
  // Simplificación: Ya no interpolamos localmente porque el hook useControlTowerController
  // ya nos provee un currentEpochTime suavizado (interpolatedTime) a 60 FPS.
  const simNow = currentEpochTime;

  return (
    <>
      {activeAircraft.map((plane) => {
        const dep = plane.departureTime;
        const arr = plane.arrivalTime;
        if (!dep || !arr || arr <= dep) return null;

        let p = (simNow - dep) / (arr - dep);
        if (p < 0 || p > 1) return null;
        if (p === 1) p = 0.999;

        const from = airportByIcao[plane.from];
        const to   = airportByIcao[plane.to];
        if (!from || !to) return null;

        const position   = interpolateCoordinates(from, to, p);
        const isBlocked  = plane.status === "blocked";
        const isCancelled= plane.status === "cancelled";
        const isRescued  = plane.status === "rescued";
        const isSelected = selectedAircraftId === plane.id;

        const dx = to.coordinates[0] - from.coordinates[0];
        const dy = to.coordinates[1] - from.coordinates[1];
        // Fix: El path del avión ya apunta a la derecha (0 grados). 
        // atan2(-dy, dx) nos da el ángulo SVG correcto sin necesidad de offset.
        const angle = Math.atan2(-dy, dx) * (180 / Math.PI);

        return (
          <Marker key={`plane-${plane.id}`} coordinates={position}>
            <g
              className={`ct-aircraft-pin ct-aircraft-pin--${plane.status} ${
                isSelected ? "ct-aircraft-pin--selected" : ""
              }`}
              role="button"
              tabIndex={0}
              aria-label={`Vuelo ${plane.from} → ${plane.to}`}
              onClick={() => onAircraftSelect(plane.id)}
              onKeyDown={(e) => e.key === "Enter" && onAircraftSelect(plane.id)}
              style={{ cursor: "pointer", color: isCancelled ? '#ef4444' : isRescued ? '#10b981' : undefined }}
            >
              {/* Hitbox aumentada para interacción */}
              <circle r={15} fill="transparent" />
              
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
    </>
  );
});

/**
 * WorldMap — Componente raíz del mapa interactivo.
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
}) => {

  return (
    <div className="ct-world-map" aria-label="Mapa de operaciones global">
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

          <AirportMarkers 
            airports={airports}
            activeMetrics={activeMetrics}
            isCollapseScenario={isCollapseScenario}
            selectedAirportCode={selectedAirportCode}
            showCityLabels={showCityLabels}
            onAirportSelect={onAirportSelect}
          />

        </ZoomableGroup>
      </ComposableMap>
    </div>
  );
};

export default WorldMap;
