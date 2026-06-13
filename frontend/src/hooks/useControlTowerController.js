import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "./api";
import { createStompClient } from "./ws";
import {
  AIRPORT_NODES,
  AIRPORT_ROWS,
  COLLAPSE_AIRPORT_ROWS,
  SCENARIO_TABS,
} from "../data/controlTowerData";
import { AIRPORT_BY_ICAO, buildAirportMetrics, AIRPORTS } from "../data/airportsData";

const PANEL_VISIBILITY_DEFAULT = {
  telemetry: true,
  legend: true,
  occupancy: true,
  transitInventory: false,
  comparison: false,
  shipmentDetail: false,
  cancellation: false,
};

const KPI_COLLAPSED_STORAGE_KEY = "ct-kpi-collapsed";
const MAX_MAP_ROUTES = 140;
const STATUS_PRIORITY = {
  critical: 3,
  blocked: 3,
  rescued: 2,
  cancelled: 2,
  high: 1,
  normal: 0,
};

const readStoredKpiCollapsed = () => {
  if (typeof window === "undefined") return false;
  const stored = window.localStorage.getItem(KPI_COLLAPSED_STORAGE_KEY);
  return stored ? stored === "true" : false;
};

export const useControlTowerController = () => {
  const [activeTab, setActiveTab] = useState("vivo");
  const isCollapseScenario = activeTab === "colapso";
  const isSimScenario = activeTab === "periodo" || activeTab === "colapso";
  const [panelVisibility, setPanelVisibility] = useState(PANEL_VISIBILITY_DEFAULT);
  const [isKpiCollapsed, setIsKpiCollapsed] = useState(readStoredKpiCollapsed);
  const [selectedAircraftId, setSelectedAircraftId] = useState(null);
  const [selectedAirportCode, setSelectedAirportCode] = useState(null);
  const [isAirportDetailOpen, setIsAirportDetailOpen] = useState(false);
  const [isDockCollapsed, setIsDockCollapsed] = useState(false);
  const [isScenarioConfigOpen, setIsScenarioConfigOpen] = useState(false);
  const [selectedAlgorithm, setSelectedAlgorithm] = useState("alns");
  const [simState, setSimState] = useState("idle");
  const [simSpeed, setSimSpeed] = useState(1);
  const [isFluidMode, setIsFluidMode] = useState(false);
  const [targetPlaybackMinutes, setTargetPlaybackMinutes] = useState(30);

  const [sessionId, setSessionId] = useState(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      return params.get("session");
    }
    return null;
  });

  // Actualizar URL cuando cambia el sessionId
  useEffect(() => {
    if (typeof window !== "undefined") {
      const url = new URL(window.location);
      if (sessionId) {
        url.searchParams.set("session", sessionId);
      } else {
        url.searchParams.delete("session");
      }
      window.history.replaceState({}, "", url);
    }
  }, [sessionId]);

  /** Fase 1: Atomización del Estado para optimización de rendimiento */
  const [meta, setMeta] = useState({
    status: "idle", percent: 0, currentDay: 0, totalDays: 0,
    isCollapseMode: false, errorMessage: null, algorithm: "alns",
    startEpoch: null, totalAttended: 0, totalMissed: 0, slaFinal: 0,
    reports: []
  });
  const [kpis, setKpis] = useState({
    slaPercent: 0, globalOccupancy: 0, criticalNodes: 0,
    totalBagsWaiting: 0, rescuedFlights: 0, comparisonResults: null
  });
  const [airportLoads, setAirportLoads] = useState({});
  const [aircraft, setAircraft] = useState([]);
  const [masterPlan, setMasterPlan] = useState({ planId: null, routes: [] });
  const prevAircraftRef = useRef([]);
  const prevActiveIdsRef = useRef(new Set());
  const [clock, setClock] = useState({ simulatedTime: "--:--", currentEpochTime: 0 });
  const [smoothSimTime, setSmoothSimTime] = useState(0);
  const smoothSimTimeRef = useRef(0);
  const [realElapsedSecs, setRealElapsedSecs] = useState(0);
  const realStartRef = useRef(null);
  const [logs, setLogs] = useState([]);

  // ── BUFFER DE SNAPSHOTS PARA SIMULACIÓN FLUIDA ────────────────────────────
  const snapshotBufferRef = useRef([]);
  const BUFFER_MIN_SIZE = 1;

  /** Reconstrucción de liveStatus para compatibilidad con App.jsx y otros componentes */
  const liveStatus = useMemo(() => {
    if (!sessionId && meta.status === "idle") return null;
    return {
      ...meta,
      ...kpis,
      airportLoads,
      activeRoutes: aircraft,
      ...clock,
      interpolatedTime: smoothSimTime,
      eventLog: logs,
    };
  }, [meta, kpis, airportLoads, aircraft, clock, smoothSimTime, logs, sessionId]);

  // ── Clock local para interpolar movimiento y tiempo ───────────────────────
  const simClockRef = useRef({
    serverEpoch: 0,
    receivedAt: 0,
    lastSeq: -1,
    ratio: (5 * 24 * 60) / 30 
  });

  /** Loop de interpolación suave para el mapa y el reloj */
  useEffect(() => {
    let raf;
    let lastRealTime = performance.now();

    const update = () => {
      const now = performance.now();
      const delta = now - lastRealTime;
      lastRealTime = now;

      const isStillRunning = (simState === "running");

      if (isStillRunning) {
        const buffer = snapshotBufferRef.current;
        
        let maxTargetTime = smoothSimTimeRef.current;
        if (buffer.length > 0) {
            maxTargetTime = Math.max(smoothSimTimeRef.current, buffer[buffer.length - 1].epoch);
        }

        if (smoothSimTimeRef.current > 0) {
            const timeDiff = maxTargetTime - smoothSimTimeRef.current;
            let nextTime = smoothSimTimeRef.current;
            
            if (timeDiff > 0) {
                const totalDays = meta.totalDays > 0 ? meta.totalDays : 5;
                const totalSimulatedMs = totalDays * 24 * 60 * 60 * 1000;
                const targetPlaybackMs = (targetPlaybackMinutes || 30) * 60 * 1000;
                let baseRatio = meta.isRealTime ? 1 : (totalSimulatedMs / Math.max(1000, targetPlaybackMs));

                const idealDelayMs = baseRatio * 500; 
                let dynamicRatio = baseRatio;

                if (timeDiff > idealDelayMs * 3) {
                    nextTime = maxTargetTime - idealDelayMs;
                } else if (timeDiff > idealDelayMs * 1.5) {
                    dynamicRatio = baseRatio * 1.15; 
                } else if (timeDiff < idealDelayMs * 0.5) {
                    dynamicRatio = baseRatio * 0.85; 
                }

                nextTime += (delta * dynamicRatio);
            }
            
            if (nextTime > maxTargetTime) {
                nextTime = maxTargetTime;
            }
            
            smoothSimTimeRef.current = nextTime;
            setSmoothSimTime(smoothSimTimeRef.current);
        }

        let appliedClock = null;
        let appliedEpoch = null;
        let appliedRoutes = null;
        let appliedAirportLoads = null;
        let appliedKpis = null;
        let appliedPlanId = null;
        let appliedMasterPlan = null;
        
        while (buffer.length > 0 && buffer[0].epoch <= smoothSimTimeRef.current) {
          const snap = buffer.shift();
          if (snap.clock !== undefined) appliedClock = snap.clock;
          if (snap.epoch !== undefined) appliedEpoch = snap.epoch;
          if (snap.routes !== undefined) appliedRoutes = snap.routes;
          if (snap.airportLoads !== undefined) appliedAirportLoads = snap.airportLoads;
          if (snap.kpis !== undefined) appliedKpis = snap.kpis;
          if (snap.planId !== undefined) appliedPlanId = snap.planId;
          if (snap.masterPlan !== undefined) appliedMasterPlan = snap.masterPlan;
        }
        
        if (appliedClock !== null && appliedEpoch !== null) {
           setClock({ simulatedTime: appliedClock, currentEpochTime: appliedEpoch });
        }
        if (appliedRoutes !== null) {
           setAircraft(appliedRoutes);
        }
        if (appliedPlanId !== null && appliedMasterPlan !== null) {
            setMasterPlan(prev => {
                if (prev.planId === appliedPlanId) return prev;
                console.info(`[Fase 4] Nuevo Plan Maestro detectado: ${appliedPlanId}. Sincronizando horizontes futuros.`);
                return { planId: appliedPlanId, routes: appliedMasterPlan };
            });
        }
        if (appliedAirportLoads !== null) {
           setAirportLoads(appliedAirportLoads);
        }
        if (appliedKpis !== null) {
           const data = appliedKpis;
           if (data.startEpoch) {
               setMeta(prev => ({ ...prev, startEpoch: data.startEpoch }));
           }
           setKpis({
               slaPercent: data.slaPercent,
               globalOccupancy: data.globalOccupancy,
               criticalNodes: data.criticalNodes,
               totalBagsWaiting: data.totalBagsWaiting,
               rescuedFlights: data.rescuedFlights,
               comparisonResults: data.comparisonResults || null,
           });
           setMeta(prev => ({
               ...prev,
               status: data.status,
               percent: data.percent,
               currentDay: data.currentDay,
               totalDays: data.totalDays,
               isCollapseMode: data.isCollapseMode,
               errorMessage: data.errorMessage,
               startEpoch: data.startEpoch || prev.startEpoch
           }));

           if (data.status === 'DONE') {
               setSimState('completed');
               apiFetch(`/api/v1/simulation/status/${sessionId}`).then(res => {
                   if (res.ok) {
                       res.json().then(finalStatus => {
                           setMeta(prev => ({ ...prev, ...finalStatus }));
                       });
                   }
               });
           } else if (data.status === 'FAILED') {
               setSimState('idle');
           }
        }
      }
      
      if (realStartRef.current && isStillRunning) {
        setRealElapsedSecs(Math.floor((Date.now() - realStartRef.current) / 1000));
      }

      raf = requestAnimationFrame(update);
    };
    raf = requestAnimationFrame(update);
    return () => cancelAnimationFrame(raf);
  }, [simState, sessionId, targetPlaybackMinutes, meta.totalDays]);

  const togglePanel = useCallback((panelName = "") => {
    if (!panelName) return;
    setPanelVisibility((current) => ({ ...current, [panelName]: !current[panelName] }));
  }, []);

  const handleTabChange = useCallback((tabKey = "vivo") => {
    resetSimulation();
    setActiveTab(tabKey);
    setIsScenarioConfigOpen(false);
    if (tabKey === "periodo" || tabKey === "colapso") {
      setIsDockCollapsed(true);
    }
  }, [resetSimulation]);

  const toggleScenarioConfig = useCallback(() => {
    setIsScenarioConfigOpen((current) => !current);
  }, []);

  const toggleKpiStrip = useCallback(() => {
    setIsKpiCollapsed((current) => !current);
  }, []);

  const toggleDock = useCallback(() => {
    setIsDockCollapsed((current) => !current);
  }, []);

  const showShipmentDetail = useCallback(() => {
    setPanelVisibility((current) => ({ ...current, shipmentDetail: true }));
  }, []);

  const handleSelectAircraft = useCallback((aircraftId) => {
    if (!aircraftId) return;
    setSelectedAircraftId(aircraftId);
    showShipmentDetail();
  }, [showShipmentDetail]);

  const resetSimulation = useCallback(() => {
    setSimState("idle");
    setSessionId(null);
    setMeta({
      status: "idle", percent: 0, currentDay: 0, totalDays: 0,
      isCollapseMode: false, errorMessage: null, algorithm: selectedAlgorithm || "alns",
      startEpoch: null, totalAttended: 0, totalMissed: 0, slaFinal: 0,
      reports: []
    });
    setKpis({
      slaPercent: 0, globalOccupancy: 0, criticalNodes: 0,
      totalBagsWaiting: 0, rescuedFlights: 0, comparisonResults: null
    });
    setAirportLoads({});
    setAircraft([]);
    setClock({ simulatedTime: "--:--", currentEpochTime: 0 });
    setSmoothSimTime(0);
    smoothSimTimeRef.current = 0;
    setRealElapsedSecs(0);
    realStartRef.current = null;
    setLogs([]);
    snapshotBufferRef.current = [];
    simClockRef.current = { serverEpoch: 0, receivedAt: 0, ratio: 1 };
  }, [selectedAlgorithm]);

  const hideAirportDetail = useCallback(() => {
    setIsAirportDetailOpen(false);
  }, []);

  const showAirportDetail = useCallback((airportCode = "") => {
    if (!airportCode) return;
    setSelectedAirportCode(airportCode);
    setIsAirportDetailOpen(true);
  }, []);

  const startSimulation = useCallback(async (dias = 5) => {
    try {
      setSimState("running");
      setAircraft([]);
      setLogs([]);
      realStartRef.current = Date.now();
      setRealElapsedSecs(0);
      snapshotBufferRef.current = [];
      smoothSimTimeRef.current = 0;
      setSmoothSimTime(0);

      const res = await apiFetch(`/api/v1/simulation/run/${dias}?algorithm=${selectedAlgorithm}&playbackMinutes=${targetPlaybackMinutes}`, {
        method: "POST",
      });

      if (!res.ok) throw new Error(`Backend respondió ${res.status}`);

      const data = await res.json();
      setSessionId(data.sessionId);
    } catch (err) {
      console.error("[Tasf.B2B] Error al iniciar simulación:", err);
      setSimState("idle");
    }
  }, [selectedAlgorithm, targetPlaybackMinutes]);

  const cancelFlight = useCallback(async (flightId) => {
    if (!sessionId || !flightId) return;
    try {
      const res = await apiFetch(`/api/v1/simulation/cancel-flight/${sessionId}/${flightId}`, {
        method: "POST",
      });
      if (res.ok) {
        console.info(`[Tasf.B2B] Vuelo ${flightId} cancelado exitosamente.`);
      } else {
        console.error(`[Tasf.B2B] Error al cancelar vuelo: ${res.status}`);
      }
    } catch (err) {
      console.error("[Tasf.B2B] Error cancelando vuelo:", err);
    }
  }, [sessionId]);

  const startDayToDaySimulation = useCallback(async (startDate, dias = 5, preCancelledIds = [], startTime = null, options = {}) => {
    try {
      const { isRealTime = false, planningHorizon = 240 } = options;
      
      let finalStartTime = startTime;
      if (!finalStartTime && isRealTime) {
          const now = new Date();
          finalStartTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
          console.log(`[TASF.B2B] Sincronización automática: Iniciando simulación en vivo a las ${finalStartTime}`);
      } else if (!finalStartTime) {
          finalStartTime = "00:00";
      }

      setSimState("running");
      setAircraft([]);
      setLogs([]);
      realStartRef.current = Date.now();
      setRealElapsedSecs(0);
      snapshotBufferRef.current = [];
      smoothSimTimeRef.current = 0;
      setSmoothSimTime(0);

      // startEpoch siempre al inicio del día (00:00) para que el reloj muestre la hora correcta
      const startEpoch = new Date(`${startDate}T00:00:00`).getTime();
      setMeta({
        status: "RUNNING",
        percent: 0,
        currentDay: 1,
        totalDays: dias,
        isCollapseMode: false,
        errorMessage: null,
        algorithm: selectedAlgorithm || "hga",
        startEpoch: startEpoch,
        totalAttended: 0,
        totalMissed: 0,
        slaFinal: 0,
        reports: [],
        isRealTime,
        planningHorizon
      });

      const preCancelStr = preCancelledIds.length > 0 ? preCancelledIds.join(",") : "";
      const url = `/api/v1/simulation/run/${dias}?algorithm=${selectedAlgorithm}&startDate=${startDate}&playbackMinutes=${targetPlaybackMinutes}&preCancelledFlightIds=${preCancelStr}&startTime=${finalStartTime}&planningHorizon=${planningHorizon}&isRealTime=${isRealTime}`;
      const res = await apiFetch(url, { method: "POST" });

      if (!res.ok) throw new Error(`Backend respondió ${res.status}`);

      const data = await res.json();
      setSessionId(data.sessionId);
    } catch (err) {
      console.error("[Tasf.B2B] Error al iniciar simulación día a día:", err);
      setSimState("idle");
    }
  }, [selectedAlgorithm, targetPlaybackMinutes]);

  const startCollapseSimulation = useCallback(async (dias = 90, startDate = null, stressFactor = 5, endCondition = "FAILED_DELIVERY") => {
    try {
      const totalDays = 90; // Meta: Buscar colapso hasta 90 días
      setSimState("running");
      setAircraft([]);
      setLogs([]);
      realStartRef.current = Date.now();
      setRealElapsedSecs(0);
      snapshotBufferRef.current = [];
      smoothSimTimeRef.current = 0;
      setSmoothSimTime(0);
      
      // En modo colapso, targetPlaybackMinutes = totalDays para tener 1 min por día real
      setTargetPlaybackMinutes(totalDays);

      const resolvedDate = startDate || "2026-04-09";
      const startEpoch = new Date(`${resolvedDate}T00:00:00`).getTime();
      setMeta({
        status: "RUNNING",
        percent: 0,
        currentDay: 1,
        totalDays: totalDays,
        isCollapseMode: true,
        errorMessage: null,
        algorithm: selectedAlgorithm || "hga",
        startEpoch: startEpoch,
        totalAttended: 0,
        totalMissed: 0,
        slaFinal: 0,
        reports: [],
        endCondition: endCondition
      });

      const dateParam = startDate ? `&startDate=${startDate}` : "";
      const stressParam = stressFactor ? `&stressFactor=${stressFactor}` : "";
      const condParam = `&endCondition=${endCondition}`;
      
      const res = await apiFetch(
        `/api/v1/simulation/run-collapse/${totalDays}?algorithm=${selectedAlgorithm}${dateParam}${stressParam}${condParam}&playbackMinutes=${totalDays}`,
        { method: "POST" }
      );

      if (!res.ok) throw new Error(`Backend respondió ${res.status}`);

      const data = await res.json();
      setSessionId(data.sessionId);
      console.info(`[Tasf.B2B] Simulación colapso iniciada: ${startDate ?? "hoy"} × ${totalDays} días | ${selectedAlgorithm.toUpperCase()} | estrés ×${stressFactor} | hora 00:00:00`);
    } catch (err) {
      console.error("[Tasf.B2B] Error al iniciar simulación de colapso:", err);
      setSimState("idle");
    }
  }, [selectedAlgorithm, targetPlaybackMinutes]);


  const exportSimulationExcel = useCallback(async (sid, algorithm = "ALNS") => {
    if (!sid) return;
    try {
      const res = await apiFetch(
        `/api/v1/simulation/export-excel/${sid}?algorithm=${algorithm}`,
        { method: "POST" }
      );
      if (!res.ok) throw new Error(`Error al exportar: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Simulacion_${algorithm}_${sid.substring(0, 8)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[Tasf.B2B] Error al exportar Excel:", err);
    }
  }, []);

  const exportSimulationReportMd = useCallback(async (sid, name = "Escenario") => {
    if (!sid) return;
    try {
      const res = await apiFetch(`/api/v1/simulation/status/${sid}`);
      if (!res.ok) throw new Error(`Error al obtener status: ${res.status}`);
      const finalStatus = await res.json();
      
      const isCollapse = !!finalStatus.isCollapseMode;
      let modeText = '✅ **Operación Normal**';
      if (isCollapse) {
        modeText = '🚨 **COLAPSO INDUCIDO / ESTRÉS DE RED**';
      } else if (name === 'Operacion_Dia_a_Dia') {
        modeText = '📅 **Operación Día a Día**';
      } else if (name === 'Simulacion_Periodo') {
        modeText = '📊 **Simulación de Periodo**';
      }

      let md = `# 📊 Reporte Ejecutivo de Simulación Logística: ${name.replace(/_/g, ' ')}\n\n`;
      md += `> **Documento de nivel ejecutivo generado automáticamente por el Sistema de Control Logístico TASF-B2B.**\n\n`;
      
      md += `## 📋 Información y Metadatos de la Sesión\n`;
      md += `| Parámetro | Detalle |\n`;
      md += `| :--- | :--- |\n`;
      md += `| **ID de Sesión** | \`${sid}\` |\n`;
      md += `| **Fecha de Generación** | ${new Date().toLocaleString()} |\n`;
      md += `| **Duración de Simulación** | ${finalStatus.totalDays} días |\n`;
      if (finalStatus.startEpoch) {
        md += `| **Fecha Simulada de Inicio** | ${new Date(finalStatus.startEpoch).toLocaleDateString()} |\n`;
      }
      md += `| **Modo de Escenario** | ${modeText} |\n`;
      if (isCollapse && finalStatus.stressFactor) {
        md += `| **Factor de Estrés** | **×${finalStatus.stressFactor}** (${(finalStatus.stressFactor * 3)}% de rutas canceladas) |\n`;
      }
      
      const algoName = (finalStatus.algorithm || selectedAlgorithm || "ALNS").toUpperCase();
      const algoBadge = algoName === "ALNS" 
        ? `🟢 **${algoName}** (Adaptive Large Neighborhood Search)`
        : `🔵 **${algoName}** (Hybrid Genetic Algorithm)`;
      md += `| **Algoritmo de Optimización** | ${algoBadge} |\n\n`;

      const slaVal = (finalStatus.slaFinal ?? 0).toFixed(2);
      let slaStatus = "✅ Óptimo";
      if (parseFloat(slaVal) < 80.0) {
        slaStatus = "⚠️ Crítico";
      } else if (parseFloat(slaVal) < 95.0) {
        slaStatus = "🟡 En riesgo";
      }

      md += `## 📊 Resumen Global de KPIs\n`;
      md += `| Métrica | Valor Destacado | Estado / Umbral |\n`;
      md += `| :--- | :--- | :---: |\n`;
      md += `| **SLA Global (Acumulado)** | **\`${slaVal}%\`** | ${slaStatus} |\n`;
      md += `| **Total de Envíos (Demanda)** | **${((finalStatus.totalMissed ?? 0) + (finalStatus.totalAttended ?? 0)).toLocaleString()}** maletas | - |\n`;
      md += `| **Maletas Atendidas** | ${finalStatus.totalAttended?.toLocaleString()} | - |\n`;
      md += `| **Maletas Perdidas** | ${finalStatus.totalMissed?.toLocaleString()} | - |\n`;
      if (isCollapse) {
        md += `| **Vuelos Rescatados (ALNS)** | **${finalStatus.rescuedFlights ?? 0}** | - |\n`;
      }
      md += `\n`;

      md += `## ⚠️ Cuellos de Botella y Top Aeropuertos Congestionados\n`;
      
      if (finalStatus.airportLoads && Object.keys(finalStatus.airportLoads).length > 0) {
        const sortedAirports = Object.entries(finalStatus.airportLoads)
          .map(([icao, data]) => ({ icao, occupancy: data.occupancy || 0 }))
          .sort((a, b) => b.occupancy - a.occupancy);
        
        const top5 = sortedAirports.slice(0, 5);
        
        md += `| Puesto | Código ICAO | Ocupación | Nivel de Congestión | Alerta |\n`;
        md += `| :---: | :---: | :---: | :--- | :---: |\n`;
        
        top5.forEach((item, index) => {
          let level = "🟢 Bajo";
          let alertEmoji = "";
          if (item.occupancy >= 90) { level = "🔴 Crítico"; alertEmoji = "⚠️"; }
          else if (item.occupancy >= 70) { level = "🟡 Moderado"; alertEmoji = "⚠️"; }
          md += `| ${index + 1} | **${item.icao}** | ${item.occupancy}% | ${level} | ${alertEmoji} |\n`;
        });
      } else {
        md += `*No se registraron datos de carga.*\n`;
      }
      md += `\n`;

      md += `## 📅 Desglose de Rendimiento Diario\n\n`;
      md += `| Día | Maletas Procesadas | Demanda del Día | SLA Diario | Saturación Max | Colapso Técnico |\n`;
      md += `| :---: | :---: | :---: | :---: | :---: | :---: |\n`;

      if (finalStatus.reports && finalStatus.reports.length > 0) {
        for (const d of finalStatus.reports) {
          const colapsedIcon = d.colapsed ? '⚠️ Sí' : '✔️ No';
          md += `| Día ${d.dayIndex + 1} | ${d.malatetasAtendidas} | ${d.totalMaletas} | ${(d.slaPercent ?? 0).toFixed(2)}% | ${d.airportSaturation ?? 0} | ${colapsedIcon} |\n`;
        }
      } else {
        md += `| - | No hay datos disponibles | - | - | - | - |\n`;
      }
      md += `\n`;

      md += `---\n> 🔒 **Nota de Confidencialidad:** Propiedad exclusiva de **TASF-B2B**.`;
      
      const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ResultadosDeEscenario_${name.replace(/\s+/g, '')}_${sid.substring(0, 8)}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[Tasf.B2B] Error al exportar MD:", err);
    }
  }, [selectedAlgorithm]);


const exportDetailedSimulationReport = useCallback(async (sid) => {
    if (!sid) return;
    try {
      const res = await apiFetch(`/api/v1/simulation/export-details/${sid}`);
      if (!res.ok) throw new Error(`Error al exportar reporte detallado: ${res.status}`);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `ReporteDetalladoVuelos_${sid.substring(0, 8)}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[Tasf.B2B] Error al exportar Reporte Detallado:", err);
    }
  }, []);

  /**
   * Conexión WebSocket / STOMP
   */
  useEffect(() => {
    if (!sessionId) return

    simClockRef.current.lastSeq = -1;

    const client = createStompClient()

    client.onConnect = () => {
      let maxEpochReceived = 0;
      const pendingBySeq = new Map();
      const BUFFER_MAX_FRAMES = 240;

      const pushCompleteFrame = (seq) => {
        const f = pendingBySeq.get(seq);
        if (!f) return;
        if (f.clock === undefined || f.routes === undefined || f.kpis === undefined) return;

        snapshotBufferRef.current.push(f);
        snapshotBufferRef.current.sort((a, b) => a.epoch - b.epoch);
        if (snapshotBufferRef.current.length > BUFFER_MAX_FRAMES) {
          snapshotBufferRef.current.splice(0, snapshotBufferRef.current.length - BUFFER_MAX_FRAMES);
        }
        pendingBySeq.delete(seq);

        if (smoothSimTimeRef.current === 0 && f.epoch) {
          smoothSimTimeRef.current = f.epoch;
          setSmoothSimTime(f.epoch);
        }
      };

      const upsertBySeq = (seq, type, data) => {
        const epoch = data?.currentEpochTime;
        if (!epoch) return;
        if (epoch < maxEpochReceived - 60000) return;
        if (epoch > maxEpochReceived) maxEpochReceived = epoch;

let f = pendingBySeq.get(seq);
        if (!f) {
          f = { seq, epoch };
          pendingBySeq.set(seq, f);
        }
        f.epoch = epoch;

        if (type === 'snapshot') {
          f.clock = data.simulatedTime;
          f.routes = data.activeRoutes || [];
          f.planId = data.planId;
          f.masterPlan = data.masterPlan || [];
        } else if (type === 'kpi') {
          f.kpis = data;
          f.airportLoads = data.airportLoads || {};
        }

        if (pendingBySeq.size > 50) {
          const keys = Array.from(pendingBySeq.keys()).sort((a, b) => a - b);
          for (let i = 0; i < keys.length - 50; i++) pendingBySeq.delete(keys[i]);
        }
        pushCompleteFrame(seq);
      };

      client.subscribe(`/topic/sim/${sessionId}/snapshot`, (msg) => {
        try {
          const envelope = JSON.parse(msg.body)
          const data = envelope?.data ?? {}
          if (data.currentEpochTime) {
            upsertBySeq(envelope?.seq ?? 0, 'snapshot', data);
          }
        } catch (err) { console.error('Error parsing snapshot:', err) }
      })

      client.subscribe(`/topic/sim/${sessionId}/kpi`, (msg) => {
        try {
          const envelope = JSON.parse(msg.body)
          const data = envelope?.data ?? {}
          if (data.currentEpochTime) {
            upsertBySeq(envelope?.seq ?? 0, 'kpi', data);
            if (data.status === 'DONE' || data.status === 'FAILED') {
              setTimeout(() => client.deactivate(), 250);
            }
          }
        } catch (err) { console.error('Error parsing kpi:', err) }
      })

      client.subscribe(`/topic/sim/${sessionId}/eventLog`, (msg) => {
        try {
const envelope = JSON.parse(msg.body);
          const logEntry = envelope?.data;
          if (!logEntry) return;
          setLogs((prev) => {
            const next = [...prev, logEntry];
            return next.length > 200 ? next.slice(-150) : next;
          });
        } catch (err) {
          console.error('Error parsing eventLog:', err);
        }
      });
    }

    client.onStompError = (frame) => {
      console.warn('[Tasf.B2B] STOMP error:', frame?.headers?.message, frame?.body);
    };

    client.onWebSocketError = (err) => {
      console.warn('[Tasf.B2B] WS error:', err)
    }

    client.activate()
    return () => client.deactivate()
  }, [sessionId])

  const airportByCode = AIRPORT_BY_ICAO;

  /**
   * Métricas de aeropuerto: si hay datos live del backend (airportLoads),
   * se construyen desde ahí. Si no, arranca limpio.
   */
  const activeMetrics = useMemo(() => {
    if (airportLoads && Object.keys(airportLoads).length > 0) {
      return buildAirportMetrics(AIRPORTS, airportLoads);
    }
    return {};
  }, [airportLoads]);

  const activeAirportRows = useMemo(() => {
    const base = isCollapseScenario ? COLLAPSE_AIRPORT_ROWS : AIRPORT_ROWS;
    if (!airportLoads || Object.keys(airportLoads).length === 0) return base;
    return Object.entries(airportLoads)
      .sort(([, a], [, b]) => (b.occupancy || 0) - (a.occupancy || 0))
      .slice(0, 8)
      .map(([icao, data]) => ({
        city: AIRPORT_BY_ICAO[icao]?.city ?? icao,
        capacity: `${data.occupancy || 0}%`,
        icao,
      }));
  }, [airportLoads, isCollapseScenario]);

  const currentEpochTime = clock.currentEpochTime || 0;

  const activeShipments = useMemo(() => {
    if (!aircraft || aircraft.length === 0 || !currentEpochTime) return []
const viewWindow = 12 * 3600 * 1000;
    return aircraft
      .filter((r) => r.status !== "cancelled")
      .filter((r) => r.arrivalTime > currentEpochTime && r.departureTime <= currentEpochTime + viewWindow)
      .sort((a, b) => a.departureTime - b.departureTime)
  }, [aircraft, currentEpochTime])

  const activeAircraftAll = useMemo(() => {
    const routes = aircraft?.filter(r => r.status !== "cancelled") ?? [] 
    if (routes.length === 0) return []
    const byId = new Map()
    routes.forEach((r) => {
      const next = { 
        ...r, 
        status: r.status ?? "normal",
        capacityPercent: r.capacityPercent ?? 0 
      };
      const prev = byId.get(next.id);
      if (!prev) { 
        byId.set(next.id, next); 
        return; 
      }
      const nextP = STATUS_PRIORITY[next.status] ?? 0;
      const prevP = STATUS_PRIORITY[prev.status] ?? 0;
      if (nextP > prevP || (nextP === prevP && next.capacityPercent > prev.capacityPercent)) {
        byId.set(next.id, next);
      }
    });
    return Array.from(byId.values())
  }, [aircraft])

  const [searchedShipment, setSearchedShipment] = useState(null);
  const [isSearching, setIsSearching] = useState(false);

  // Paso 4: Callback para Track & Trace — se invoca desde App.jsx con el bridge
  const [trackedRouteData, setTrackedRouteData] = useState(null);

  const searchShipment = useCallback(async (id) => {
    if (!id) return;
    setIsSearching(true);
    
    // 1. Búsqueda Local (Caché activo)
    const local = activeAircraftAll.find(a => a.id === id || String(a.lotId) === id || a.id === `vuelo-${id}`);
    if (local) {
      setSelectedAircraftId(local.id);
      setSearchedShipment({
        id: local.id,
        origin: local.from,
        destination: local.to,
        status: local.status,
        departure: local.departureTime,
        arrival: local.arrivalTime,
        isLocal: true
      });
      // Paso 4: Crear ruta de un solo hop para Track & Trace
      setTrackedRouteData({
        shipmentId: local.id,
        hops: [{ from: local.from, to: local.to, flightId: local.id, status: local.status }]
      });
      setIsSearching(false);
      togglePanel("shipmentDetail");
      return;
    }

    // 2. Búsqueda en Servidor (Histórico/Deep Search)
    if (!sessionId) {
      setIsSearching(false);
      return;
    }

    try {
      const res = await apiFetch(`/api/v1/simulation/shipment/${sessionId}/${id}`);
      if (res.ok) {
        const data = await res.json();
        setSearchedShipment({
          ...data,
          isLocal: false
        });
        // Paso 4: Crear ruta multi-hop si el servidor devuelve hops
        if (data.route && data.route.length > 0) {
          setTrackedRouteData({
            shipmentId: id,
            hops: data.route.map(hop => ({
              from: hop.from,
              to: hop.to,
              flightId: hop.id || hop.flightId,
              status: hop.status || 'normal',
            }))
          });
        } else {
          // Fallback: ruta simple si no hay hops detallados
          setTrackedRouteData({
            shipmentId: id,
            hops: [{ from: data.origin, to: data.destination, flightId: id, status: data.status || 'normal' }]
          });
        }
        togglePanel("shipmentDetail");
      } else {
        alert("Envío no encontrado en el historial de la sesión.");
      }
    } catch (err) {
      console.error("[Tasf.B2B] Error en búsqueda profunda:", err);
    } finally {
      setIsSearching(false);
    }
  }, [activeAircraftAll, sessionId, togglePanel]);

  const rankedAircraftBase = useMemo(() => {
    if (activeAircraftAll.length === 0) return [];
    return [...activeAircraftAll].sort((a, b) => {
      const pA = STATUS_PRIORITY[a.status] ?? 0;
      const pB = STATUS_PRIORITY[b.status] ?? 0;
      if (pA !== pB) return pB - pA;
      if (a.capacityPercent !== b.capacityPercent) return b.capacityPercent - a.capacityPercent;
      return a.departureTime - b.departureTime;
    });
  }, [activeAircraftAll]);

  const activeAircraft = useMemo(() => {
    if (rankedAircraftBase.length === 0) return [];
    if (rankedAircraftBase.length <= MAX_MAP_ROUTES && !selectedAircraftId) return rankedAircraftBase;
    const now = smoothSimTime || currentEpochTime;
    const inAir = [];
    const onGround = [];
    let selected = null;
    for (const p of rankedAircraftBase) {
      if (selectedAircraftId && p.id === selectedAircraftId) selected = p;
      const isCurrentlyInAir = now ? (p.departureTime <= now && now < p.arrivalTime) : true;
      if (isCurrentlyInAir) inAir.push(p); else onGround.push(p);
    }
    const combined = [...inAir, ...onGround];
    const budget = Math.max(0, MAX_MAP_ROUTES - (selected ? 1 : 0));
    const finalSelection = combined.slice(0, budget);
if (selected && !finalSelection.some((p) => p.id === selected.id)) {
      finalSelection.push(selected);
    }

    // --- DIAGNOSTIC: Visual Lifecycle (Filter) ---
    const activeIds = new Set(finalSelection.map(a => a.id));
    const prevActiveIds = prevActiveIdsRef.current;
    
    prevActiveIds.forEach(id => {
        if (!activeIds.has(id)) {
             console.log(`[AIRCRAFT_REMOVE] (Visual/Filter) Flight=${id}`);
        }
    });
    prevActiveIdsRef.current = activeIds;
    return finalSelection;
  }, [rankedAircraftBase, currentEpochTime, smoothSimTime, selectedAircraftId]);

  const selectedAircraft = useMemo(
    () => activeAircraftAll.find((p) => p.id === selectedAircraftId) ?? null,
    [activeAircraftAll, selectedAircraftId],
  )

  useEffect(() => {
    if (selectedAircraftId && !selectedAircraft) setSelectedAircraftId(null)
  }, [selectedAircraftId, selectedAircraft])

  const selectedFromAirport = selectedAircraft ? (AIRPORT_BY_ICAO[selectedAircraft.from] ?? null) : null;
  const selectedToAirport = selectedAircraft ? (AIRPORT_BY_ICAO[selectedAircraft.to] ?? null) : null;
  const selectedAirport = selectedAirportCode ? (AIRPORT_BY_ICAO[selectedAirportCode] ?? null) : null;
  const selectedAirportMetrics = selectedAirport ? (activeMetrics[selectedAirport.icao] ?? null) : null;
  const selectedAirportLevel = selectedAirportMetrics?.level ?? "green";

  const globalOccupancyCalculated = useMemo(() => {
    const loads = Object.values(airportLoads);
    if (loads.length === 0) return kpis.globalOccupancy ?? 0;
    const sum = loads.reduce((a, b) => a + (b.occupancy || 0), 0);
    return sum / loads.length;
  }, [airportLoads, kpis.globalOccupancy]);

  const transitByContinent = useMemo(() => {
    const routes = aircraft ?? [];
    if (routes.length === 0) return { america: 0, europe: 0, asia: 0 };
    const americaIcao = ["K", "C", "M", "S", "T"];
    const asiaIcao = ["Z", "R", "V", "W", "O", "U", "P"];
    let a = 0, e = 0, as = 0;
    routes.forEach(r => {
      const p = (r.to ?? "").charAt(0).toUpperCase();
      if (americaIcao.includes(p)) a++; else if (asiaIcao.includes(p)) as++; else e++;
    });
    const scale = Math.max(1, kpis.totalBagsWaiting ?? routes.length);
    const t = routes.length;
    return { america: Math.round((a / t) * scale), europe: Math.round((e / t) * scale), asia: Math.round((as / t) * scale) };
  }, [aircraft, kpis.totalBagsWaiting]);

  const summary = useMemo(() => {
    const pad = (n) => String(n).padStart(2, "0");
    const fmtSim = (epoch, start) => {
      if (!epoch || !start) return "--:--:--";
      const date = new Date(epoch);
      const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
      const day = date.getUTCDate();
      const month = months[date.getUTCMonth()];
      const year = date.getUTCFullYear();
      const h = pad(date.getUTCHours());
      const m = pad(date.getUTCMinutes());
      const s = pad(date.getUTCSeconds());
      return `${day} ${month} ${year} - ${h}:${m}:${s}`;
    };
    const fmtReal = (s) => {
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      return `${pad(h)}:${pad(m)}:${pad(sec)}`;
    };

    if (sessionId && meta.status !== "idle") {
      return {
        scenarioLabel: "Simulación en vivo",
        systemClock: fmtSim(smoothSimTime || currentEpochTime, meta.startEpoch),
        realTimeElapsed: fmtReal(realElapsedSecs),
        globalCapacity: `${globalOccupancyCalculated.toFixed(1)}%`,
        networkLatency: "OK",
        flightsInCourse: { value: aircraft.length ?? 0, delta: "datos reales", status: "green" },
        storageOccupancy: { value: Math.round(globalOccupancyCalculated), subtitle: "Promedio red", status: (globalOccupancyCalculated >= 90) ? "red" : "green" },
        sla: { value: kpis.slaPercent?.toFixed(1) ?? 0, subtitle: "Real", status: (kpis.slaPercent >= 90) ? "green" : "red" },
        criticalNodes: { value: kpis.criticalNodes ?? 0, subtitle: ">90% ocupación", status: (kpis.criticalNodes > 5) ? "red" : "green" },
        progress: { label: meta.status === "DONE" ? "Completado" : "Ejecutando", percent: meta.percent ?? 0, simulatedTime: clock.simulatedTime ?? `Día ${meta.currentDay}`, status: meta.status === "DONE" ? "green" : "amber" },
        transitByContinent,
      };
    }

    return {
      scenarioLabel: "Esperando simulación...",
      operationStart: "--:--",
      systemClock: "--:--",
      realTimeElapsed: "00:00:00",
      globalCapacity: "0%",
      networkLatency: "--",
      flightsInCourse: { value: 0, delta: "--", status: "green" },
      storageOccupancy: { value: 0, subtitle: "--", status: "green" },
      sla: { value: 0, subtitle: "--", status: "green" },
      criticalNodes: { value: 0, subtitle: "--", status: "green" },
      progress: { label: "Listo", percent: 0, simulatedTime: "00:00:00", status: "amber" },
      transitByContinent: { america: 0, europe: 0, asia: 0 },
    };
  }, [meta, kpis, clock, aircraft, sessionId, smoothSimTime, currentEpochTime, realElapsedSecs, globalOccupancyCalculated, transitByContinent]);

  const elapsedOperationTime = summary.realTimeElapsed;

  const kpiCards = useMemo(() => {
    if (sessionId && meta.status !== "idle") {
      const progressPercent = meta.percent ?? 0;
      const dayLabel = meta.totalDays
        ? `Día ${meta.currentDay} / ${meta.totalDays}`
        : "Iniciando...";

      let fleetLoad = 0;
      let fleetCap = 0;
      aircraft.forEach(p => {
        if (p.status !== "cancelled") {
          fleetLoad += p.ocupacionReal || 0;
          fleetCap += p.capacidadMax || 0;
        }
      });
      const fleetOccupancyPct = fleetCap > 0 ? (fleetLoad / fleetCap) * 100 : 0;

      return [
        {
          key: "flights",
          title: "Vuelos en curso",
          value: aircraft.filter(r => r.status !== "cancelled").length ?? 0,
          subtitle: isCollapseScenario 
            ? `Rescatados: ${kpis.rescuedFlights ?? 0}` 
            : `Día ${meta.currentDay} de simulación`,
          status: "green",
        },
        {
          key: "fleetOccupancy",
          title: "Ocupación global flota (UT)",
          value: `${fleetOccupancyPct.toFixed(1)}%`,
          subtitle: "Carga total / Capacidad máxima",
          status: fleetOccupancyPct >= 90 ? "red" : fleetOccupancyPct >= 70 ? "amber" : "green",
        },
        {
          key: "occupancy",
          title: "Ocupación global almacenes",
          value: `${globalOccupancyCalculated.toFixed(1)}%`,
          subtitle: "Promedio red · datos reales",
          status: globalOccupancyCalculated >= 90 ? "red"
            : globalOccupancyCalculated >= 70 ? "amber" : "green",
        },
        {
          key: "sla",
          title: "Entregas a tiempo (SLA)",
          value: `${kpis.slaPercent?.toFixed(1) ?? 0}%`,
          subtitle: (meta.totalAttended > 0 || meta.totalMissed > 0)
            ? `Atendidas: ${meta.totalAttended.toLocaleString("es-PE")} | Perdidas: ${meta.totalMissed.toLocaleString("es-PE")}`
            : "Maletas atendidas / demanda total",
          status: kpis.slaPercent >= 90 ? "green"
            : kpis.slaPercent >= 70 ? "amber" : "red",
        },
        {
          key: "critical",
          title: "Nodos críticos",
          value: kpis.criticalNodes ?? 0,
          subtitle: "Almacenes con ocupación > 90%",
          status: kpis.criticalNodes > 5 ? "red"
            : kpis.criticalNodes > 2 ? "amber" : "green",
        },
        {
          key: "progress",
          title: "Progreso simulación",
          value: `${dayLabel} · ${progressPercent}%`,
          subtitle: meta.status === "DONE" ? "✓ Completado" : "En ejecución...",
          status: meta.status === "FAILED" ? "red"
            : meta.status === "DONE" ? "green" : "amber",
          progress: progressPercent,
        },
      ];
    }
    return [
      { key: "flights", title: "Vuelos en curso", value: 0, subtitle: "Esperando...", status: "green" },
      { key: "occupancy", title: "Ocupación global", value: "0%", subtitle: "Esperando...", status: "green" },
      { key: "sla", title: "SLA", value: "0%", subtitle: "Esperando...", status: "green" },
      { key: "critical", title: "Nodos críticos", value: 0, subtitle: "Esperando...", status: "green" },
      { key: "progress", title: isCollapseScenario ? "Estado colapso" : "Progreso", value: "Listo · 0%", subtitle: "Presione Ejecutar", status: "amber", progress: 0 },
    ];
  }, [isCollapseScenario, meta, kpis, aircraft, sessionId, globalOccupancyCalculated]);

  const comparisonData = useMemo(() => {
    if (kpis.comparisonResults) {
      const alnsResult = kpis.comparisonResults.alns || kpis.comparisonResults.ALNS;
      return {
        alns: alnsResult ? {
          execTime: alnsResult.execTime ?? "-",
          deliveredOnTime: alnsResult.deliveredOnTime?.toLocaleString('es-PE') ?? "-",
          totalDeliveries: alnsResult.totalDeliveries?.toLocaleString('es-PE') ?? "-",
          slaPercent: alnsResult.slaPercent?.toFixed(1) ?? "-",
          avgRouteLength: alnsResult.avgRouteLength ?? "-",
          replanifications: alnsResult.replanifications ?? "-",
          rescuedFlights: alnsResult.rescuedFlights ?? 0,
        } : null,
      };
    }
    return null;
  }, [kpis.comparisonResults]);

  const eventLog = logs;
  const totalBagsWaiting = kpis.totalBagsWaiting ?? 0;

  useEffect(() => {
    if (!isAirportDetailOpen) return undefined;
    const handleKeyDown = (event) => { if (event.key === "Escape") setIsAirportDetailOpen(false); };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isAirportDetailOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(KPI_COLLAPSED_STORAGE_KEY, String(isKpiCollapsed));
  }, [isKpiCollapsed]);

  return {
activeAircraft,
    activeAirportRows,
    activeMetrics,
    activeTab,
    airportByCode,
    airportNodes: AIRPORT_NODES,
    comparisonData,
    elapsedOperationTime,
    eventLog,
    currentEpochTime,
    totalBagsWaiting,
    activeShipments,
    handleTabChange,
    hideAirportDetail,
    isAirportDetailOpen,
    isCollapseScenario,
    isDockCollapsed,
    isKpiCollapsed,
    isScenarioConfigOpen,
    isSimScenario,
    kpiCards,
    liveStatus,
    masterPlan,
    panelVisibility,
    selectedAircraftId,
    selectedAirportCode,
    selectedAirport,
    selectedAirportLevel,
    selectedAlgorithm,
    selectedFromAirport,
    selectedToAirport,
    sessionId,
    isFluidMode,
    setIsFluidMode,
    searchShipment,
    searchedShipment,
    isSearching,
    setSelectedAircraftId,
    setSelectedAlgorithm,
    setSimSpeed,
    simSpeed,
    simState,
    startSimulation,
    startDayToDaySimulation,
    startCollapseSimulation,
    exportSimulationExcel,
    exportSimulationReportMd,
    exportDetailedSimulationReport,
    resetSimulation,
    summary,
    tabs: SCENARIO_TABS,
    toggleDock,
    toggleKpiStrip,
    togglePanel,
    toggleScenarioConfig,
    setSimState,
    showAirportDetail,
    selectedAircraft,
    trackedRouteData,
    targetPlaybackMinutes,
    setTargetPlaybackMinutes,
    cancelFlight,
    handleSelectAircraft
  };
};

