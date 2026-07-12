import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { apiFetch } from "./api";
import { createStompClient } from "./ws";
import {
  SCENARIO_TABS,
} from "../data/controlTowerData";
import { buildAirportMetrics } from "../data/airportsData";
import { useAirports } from "./useAirports";

const PANEL_VISIBILITY_DEFAULT = {
  telemetry: false,
  legend: true,
  occupancy: true,
  transitInventory: false,
  comparison: false,
  shipmentDetail: false,
  cancellation: false,
};

const KPI_COLLAPSED_STORAGE_KEY = "ct-kpi-collapsed";
const MAX_MAP_ROUTES = 1200;
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
  const { airports: globalAirports, airportByIcao } = useAirports();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState("vivo");
  const isCollapseScenario = activeTab === "colapso";
  const isSimScenario = activeTab === "periodo" || activeTab === "colapso";
  const [panelVisibility, setPanelVisibility] = useState(PANEL_VISIBILITY_DEFAULT);
  const [isKpiCollapsed, setIsKpiCollapsed] = useState(readStoredKpiCollapsed);
  const [selectedAircraftId, setSelectedAircraftId] = useState(null);
  const [selectedAirportCode, setSelectedAirportCode] = useState(null);
  const [isDockCollapsed, setIsDockCollapsed] = useState(false);
  const [isScenarioConfigOpen, setIsScenarioConfigOpen] = useState(false);
  const [selectedAlgorithm, setSelectedAlgorithm] = useState("alns");
  const [simState, setSimState] = useState("idle");
  const [targetPlaybackMinutes, setTargetPlaybackMinutes] = useState(30);
  const [cancelledFlights, setCancelledFlights] = useState([]);
  const [finalMasterPlan, setFinalMasterPlan] = useState([]);

  // Si había un ?session= en la URL al abrir, lo guardamos para reconexión
  const initialSessionId = useRef(
    new URLSearchParams(location.search).get("session")
  );
  // true mientras consultamos el backend para reconectar (evita que auto-inicie vivo encima)
  const [isReconnecting, setIsReconnecting] = useState(() => !!initialSessionId.current);

  const [sessionId, setSessionId] = useState(() => {
    return new URLSearchParams(location.search).get("session");
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
    totalBagsWaiting: 0, rescuedFlights: 0, comparisonResults: null,
    taMs: 0, saMinutes: 10
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
  const [realTimeTicker, setRealTimeTicker] = useState(Date.now());

  // Ticker para actualizar el reloj de la vida real (incluso en idle)
  useEffect(() => {
    const interval = setInterval(() => {
      setRealTimeTicker(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

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
      finalMasterPlan,
    };
  }, [meta, kpis, airportLoads, aircraft, clock, smoothSimTime, logs, sessionId, finalMasterPlan]);

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
            taMs: data.taMs ?? 0,
            saMinutes: data.saMinutes ?? 10,
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
                  setFinalMasterPlan(finalStatus.finalMasterPlan || []);
                });
              }
            });
          } else if (data.status === 'FAILED') {
            setSimState('idle');
          } else if (data.status === 'RUNNING' || data.status === 'RECONSTRUCTING') {
            setSimState(prev => prev !== 'running' ? 'running' : prev);
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

  const toggleScenarioConfig = useCallback(() => {
    setIsScenarioConfigOpen((current) => !current);
  }, []);

  const toggleKpiStrip = useCallback(() => {
    setIsKpiCollapsed((current) => !current);
  }, []);

  const toggleDock = useCallback(() => {
    setIsDockCollapsed((current) => !current);
  }, []);

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
    setFinalMasterPlan([]);
    setCancelledFlights([]);
    snapshotBufferRef.current = [];
    simClockRef.current = { serverEpoch: 0, receivedAt: 0, ratio: 1 };
  }, [selectedAlgorithm]);

  const handleTabChange = useCallback((tabKey = "vivo") => {
    resetSimulation();
    setActiveTab(tabKey);
    setIsScenarioConfigOpen(false);
    if (tabKey === "periodo" || tabKey === "colapso") {
      setIsDockCollapsed(true);
    }
  }, [resetSimulation]);

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

  const addCancelledFlight = useCallback((id, { origenIcao, destinoIcao, departureMinute, cancelledAt, deferred }) => {
    if (!cancelledAt) return
    const d = new Date(cancelledAt)
    const utcDayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
    let cancelledFlightDay = utcDayStart + departureMinute * 60000
    if (deferred) cancelledFlightDay += 86400000

    setCancelledFlights(prev => [{
      id,
      cancelKey: cancelledAt + '-' + id,
      origenIcao,
      destinoIcao,
      cancelledAt,
      cancelledFlightDay,
      deferred,
    }, ...prev])
  }, [])

  const startDayToDaySimulation = useCallback(async (startDate, dias = 5, preCancelledIds = [], startTime = null, options = {}) => {
    try {
      const { isRealTime = false, planningHorizon = 480 } = options;

      let finalStartTime = startTime;
      let finalStartDate = startDate;
      if (isRealTime) {
        const now = new Date();
        finalStartTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        finalStartDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        console.log(`[TASF.B2B] Sincronización automática: Iniciando simulación en vivo a las ${finalStartDate} ${finalStartTime}`);
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
      const startEpoch = new Date(`${finalStartDate}T00:00:00`).getTime();
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
      const url = `/api/v1/simulation/run/${dias}?algorithm=${selectedAlgorithm}&startDate=${finalStartDate}&playbackMinutes=${targetPlaybackMinutes}&preCancelledFlightIds=${preCancelStr}&startTime=${finalStartTime}&planningHorizon=${planningHorizon}&isRealTime=${isRealTime}`;
      const res = await apiFetch(url, { method: "POST" });

      if (!res.ok) throw new Error(`Backend respondió ${res.status}`);

      const data = await res.json();
      setSessionId(data.sessionId);
    } catch (err) {
      console.error("[Tasf.B2B] Error al iniciar simulación día a día:", err);
      setSimState("idle");
    }
  }, [selectedAlgorithm, targetPlaybackMinutes]);

  // ── Reconexión a sesión existente (cuando se abre el link con ?session=) ───
  useEffect(() => {
    const sid = initialSessionId.current;
    if (!sid) {
      setIsReconnecting(false);
      return;
    }
    let cancelled = false;
    apiFetch(`/api/v1/simulation/status/${sid}`)
      .then(res => {
        if (!res.ok) throw new Error(`Sesión ${sid} no encontrada (${res.status})`);
        return res.json();
      })
      .then(data => {
        if (cancelled) return;
        const status = data.status; // RUNNING | DONE | FAILED
        const isCollapse = !!data.isCollapseMode;
        const totalDays = data.totalDays ?? 1;
        // Determinar pestaña correcta según el tipo de sesión
        let tab = "vivo";
        if (isCollapse) tab = "colapso";
        else if (totalDays > 1) tab = "periodo";
        setActiveTab(tab);
        if (tab !== "vivo") setIsDockCollapsed(true);
        // Restaurar meta del backend
        setMeta(prev => ({
          ...prev,
          status: data.status,
          percent: data.percent ?? prev.percent,
          currentDay: data.currentDay ?? prev.currentDay,
          totalDays: data.totalDays ?? prev.totalDays,
          isCollapseMode: !!data.isCollapseMode,
          algorithm: data.algorithm ?? prev.algorithm,
          startEpoch: data.startEpoch ?? prev.startEpoch,
          slaFinal: data.slaFinal ?? prev.slaFinal,
          totalAttended: data.totalAttended ?? prev.totalAttended,
          totalMissed: data.totalMissed ?? prev.totalMissed,
          reports: data.reports ?? prev.reports,
        }));
        if (data.algorithm) setSelectedAlgorithm(data.algorithm.toLowerCase());
        if (status === 'RUNNING' || status === 'RECONSTRUCTING') {
          realStartRef.current = realStartRef.current || Date.now();
          setSimState('running');
        } else if (status === 'DONE') {
          setSimState('completed');
          setFinalMasterPlan(data.finalMasterPlan || []);
        } else {
          setSimState('idle');
        }
      })
      .catch(err => {
        if (cancelled) return;
        console.warn('[Tasf.B2B] No se pudo reconectar a sesión:', err.message);
        // Si la sesión no existe, limpiamos la URL y arrancamos normal
        setSessionId(null);
        initialSessionId.current = null;
      })
      .finally(() => {
        if (!cancelled) setIsReconnecting(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Solo al montar

  // ── Auto-inicio de simulación día a día (vivo) ───────────────────────────
  useEffect(() => {
    // No auto-iniciar si estamos reconectando una sesión existente desde la URL
    if (isReconnecting) return;
    if (activeTab === "vivo" && simState === "idle" && !sessionId) {
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      startDayToDaySimulation(today, 1, [], null, { isRealTime: true, planningHorizon: 480 });
    }
  }, [activeTab, simState, sessionId, startDayToDaySimulation]);

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

  const exportSimulationReportMd = useCallback(async (sid, name = "Ultima_Planificacion") => {
    if (!sid) return;
    try {
      const safeSid = String(sid);
      const safeName = String(name || "Ultima_Planificacion").replace(/\s+/g, '');
      const res = await apiFetch(`/api/v1/simulation/status/${safeSid}`);
      if (!res.ok) throw new Error(`Error al obtener status: ${res.status}`);
      const finalStatus = await res.json();

      const isCollapse = !!finalStatus.isCollapseMode;
      let modeText = '✅ **Operación Normal**';
      if (isCollapse) {
        modeText = '🚨 **COLAPSO INDUCIDO / ESTRÉS DE RED**';
      } else if (safeName.includes('Dia_a_Dia')) {
        modeText = '📅 **Operación Día a Día**';
      } else if (safeName.includes('Periodo')) {
        modeText = '📊 **Simulación de Periodo**';
      }

      let md = `# 📋 Reporte de Última Planificación Estable: ${safeName.replace(/_/g, ' ')}\n\n`;
      md += `> **Documento generado automáticamente por el Sistema de Control Logístico TASF-B2B.**\n\n`;

      md += `## ⚙️ Metadatos de la Sesión\n`;
      md += `- **ID de Sesión**: \`${safeSid}\`\n`;
      md += `- **Fecha de Generación**: ${new Date().toLocaleString()}\n`;
      md += `- **Modo de Escenario**: ${modeText}\n`;

      const algoName = (finalStatus.algorithm || selectedAlgorithm || "ALNS").toUpperCase();
      md += `- **Algoritmo de Optimización**: **${algoName}**\n\n`;

      md += `## 📦 Desglose de la Última Planificación Estable\n\n`;

      if (finalStatus.finalMasterPlan && finalStatus.finalMasterPlan.length > 0) {
        md += `A continuación se muestra el plan maestro final (asignaciones de envío a vuelos).\n\n`;
        md += `| Lote ID | Origen | Destino | Maletas | Estado | Deadline | LLegada Estimada |\n`;
        md += `| :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n`;

        finalStatus.finalMasterPlan.forEach(plan => {
          const deadlineStr = plan.deadline ? new Date(plan.deadline).toLocaleString() : '-';
          const arrivalStr = plan.arrivalTime ? new Date(plan.arrivalTime).toLocaleString() : '-';
          md += `| **${plan.lotId}** | ${plan.origin} | ${plan.destination} | ${plan.assignedBags} / ${plan.totalBags} | ${plan.status} | ${deadlineStr} | ${arrivalStr} |\n`;
        });

        md += `\n### ✈️ Detalle de Tramos de Vuelo Asignados\n\n`;

        finalStatus.finalMasterPlan.forEach(plan => {
          md += `#### Lote **${plan.lotId}** (${plan.origin} ➔ ${plan.destination})\n`;
          if (plan.hops && plan.hops.length > 0) {
            md += `| Vuelo ID | Origen | Destino | Salida | Llegada |\n`;
            md += `| :---: | :---: | :---: | :---: | :---: |\n`;
            plan.hops.forEach(hop => {
              const depStr = hop.departureTime ? new Date(hop.departureTime).toLocaleString() : '-';
              const arrStr = hop.arrivalTime ? new Date(hop.arrivalTime).toLocaleString() : '-';
              md += `| ${hop.vueloId} | ${hop.from} | ${hop.to} | ${depStr} | ${arrStr} |\n`;
            });
          } else {
            md += `*No hay tramos de vuelo registrados para este lote.*\n`;
          }
          md += `\n`;
        });

      } else {
        md += `*La simulación no generó un plan maestro final (posiblemente toda la carga ya fue procesada o no hubo demanda nueva).* \n`;
      }

      md += `---\n> 🔒 **Nota de Confidencialidad:** Propiedad exclusiva de **TASF-B2B**.`;

      const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;
      a.download = `UltimaPlanificacion_${safeName}_${safeSid.substring(0, 8)}.md`;
      document.body.appendChild(a);
      a.click();

      setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }, 150);
    } catch (err) {
      console.error("[Tasf.B2B] Error al exportar MD de Última Planificación:", err);
      alert("Error al exportar MD: " + err.message);
    }
  }, [selectedAlgorithm]);

  const exportDetailedSimulationReport = useCallback(async (sid) => {
    if (!sid) return;
    try {
      const safeSid = String(sid);
      const res = await apiFetch(`/api/v1/simulation/export-details/${safeSid}`);
      if (!res.ok) throw new Error(`Error al exportar reporte detallado: ${res.status}`);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;
      a.download = `ReporteDetalladoVuelos_${safeSid.substring(0, 8)}.md`;
      document.body.appendChild(a);
      a.click();

      setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }, 150);
    } catch (err) {
      console.error("[Tasf.B2B] Error al exportar Reporte Detallado:", err);
      alert("Error al exportar reporte detallado: " + err.message);
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

  const airportByCode = airportByIcao;

  /**
   * Métricas de aeropuerto: si hay datos live del backend (airportLoads),
   * se construyen desde ahí. Si no, arranca limpio.
   */
  const activeMetrics = useMemo(() => {
    if (airportLoads && Object.keys(airportLoads).length > 0) {
      return buildAirportMetrics(globalAirports, airportLoads);
    }
    return {};
  }, [airportLoads]);

  const activeAirportRows = useMemo(() => {
    if (!airportLoads || Object.keys(airportLoads).length === 0) return [];
    return Object.entries(airportLoads)
      .sort(([, a], [, b]) => (b.occupancy || 0) - (a.occupancy || 0))
      .slice(0, 8)
      .map(([icao, data]) => ({
        city: airportByIcao[icao]?.city ?? icao,
        capacity: `${Number(data.occupancy || 0).toFixed(1)}%`,
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
    const local = activeAircraftAll.find(a => a.id === id || String(a.lotId) === id || a.id === `vuelo-${id}` || a.id.startsWith(`vuelo-${id}-`));
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
      } else {
        alert("Envío no encontrado en el historial de la sesión.");
      }
    } catch (err) {
      console.error("[Tasf.B2B] Error en búsqueda profunda:", err);
    } finally {
      setIsSearching(false);
    }
  }, [activeAircraftAll, sessionId]);

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

  const warehouseFiltered = useMemo(() => {
    if (!selectedAirportCode) return rankedAircraftBase;
    return rankedAircraftBase.filter(
      p => p.from === selectedAirportCode || p.to === selectedAirportCode
    );
  }, [rankedAircraftBase, selectedAirportCode]);

  const activeAircraft = useMemo(() => {
    if (warehouseFiltered.length === 0) return [];
    if (warehouseFiltered.length <= MAX_MAP_ROUTES && !selectedAircraftId) return warehouseFiltered;
    const now = smoothSimTime || currentEpochTime;
    const inAir = [];
    const onGround = [];
    let selected = null;
    for (const p of warehouseFiltered) {
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
        const stillExists =
          activeAircraftAll.some(a => a.id === id);

        console.log(
          `[AIRCRAFT_REMOVE] ${id}`,
          {
            stillExists,
            totalAircraft: aircraft.length,
            totalVisible: finalSelection.length
          }
        );
      }
    });
    prevActiveIdsRef.current = activeIds;
    return finalSelection;
  }, [warehouseFiltered, currentEpochTime, smoothSimTime, selectedAircraftId]);

  const selectedAircraft = useMemo(
    () => activeAircraftAll.find((p) => p.id === selectedAircraftId) ?? null,
    [activeAircraftAll, selectedAircraftId],
  )

  useEffect(() => {
    if (selectedAircraftId && !selectedAircraft) setSelectedAircraftId(null)
  }, [selectedAircraftId, selectedAircraft])

  const selectedFromAirport = selectedAircraft ? (airportByIcao[selectedAircraft.from] ?? null) : null;
  const selectedToAirport = selectedAircraft ? (airportByIcao[selectedAircraft.to] ?? null) : null;

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
      if (!epoch || !start) return "--:--";
      const date = new Date(epoch);
      const day = pad(date.getUTCDate());
      const month = pad(date.getUTCMonth() + 1);
      const year = date.getUTCFullYear();
      const h = pad(date.getUTCHours());
      const m = pad(date.getUTCMinutes());
      const s = pad(date.getUTCSeconds());
      return `${day}/${month}/${year} ${h}:${m}:${s}`;
    };
    const fmtSimElapsed = (epoch, start) => {
      if (!epoch || !start || epoch < start) return "00:00:00";
      const diffSecs = Math.floor((epoch - start) / 1000);
      const d = Math.floor(diffSecs / 86400);
      const h = pad(Math.floor((diffSecs % 86400) / 3600));
      const m = pad(Math.floor((diffSecs % 3600) / 60));
      const s = pad(diffSecs % 60);
      return d > 0 ? `${d}d ${h}:${m}:${s}` : `${h}:${m}:${s}`;
    };
    const fmtRealClock = () => {
      const date = new Date();
      const day = pad(date.getDate());
      const month = pad(date.getMonth() + 1);
      const year = date.getFullYear();
      const h = pad(date.getHours());
      const m = pad(date.getMinutes());
      const s = pad(date.getSeconds());
      return `${day}/${month}/${year} ${h}:${m}:${s}`;
    };
    const fmtReal = (s) => {
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      return `${pad(h)}:${pad(m)}:${pad(sec)}`;
    };

    if (sessionId && meta.status !== "idle") {
      let fleetLoad = 0, fleetCap = 0
      aircraft.forEach(p => {
        if (p.status !== "cancelled") {
          fleetLoad += p.ocupacionReal || 0
          fleetCap += p.capacidadMax || 0
        }
      })
      const fleetOccupancyPct = fleetCap > 0 ? (fleetLoad / fleetCap) * 100 : 0

      return {
        scenarioLabel: "Simulación en vivo",
        systemClock: fmtSim(smoothSimTime || currentEpochTime, meta.startEpoch),
        realTimeElapsed: fmtReal(realElapsedSecs),
        realTimeRemaining: fmtReal(Math.max(0, (targetPlaybackMinutes * 60) - realElapsedSecs)),
        simulatedElapsed: fmtSimElapsed(smoothSimTime || currentEpochTime, meta.startEpoch),
        realClock: fmtRealClock(),
        globalCapacity: `${globalOccupancyCalculated.toFixed(1)}%`,
        networkLatency: "OK",
        flightsInCourse: { value: aircraft.length ?? 0, delta: "datos reales", status: "green" },
        storageOccupancy: {
          value: globalOccupancyCalculated.toFixed(1),
          subtitle: "Promedio red",
          status: globalOccupancyCalculated === 0 ? "idle"
            : globalOccupancyCalculated >= 90 ? "red"
              : globalOccupancyCalculated >= 70 ? "amber" : "green",
        },
        fleetOccupancy: {
          value: fleetOccupancyPct.toFixed(1),
          subtitle: "Carga total / Capacidad máxima",
          status: fleetOccupancyPct === 0 ? "idle"
            : fleetOccupancyPct >= 90 ? "red"
              : fleetOccupancyPct >= 70 ? "amber" : "green",
        },
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
      realTimeRemaining: fmtReal(targetPlaybackMinutes * 60),
      simulatedElapsed: "00:00:00",
      realClock: fmtRealClock(),
      globalCapacity: "0%",
      networkLatency: "--",
      flightsInCourse: { value: 0, delta: "--", status: "green" },
      storageOccupancy: { value: "0.0", subtitle: "--", status: "idle" },
      sla: { value: 0, subtitle: "--", status: "green" },
      criticalNodes: { value: 0, subtitle: "--", status: "green" },
      progress: { label: "Listo", percent: 0, simulatedTime: "00:00:00", status: "amber" },
      transitByContinent: { america: 0, europe: 0, asia: 0 },
    };
  }, [meta, kpis, clock, aircraft, sessionId, smoothSimTime, currentEpochTime, realElapsedSecs, globalOccupancyCalculated, transitByContinent, realTimeTicker, targetPlaybackMinutes]);

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
          key: "fleetOccupancy",
          title: "Ocupación global flota (UT)",
          value: `${fleetOccupancyPct.toFixed(1)}%`,
          subtitle: "Carga total / Capacidad máxima",
          status: fleetOccupancyPct === 0 ? "idle" : fleetOccupancyPct >= 90 ? "red" : fleetOccupancyPct >= 70 ? "amber" : "green",
        },
        {
          key: "occupancy",
          title: "Ocupación global almacenes",
          value: `${globalOccupancyCalculated.toFixed(1)}%`,
          subtitle: "Promedio red · datos reales",
          status: globalOccupancyCalculated === 0 ? "idle"
            : globalOccupancyCalculated >= 90 ? "red"
              : globalOccupancyCalculated >= 70 ? "amber" : "green",
        },
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
          subtitle: meta.status === "DONE" ? "✓ Completado" : `Hora simulada actual: ${summary.simulatedElapsed || "00:00:00"}`,
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
      { key: "progress", title: isCollapseScenario ? "Estado colapso" : "Progreso", value: "0%", subtitle: "Listo para iniciar", status: "amber", progress: 0 },
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

  const totalBagsWaiting = kpis.totalBagsWaiting ?? 0;



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
    airportNodes: globalAirports,
    comparisonData,
    elapsedOperationTime,
    currentEpochTime,
    totalBagsWaiting,
    activeShipments,
    handleTabChange,
    isCollapseScenario,
    isDockCollapsed,
    isKpiCollapsed,
    isScenarioConfigOpen,
    isSimScenario,
    kpiCards,
    liveStatus,
    masterPlan,
    selectedAircraftId,
    selectedAirportCode,
    setSelectedAirportCode,
    selectedAlgorithm,
    selectedFromAirport,
    selectedToAirport,
    sessionId,
    searchShipment,
    searchedShipment,
    isSearching,
    setSelectedAircraftId,
    setSelectedAlgorithm,
    simState,
    startSimulation,
    startDayToDaySimulation,
    startCollapseSimulation,
    exportSimulationExcel,
    exportSimulationReportMd,
    exportDetailedSimulationReport,
    resetSimulation,
    cancelFlight,
    cancelledFlights,
    addCancelledFlight,
    summary,
    tabs: SCENARIO_TABS,
    toggleDock,
    toggleKpiStrip,
    toggleScenarioConfig,
    trackedRouteData,
    targetPlaybackMinutes,
    setTargetPlaybackMinutes
  };
};

export default useControlTowerController;
