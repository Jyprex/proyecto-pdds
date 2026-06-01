/**
 * controlTowerData.js
 *
 * Datos de orquestación del Control Tower: escenarios, vuelos de muestra
 * y métricas por escenario.
 *
 * Los datos maestros de aeropuertos (coordenadas, capacidad, etc.)
 * se encuentran en airportsData.js para mayor escalabilidad.
 */

import {
  AIRPORTS,
  AIRPORT_BY_ICAO,
  buildAirportMetrics,
  getCapacityLevel,
  getCapacityLabel,
} from "./airportsData";

export { AIRPORTS as AIRPORT_NODES, AIRPORT_BY_ICAO as AIRPORT_BY_CODE };

// ── Pestañas de escenario ──────────────────────────────────────────────────────
export const SCENARIO_TABS = [
  { key: "vivo", label: "Operación Día a Día" },
  { key: "periodo", label: "Simulación Periodo" },
  { key: "colapso", label: "Simulación Colapso" },
  /* EXPERIMENTAL MODE - DISABLED FOR BUSINESS UI
  { key: "analisis", label: "Análisis Numérico" },
  { key: "comparacion", label: "Benchmark ALNS/HGA" },
  */
];

// ── Top aeropuertos por ocupación — escenario normal ─────────────────────────
export const AIRPORT_ROWS = [
  { city: "Bogotá", capacity: "49.0%" },
  { city: "Bruselas", capacity: "46.5%" },
  { city: "Roma", capacity: "44.2%" },
  { city: "Delhi", capacity: "42.8%" },
  { city: "Nueva Delhi", capacity: "40.1%" },
  { city: "Berlín", capacity: "38.6%" },
  { city: "Lima", capacity: "38.0%" },
];

// ── Top aeropuertos por ocupación — escenario colapso ────────────────────────
export const COLLAPSE_AIRPORT_ROWS = [
  { city: "Bogotá", capacity: "100.0%" },
  { city: "Lima", capacity: "100.0%" },
  { city: "Bruselas", capacity: "100.0%" },
  { city: "Delhi", capacity: "100.0%" },
  { city: "Madrid", capacity: "98.3%" },
  { city: "París", capacity: "97.1%" },
  { city: "Riad", capacity: "96.5%" },
];

// ── Vuelos de muestra (usa códigos ICAO, alineados con planes_vuelo.txt) ──────
export const AIRCRAFT = [
  { id: 1, from: "SKBO", to: "EDDI", progress: 0.50, status: "normal" },
  { id: 2, from: "EBCI", to: "VIDP", progress: 0.42, status: "critical" },
  { id: 3, from: "LOWW", to: "SKBO", progress: 0.55, status: "normal" },
  { id: 4, from: "LATI", to: "VIDP", progress: 0.40, status: "high" },
  { id: 5, from: "OERK", to: "EDDI", progress: 0.52, status: "normal" },
  { id: 6, from: "SBBR", to: "SPIM", progress: 0.63, status: "high" },
  { id: 7, from: "SCEL", to: "SABE", progress: 0.37, status: "normal" },
  { id: 8, from: "SEQM", to: "SKBO", progress: 0.62, status: "critical" },
  { id: 9, from: "OERK", to: "OMDB", progress: 0.51, status: "normal" },
  { id: 10, from: "SLLP", to: "SCEL", progress: 0.58, status: "high" },
];

// ── Ocupación de colapso por código ICAO ──────────────────────────────────────
const COLLAPSE_OCCUPANCIES = {
  SKBO: 100, SEQM: 100, SVMI: 92,  SBBR: 96,
  SPIM: 100, SLLP: 91,  SCEL: 93,  SABE: 91,
  SGAS: 88,  SUAA: 89,
  LATI: 95,  EDDI: 91,  LOWW: 92,  EBCI: 100,
  UMMS: 88,  LBSF: 90,  LKPR: 89,  LDZA: 87,
  EKCH: 94,  EHAM: 97,
  VIDP: 100, OSDI: 88,  OERK: 92,  OMDB: 90,
  OAKB: 85,  OOMS: 86,  OYSN: 84,  OPKC: 91,
  UBBB: 88,  OJAI: 86,
};

// ── Métricas pre-calculadas ────────────────────────────────────────────────────
export const AIRPORT_METRICS = buildAirportMetrics(AIRPORTS);
export const COLLAPSE_AIRPORT_METRICS = buildAirportMetrics(AIRPORTS, COLLAPSE_OCCUPANCIES);

// ── Estado de avión en colapso ────────────────────────────────────────────────
export const getCollapseAircraftStatus = (plane = {}, collapseMetrics = {}) => {
  const dest = collapseMetrics[plane.to];
  if (!dest) return plane.status ?? "normal";
  if (dest.occupancy >= 100) return "blocked";
  if (dest.occupancy >= 90) return "critical";
  if (dest.occupancy >= 70) return "high";
  return "normal";
};

// ── Resúmenes por escenario ───────────────────────────────────────────────────
export const SUMMARY_BY_SCENARIO = {
  vivo: {
    scenarioLabel: "Operación día a día",
    operationStart: "12:28 AM",
    systemClock: "2026-04-09 14:28",
    globalCapacity: "68%",
    networkLatency: "12MS",
    flightsInCourse: { value: 142, delta: "+6 vs última hora", status: "green" },
    storageOccupancy: { value: 68, subtitle: "Promedio red · 30 aeropuertos", status: "green" },
    sla: { value: 93.4, subtitle: "2,118 / 2,268 entregas", status: "green" },
    criticalNodes: { value: 3, subtitle: "2 almacenes >90% · 1 ruta bloqueada", status: "red" },
    progress: { label: "Tiempo real", percent: 0, simulatedTime: "00:36:22 simulado", status: "green" },
    transitByContinent: { america: 5420, europe: 3870, asia: 4110 },
  },
  periodo: {
    scenarioLabel: "Simulación de periodo",
    operationStart: "12:28 AM",
    systemClock: "2026-04-12 09:16",
    globalCapacity: "74%",
    networkLatency: "16MS",
    flightsInCourse: { value: 167, delta: "+12 vs última hora", status: "amber" },
    storageOccupancy: { value: 74, subtitle: "Promedio red · 30 aeropuertos", status: "amber" },
    sla: { value: 89.8, subtitle: "2,984 / 3,323 entregas", status: "amber" },
    criticalNodes: { value: 5, subtitle: "4 almacenes >90% · 1 cancelación activa", status: "red" },
    progress: { label: "Día 4 / 5", percent: 78, simulatedTime: "00:49:10 simulado", status: "amber" },
    transitByContinent: { america: 6180, europe: 4460, asia: 4890 },
  },
  colapso: {
    scenarioLabel: "Simulación de colapso",
    operationStart: "12:28 AM",
    systemClock: "2026-04-14 03:42",
    globalCapacity: "92%",
    networkLatency: "25MS",
    flightsInCourse: { value: 214, delta: "+21 vs última hora", status: "red" },
    storageOccupancy: { value: 92, subtitle: "Promedio red · 30 aeropuertos", status: "red" },
    sla: { value: 73.6, subtitle: "3,112 / 4,228 entregas", status: "red" },
    criticalNodes: { value: 11, subtitle: "8 almacenes >90% · 3 rutas bloqueadas", status: "red" },
    progress: { label: "Punto de colapso", percent: 96, simulatedTime: "01:12:38 simulado", status: "red" },
    transitByContinent: { america: 8220, europe: 6090, asia: 7010 },
  },
};

// ── Re-exporta utilidades de airportsData para compatibilidad ─────────────────
export { getCapacityLevel, getCapacityLabel };
