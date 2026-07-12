import { PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { getStrokeColorRgb, getAveriaColorRgb, getStraightPath } from './utils';
import { AIRPORT_BY_ICAO, interpolateCoordinates } from '../../../data/airportsData';

export const createRoutesLayers = ({
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
}) => {
  const layers = [];

  // 1. Trails and Remaining Paths for Aircraft
  const trailLines = [];
  const remainingLines = [];

  activeAircraft.forEach(plane => {
    const from = airportByIcao[plane.from] || AIRPORT_BY_ICAO[plane.from];
    const to = airportByIcao[plane.to] || AIRPORT_BY_ICAO[plane.to];
    if (!from || !to) return;

    const progress = plane.progress ?? 0;
    const position = plane.position || interpolateCoordinates(from, to, progress);
    
    if (progress >= 0.99) return;

    const passesFilter = flightPassesFilter(plane.capacityPercent, plane.from, plane.to, plane.ocupacionReal);
    if (!passesFilter) return;

    const isEmpty = !plane.ocupacionReal || plane.ocupacionReal === 0;
    if (isEmpty && !showFlightsWithoutShipments) return;
    if (!isEmpty && !showFlightsWithShipments) return;

    // Solo dibujar línea de ruta si el avión tiene envíos
    if (isEmpty) return;

    const colorRgb = getStrokeColorRgb(plane.status, plane.ocupacionReal, plane.capacidadMax, 255);
    const isGreenPlane = colorRgb[0] === 16 && colorRgb[1] === 185 && colorRgb[2] === 129; 

    const isSelected = selectedAircraftId === plane.id;
    const pathWidth = isSelected ? 3 : 1;
    const isAircraftSelected = selectedAircraftId != null;
    const isTrackingActive = trackedRoute?.hops?.length > 0;
    const isDimmed = isAircraftSelected || isTrackingActive;
    const opacity = isDimmed ? (isSelected ? 255 : 40) : 150;
    const trailColor = isSelected
      ? [129, 140, 248, opacity]
      : [colorRgb[0], colorRgb[1], colorRgb[2], opacity];
    const remainingColor = isSelected
      ? [129, 140, 248, Math.max(20, opacity - 80)]
      : [colorRgb[0], colorRgb[1], colorRgb[2], Math.max(20, opacity - 80)];

    if (progress > 0.02) {
      trailLines.push({
        path: getStraightPath(from.coordinates, position),
        color: trailColor,
        width: pathWidth
      });
    }

    remainingLines.push({
      path: getStraightPath(position, to.coordinates),
      color: remainingColor,
      width: pathWidth
    });
  });

  if (trailLines.length > 0) {
    layers.push(new PathLayer({
      id: 'flight-trails-layer',
      data: trailLines,
      getPath: d => d.path,
      getColor: d => d.color,
      getWidth: d => d.width,
      widthUnits: 'pixels',
      jointRounded: true,
      capRounded: true
    }));
  }

  if (remainingLines.length > 0) {
    layers.push(new PathLayer({
      id: 'flight-remaining-layer',
      data: remainingLines,
      getPath: d => d.path,
      getColor: d => d.color,
      getWidth: d => d.width,
      widthUnits: 'pixels',
      jointRounded: true,
      capRounded: true
    }));
  }

  // Selected aircraft full route overlay
  const selectedPlane = selectedAircraftId ? activeAircraft.find(p => p.id === selectedAircraftId) : null
  if (selectedPlane) {
    const selFrom = airportByIcao[selectedPlane.from] || AIRPORT_BY_ICAO[selectedPlane.from]
    const selTo = airportByIcao[selectedPlane.to] || AIRPORT_BY_ICAO[selectedPlane.to]
    if (selFrom && selTo) {
      layers.push(new PathLayer({
        id: 'selected-aircraft-full-route',
        data: [{ path: getStraightPath(selFrom.coordinates, selTo.coordinates) }],
        getPath: d => d.path,
        getColor: [129, 140, 248, 180],
        getWidth: 3,
        widthUnits: 'pixels',
        jointRounded: true,
        capRounded: true
      }))
    }
  }

  // 2. Selected Route (from panel)
  // Si tenemos un vuelo trackeado (multihop), la línea azul directa confunde porque no se alinea con la ruta real.
  // Por ende, solo dibujamos la selected-route si NO hay saltos (o si es la ruta directa).
  if (selectedFromAirport && selectedToAirport && !(trackedRoute && trackedRoute.hops)) {
    layers.push(new PathLayer({
      id: 'selected-route-layer',
      data: [{ path: getStraightPath(selectedFromAirport.coordinates, selectedToAirport.coordinates) }],
      getPath: d => d.path,
      getColor: [129, 140, 248, 230], // #818cf8
      getWidth: 3,
      widthUnits: 'pixels',
      jointRounded: true,
      capRounded: true
    }));
  }

  // 3. Tracked Route (multi-hop)
  if (trackedRoute && trackedRoute.hops) {
    const trackPaths = [];
    const trackStops = [];
    
    trackedRoute.hops.forEach((hop, idx) => {
      const from = airportByIcao[hop.from] || AIRPORT_BY_ICAO[hop.from];
      const to = airportByIcao[hop.to] || AIRPORT_BY_ICAO[hop.to];
      if (from && to) {
        trackPaths.push({ path: getStraightPath(from.coordinates, to.coordinates) });
        trackStops.push({ coordinates: from.coordinates, label: `${idx + 1}` });
        
        if (idx === trackedRoute.hops.length - 1) {
          trackStops.push({ coordinates: to.coordinates, label: '🏁' });
        }
      }
    });

    layers.push(new PathLayer({
      id: 'tracked-route-lines',
      data: trackPaths,
      getPath: d => d.path,
      getColor: [167, 139, 250, 230], // #a78bfa
      getWidth: 3,
      widthUnits: 'pixels',
      jointRounded: true,
      capRounded: true
    }));

    layers.push(new ScatterplotLayer({
      id: 'tracked-route-stops',
      data: trackStops,
      getPosition: d => d.coordinates,
      getFillColor: [167, 139, 250, 76],
      getLineColor: [167, 139, 250, 255],
      lineWidthMinPixels: 2,
      radiusScale: 6,
      radiusMinPixels: 6,
      stroked: true
    }));

    layers.push(new TextLayer({
      id: 'tracked-route-labels',
      data: trackStops,
      getPosition: d => d.coordinates,
      getText: d => d.label,
      getSize: 10,
      getColor: [167, 139, 250, 255],
      getPixelOffset: [0, -12],
      characterSet: " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~áéíóúÁÉÍÓÚñÑüÜãÃ",
      fontWeight: 'bold'
    }));
  }

  // 4. Exception Highlight
  if (exceptionHighlight) {
    const exColor = exceptionHighlight.type === 'AVERIA'
      ? getAveriaColorRgb(exceptionHighlight.averiaType, 240)
      : [239, 68, 68, 240]; // #ef4444

    if (exceptionHighlight.type === 'TRAMO' && exceptionHighlight.origenIcao && exceptionHighlight.destinoIcao) {
      const from = airportByIcao[exceptionHighlight.origenIcao] || AIRPORT_BY_ICAO[exceptionHighlight.origenIcao];
      const to = airportByIcao[exceptionHighlight.destinoIcao] || AIRPORT_BY_ICAO[exceptionHighlight.destinoIcao];
      if (from && to) {
        layers.push(new PathLayer({
          id: 'exception-segment',
          data: [{ path: getStraightPath(from.coordinates, to.coordinates) }],
          getPath: d => d.path,
          getColor: exColor,
          getWidth: 4,
          widthUnits: 'pixels',
          jointRounded: true,
          capRounded: true
        }));
      }
    }

    if ((exceptionHighlight.type === 'NODO' || exceptionHighlight.type === 'AVERIA') && exceptionHighlight.origenIcao) {
      const airport = airportByIcao[exceptionHighlight.origenIcao] || AIRPORT_BY_ICAO[exceptionHighlight.origenIcao];
      if (airport) {
        layers.push(new ScatterplotLayer({
          id: 'exception-node-ring',
          data: [airport],
          getPosition: d => d.coordinates,
          getFillColor: [0, 0, 0, 0],
          getLineColor: exColor,
          lineWidthMinPixels: 3,
          radiusScale: 18,
          radiusMinPixels: 18,
          stroked: true
        }));
        
        layers.push(new TextLayer({
          id: 'exception-node-label',
          data: [airport],
          getPosition: d => d.coordinates,
          getText: () => exceptionHighlight.type === 'AVERIA' ? `⚠ T${exceptionHighlight.averiaType}` : '🚫 BLOQUEADO',
          getSize: 11,
          getColor: exColor,
          getPixelOffset: [0, 28],
          fontWeight: 'bold',
          characterSet: " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~áéíóúÁÉÍÓÚñÑüÜãÃ⚠🚫",
          outlineWidth: 2,
          outlineColor: [0, 0, 0, 255]
        }));
      }
    }
  }

  return layers;
};
