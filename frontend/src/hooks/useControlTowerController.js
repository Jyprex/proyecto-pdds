import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createStompClient } from './ws';
import { apiFetch, apiUrl } from './api';
import {
  AIRPORT_NODES,
  AIRPORT_ROWS,
  COLLAPSE_AIRPORT_ROWS,
  SCENARIO_TABS,
} from "../data/controlTowerData";
import { AIRPORT_BY_ICAO, buildAirportMetrics, AIRPORTS, calculateAircraftRotation } from "../data/airportsData";

const PANEL_VISIBILITY_DEFAULT = {
  telemetry: true,
  legend: true,
  occupancy: true,
  transitInventory: false,
  comparison: false,
  shipmentDetail: false,
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
  const [panelVisibility, setPanelVisibility] = useState(PANEL_VISIBILITY_DEFAULT);
  const [isKpiCollapsed, setIsKpiCollapsed] = useState(readStoredKpiCollapsed);
  const [selectedAircraftId, setSelectedAircraftId] = useState(null);
  const [selectedAirportCode, setSelectedAirportCode] = useState(null);
  const [isAirportDetailOpen, setIsAirportDetailOpen] = useState(false);
  const [isDockCollapsed, setIsDockCollapsed] = useState(false);
  const [isScenarioConfigOpen, setIsScenarioConfigOpen] = useState(false);
  const [selectedAlgorithm, setSelectedAlgorithm] = useState("hga");
  const [simState, setSimState] = useState("idle");
  const [simSpeed, setSimSpeed] = useState(1);

  const [sessionId, setSessionId] = useState(null);
  const [isFluidMode, setIsFluidMode] = useState(false);

  /** Fase 1: Atomización del Estado para optimización de rendimiento */
  const [meta, setMeta] = useState({
    status: "idle", percent: 0, currentDay: 0, totalDays: 0,
    isCollapseMode: false, errorMessage: null, algorithm: "hga",
    startEpoch: null, totalAttended: 0, totalMissed: 0, slaFinal: 0,
    reports: []
  });
  const [kpis, setKpis] = useState({
    slaPercent: 0, globalOccupancy: 0, criticalNodes: 0,
    totalBagsWaiting: 0, rescuedFlights: 0, comparisonResults: null
  });
  const [airportLoads, setAirportLoads] = useState({});
  const [aircraft, setAircraft] = useState([]);
  const [clock, setClock] = useState({ simulatedTime: "--:--", currentEpochTime: 0 });
  const [smoothSimTime, setSmoothSimTime] = useState(0);
  const smoothSimTimeRef = useRef(0);
  const [realElapsedSecs, setRealElapsedSecs] = useState(0);
  const realStartRef = useRef(null);
  const [logs, setLogs] = useState([]);

  /** Snapshot buffer y referencias de reloj */
  const snapshotBufferRef = useRef([]);
  const simClockRef = useRef({ serverEpoch: 0, receivedAt: 0, ratio: 1 });

  const isCollapseScenario = activeTab === "colapso";
  const isSimScenario = activeTab === "periodo" || activeTab === "colapso";

  const togglePanel = useCallback((panelName = "") => {
    if (!panelName) return;
    setPanelVisibility((current) => ({ ...current, [panelName]: !current[panelName] }));
  }, []);

  const handleTabChange = useCallback((tabKey = "vivo") => {
    setActiveTab(tabKey);
    setIsScenarioConfigOpen(false);
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
      isCollapseMode: false, errorMessage: null, algorithm: selectedAlgorithm || "hga",
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

      const playbackMin = isFluidMode ? 60 : 1;
      const res = await apiFetch(`/api/v1/simulation/run/${dias}?algorithm=${selectedAlgorithm}&playbackMinutes=${playbackMin}`, {
        method: "POST",
      });

      if (!res.ok) throw new Error(`Backend respondió ${res.status}`);

      const data = await res.json();
      setSessionId(data.sessionId);
    } catch (err) {
      console.error("[Tasf.B2B] Error al iniciar simulación:", err);
      setSimState("idle");
    }
  }, [selectedAlgorithm, isFluidMode]);

  const startDayToDaySimulation = useCallback(async (startDate, dias = 5, preCancelledIds = []) => {
    try {
      setSimState("running");
      setAircraft([]);
      setLogs([]);
      realStartRef.current = Date.now();
      setRealElapsedSecs(0);
      snapshotBufferRef.current = [];
      smoothSimTimeRef.current = 0;
      setSmoothSimTime(0);

      const playbackMin = isFluidMode ? 60 : 1;
      const preCancelStr = preCancelledIds.length > 0 ? preCancelledIds.join(",") : "";
      const url = apiUrl(`/api/v1/simulation/run/${dias}?algorithm=${selectedAlgorithm}&startDate=${startDate}&playbackMinutes=${playbackMin}&preCancelledFlightIds=${preCancelStr}`);
      const res = await fetch(url, { method: "POST" });

      if (!res.ok) throw new Error(`Backend respondió ${res.status}`);

      const data = await res.json();
      setSessionId(data.sessionId);
      console.info(`[Tasf.B2B] Simulación día a día iniciada: ${startDate} × ${dias} días | ${selectedAlgorithm.toUpperCase()} | Pre-cancelados: ${preCancelStr}`);
    } catch (err) {
      console.error("[Tasf.B2B] Error al iniciar simulación día a día:", err);
      setSimState("idle");
    }
  }, [selectedAlgorithm, isFluidMode]);

  const startCollapseSimulation = useCallback(async (dias = 5, startDate = null, stressFactor = 5) => {
    try {
      setSimState("running");
      setAircraft([]);
      setLogs([]);
      realStartRef.current = Date.now();
      setRealElapsedSecs(0);
      snapshotBufferRef.current = [];
      smoothSimTimeRef.current = 0;
      setSmoothSimTime(0);

      const playbackMin = isFluidMode ? 60 : 1;
      const dateParam   = startDate    ? `&startDate=${startDate}`       : "";
      const stressParam = stressFactor ? `&stressFactor=${stressFactor}` : "";
      const res = await apiFetch(
        `/api/v1/simulation/run-collapse/${dias}?algorithm=${selectedAlgorithm}${dateParam}${stressParam}&playbackMinutes=${playbackMin}`,
        { method: "POST" }
      );

      if (!res.ok) throw new Error(`Backend respondió ${res.status}`);

      const data = await res.json();
      setSessionId(data.sessionId);
      console.info(`[Tasf.B2B] Simulación colapso iniciada: ${startDate ?? "hoy"} × ${dias} días | ${selectedAlgorithm.toUpperCase()} | estrés ×${stressFactor}`);
    } catch (err) {
      console.error("[Tasf.B2B] Error al iniciar simulación de colapso:", err);
      setSimState("idle");
    }
  }, [selectedAlgorithm, isFluidMode]);

  const exportSimulationExcel = useCallback(async (sid, algorithm = "ALNS") => {
    if (!sid) return;
    try {
      const res = await apiFetch(
        `/api/v1/simulation/export-excel/${sid}?algorithm=${algorithm}`,
        { method: "POST" }
      );
      if (!res.ok) throw new Error(`Error al exportar: ${res.status}`);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
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
      md += `Análisis de la saturación de almacenamiento por aeropuerto en el transcurso de la simulación.\n\n`;
      
      if (finalStatus.airportLoads && Object.keys(finalStatus.airportLoads).length > 0) {
        const sortedAirports = Object.entries(finalStatus.airportLoads)
          .map(([icao, load]) => ({ icao, load }))
          .sort((a, b) => b.load - a.load);
        
        const top5 = sortedAirports.slice(0, 5);
        const maxLoad = top5[0]?.load || 0;
        
        md += `| Puesto | Código ICAO | Carga (Maletas en Espera) | Nivel de Congestión | Alerta |\n`;
        md += `| :---: | :---: | :---: | :--- | :---: |\n`;
        
        top5.forEach((item, index) => {
          let level = "🟢 Bajo";
          let alertEmoji = "";
          if (item.load > 0) {
            if (item.load >= maxLoad * 0.8) {
              level = "🔴 Crítico (Saturación Alta)";
              alertEmoji = "⚠️";
            } else if (item.load >= maxLoad * 0.4) {
              level = "🟡 Moderado (Saturación Media)";
              alertEmoji = "⚠️";
            } else {
              level = "🔵 Controlado";
            }
          }
          md += `| ${index + 1} | **${item.icao}** | ${item.load.toLocaleString()} | ${level} | ${alertEmoji} |\n`;
        });
      } else {
        md += `*No se registraron datos de carga o todos los aeropuertos operaron con carga cero (saturación nula).*\n`;
      }
      md += `\n`;

      md += `## ❌ Registro de Cancelaciones y Disrupciones de Vuelos\n`;
      md += `Detalle de las cancelaciones de vuelos ocurridas durante la operación y su correspondiente respuesta de replanificación.\n\n`;

      const cancellations = (finalStatus.eventLog ?? []).filter(line => 
        line.includes("CANCELADO") || line.includes("flight_cancelled") || line.includes("Cancelado")
      );

      if (cancellations.length > 0) {
        md += `| Tiempo | Evento / Detalle | Estado |\n`;
        md += `| :---: | :--- | :---: |\n`;
        cancellations.forEach(line => {
          const match = line.match(/^\[([^\]]+)\]\s*(.*)$/);
          if (match) {
            const time = match[1];
            const detail = match[2];
            md += `| \`${time}\` | ${detail} | 🚨 Cancelado y Replanificado |\n`;
          } else {
            md += `| — | ${line} | 🚨 Cancelado y Replanificado |\n`;
          }
        });
      } else {
        md += `*No se registraron cancelaciones de vuelos ni disrupciones en esta sesión de simulación.*\n`;
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
        md += `| - | No hay datos disponibles para mostrar | - | - | - | - |\n`;
      }
      md += `\n`;

      if (finalStatus.eventLog && finalStatus.eventLog.length > 0) {
        md += `## 📝 Bitácora Inteligente de Eventos (Event Log)\n\n`;
        
        const logLines = finalStatus.eventLog;
        const totalLines = logLines.length;
        
        const criticalKeywords = [
          "cancelado", "saturado", "100% ocupación", "flight_cancelled", 
          "colapso", "replanificación", "replan", "crítico", "saturación", 
          "collapse", "failed", "falló", "storage_release", "baggage_pickup"
        ];
        
        const formatLogLine = (line) => {
          const match = line.match(/^\[(\d{2}:\d{2})\]\s*(.*)$/);
          if (match) {
            const time = match[1];
            let msg = match[2];
            if (criticalKeywords.some(kw => msg.toLowerCase().includes(kw))) {
              if (!msg.includes("🚨") && !msg.includes("⚠️") && !msg.includes("❌")) {
                msg = "🚨 " + msg;
              }
            }
            return `- **[${time}]** ${msg}`;
          }
          return `- ${line}`;
        };

        if (totalLines <= 6) {
          md += `### 📋 Historial de Eventos\n`;
          logLines.forEach(l => {
            md += `${formatLogLine(l)}\n`;
          });
          md += `\n`;
        } else {
          const first3Indices = new Set([0, 1, 2].filter(i => i < totalLines));
          const last3Indices = new Set([totalLines - 3, totalLines - 2, totalLines - 1].filter(i => i >= 0 && !first3Indices.has(i)));
          
          const first3Lines = [...first3Indices].map(i => formatLogLine(logLines[i]));
          const last3Lines = [...last3Indices].map(i => formatLogLine(logLines[i]));
          
          const criticalLines = [];
          for (let i = 0; i < totalLines; i++) {
            if (first3Indices.has(i) || last3Indices.has(i)) continue;
            const line = logLines[i];
            const isCritical = criticalKeywords.some(kw => line.toLowerCase().includes(kw));
            if (isCritical) {
              criticalLines.push(formatLogLine(line));
            }
          }

          md += `### 🎬 Fase Inicial (Primeros Eventos del Ciclo)\n`;
          first3Lines.forEach(l => { md += `${l}\n`; });
          md += `\n`;

          if (criticalLines.length > 0) {
            md += `### 🚨 Disrupciones y Eventos Críticos Detectados\n`;
            criticalLines.forEach(l => { md += `${l}\n`; });
            md += `\n`;
          }

          if (last3Lines.length > 0) {
            md += `### 🏁 Fase de Cierre (Últimos Eventos del Ciclo)\n`;
            last3Lines.forEach(l => { md += `${l}\n`; });
            md += `\n`;
          }
        }
      }

      md += `---\n> 🔒 **Nota de Confidencialidad:** Este reporte contiene información operativa sensible y de carácter confidencial. Su distribución está restringida a personal autorizado de **TASF-B2B**.`;
      
      const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `ResultadosDeEscenario_${name.replace(/\s+/g, '')}_${sid.substring(0, 8)}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[Tasf.B2B] Error al exportar MD:", err);
    }
  }, []);

  /**
   * Conexión WebSocket / STOMP
   */
  useEffect(() => {
    if (!sessionId) return;

    // Reiniciar secuencia para nueva sesión
    simClockRef.current.lastSeq = -1;

    const client = createStompClient();

    client.onConnect = () => {
      console.info('[Tasf.B2B] STOMP conectado al backend.');
      let maxEpochReceived = 0;

      const handleSnapshotData = (epoch, type, data) => {
        if (epoch < maxEpochReceived - 60000) return; // Permitir ligero jitter, descartar viejos
        if (epoch > maxEpochReceived) maxEpochReceived = epoch;

        let snap = snapshotBufferRef.current.find(s => s.epoch === epoch);
        if (!snap) {
          snap = { epoch };
          snapshotBufferRef.current.push(snap);
          snapshotBufferRef.current.sort((a, b) => a.epoch - b.epoch);
        }
        
        if (type === 'snapshot') {
          snap.clock = data.simulatedTime;
          snap.routes = data.activeRoutes || [];
        } else if (type === 'kpi') {
          snap.kpis = data;
          snap.airportLoads = data.airportLoads || {};
        }
      };

      client.subscribe(`/topic/sim/${sessionId}/snapshot`, (msg) => {
        try {
          const envelope = JSON.parse(msg.body);
          const data = envelope?.data ?? {};
          if (data.currentEpochTime) {
            const totalSimulatedMs = (meta.totalDays || 5) * 24 * 60 * 60 * 1000;
            const playbackMin = isFluidMode ? 60 : 1;
            const targetPlaybackMs = playbackMin * 60 * 1000;
            simClockRef.current.ratio = totalSimulatedMs / targetPlaybackMs;

            handleSnapshotData(data.currentEpochTime, 'snapshot', data);

            if (smoothSimTimeRef.current === 0) {
              smoothSimTimeRef.current = data.currentEpochTime;
              setSmoothSimTime(data.currentEpochTime);
            }
          }
        } catch (err) {
          console.error('Error parsing snapshot:', err);
        }
      });

      client.subscribe(`/topic/sim/${sessionId}/kpi`, async (msg) => {
        try {
          const envelope = JSON.parse(msg.body);
          const data = envelope?.data ?? {};

          if (data.currentEpochTime) {
            handleSnapshotData(data.currentEpochTime, 'kpi', data);

            if (data.status === 'DONE') {
              setSimState('completed');
              try {
                const finalRes = await apiFetch(`/api/v1/simulation/status/${sessionId}`);
                if (finalRes.ok) {
                  const finalStatus = await finalRes.json();
                  setMeta((prev) => ({ ...prev, ...finalStatus }));
                }
              } catch (err) {
                console.error('Error fetching final status', err);
              }
              client.deactivate();
            } else if (data.status === 'FAILED') {
              setSimState('idle');
              console.error('[Tasf.B2B] Simulación falló:', data.errorMessage);
              client.deactivate();
            }
          }
        } catch (err) {
          console.error('Error parsing kpi:', err);
        }
      });

      client.subscribe(`/topic/sim/${sessionId}/eventLog`, (msg) => {
        try {
          const envelope = JSON.parse(msg.body);
          const logEntry = envelope?.data;
          if (!logEntry) return;
          setLogs((prev) => [...prev, logEntry]);
        } catch (err) {
          console.error('Error parsing eventLog:', err);
        }
      });
    };

    client.onStompError = (frame) => {
      console.warn('[Tasf.B2B] STOMP error:', frame?.headers?.message, frame?.body);
    };

    client.onWebSocketError = (err) => {
      console.warn('[Tasf.B2B] WS error:', err);
      setMeta((prev) => prev.status === 'RUNNING' ? { ...prev, status: 'FAILED', errorMessage: 'Error de conexión con el servidor' } : prev);
    };

    client.onWebSocketClose = (evt) => {
      console.warn('[Tasf.B2B] WS close:', evt);
      setMeta((prev) => prev.status === 'RUNNING' ? { ...prev, status: 'FAILED', errorMessage: 'Desconexión del servidor' } : prev);
    };

    client.activate();

    return () => {
      client.deactivate();
    };
  }, [sessionId, isFluidMode, meta.totalDays]);

  /** Loop de interpolación suave para el mapa y el reloj */
  useEffect(() => {
    let raf;
    let lastRealTime = performance.now();

    const update = () => {
      const now = performance.now();
      const delta = now - lastRealTime;
      lastRealTime = now;

      const isStillRunning = (meta.status === "RUNNING" || simState === "running");

      if (isStillRunning) {
        const buffer = snapshotBufferRef.current;
        
        // Solo avanzamos si ya tenemos datos iniciales
        if (smoothSimTimeRef.current > 0) {
          // Avance lineal monótono basado en performance.now (delta real)
          const nextTime = smoothSimTimeRef.current + (delta * simClockRef.current.ratio);
          
          // Sincronización suave:
          // Si nos adelantamos más de 45 minutos del servidor, frenamos para que nos alcance.
          const lastSnapshot = buffer[buffer.length - 1];
          if (!lastSnapshot || nextTime < lastSnapshot.epoch + 45 * 60 * 1000) {
             smoothSimTimeRef.current = nextTime;
          }
          
          setSmoothSimTime(smoothSimTimeRef.current);
        }

        // Consumir snapshots del buffer cuando el tiempo fluido alcanza su epoch
        let lastPoppedSnap = null;
        while (buffer.length > 0 && buffer[0].epoch <= smoothSimTimeRef.current) {
          lastPoppedSnap = buffer.shift();
        }
        
        if (lastPoppedSnap) {
           if (lastPoppedSnap.clock) {
              setClock({ simulatedTime: lastPoppedSnap.clock, currentEpochTime: lastPoppedSnap.epoch });
           }
           if (lastPoppedSnap.routes) {
              setAircraft(lastPoppedSnap.routes);
           }
           if (lastPoppedSnap.airportLoads) {
              setAirportLoads(lastPoppedSnap.airportLoads);
           }
           if (lastPoppedSnap.kpis) {
              const data = lastPoppedSnap.kpis;
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
              } else if (data.status === 'FAILED') {
                  setSimState('idle');
              }
           }
        }
      } else if (meta.status === "DONE" || meta.status === "FAILED" || simState === "completed") {
        if (simClockRef.current.serverEpoch) {
          smoothSimTimeRef.current = simClockRef.current.serverEpoch;
          setSmoothSimTime(smoothSimTimeRef.current);
        }
      }
      
      if (realStartRef.current && isStillRunning) {
        setRealElapsedSecs(Math.floor((Date.now() - realStartRef.current) / 1000));
      }

      raf = requestAnimationFrame(update);
    };

    raf = requestAnimationFrame(update);
    return () => cancelAnimationFrame(raf);
  }, [simState, meta.status, sessionId]);

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

  /**
   * Top aeropuertos por ocupación
   */
  const activeAirportRows = useMemo(() => {
    const base = isCollapseScenario ? COLLAPSE_AIRPORT_ROWS : AIRPORT_ROWS;
    if (!airportLoads || Object.keys(airportLoads).length === 0) {
      return base;
    }
    return Object.entries(airportLoads)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([icao, pct]) => ({
        city: AIRPORT_BY_ICAO[icao]?.city ?? icao,
        capacity: `${pct}%`,
        icao,
      }));
  }, [airportLoads, isCollapseScenario]);

  const currentEpochTime = clock.currentEpochTime || 0;

  /** Lógica de Ventana Móvil: Vuelos en curso o inminentes (ocultando cancelados) */
  const activeShipments = useMemo(() => {
    if (!aircraft || aircraft.length === 0 || !currentEpochTime) return [];
    const viewWindow = 2 * 3600 * 1000;
    return aircraft
      .filter((r) => r.status !== "cancelled")
      .filter((r) => r.arrivalTime > currentEpochTime && r.departureTime <= currentEpochTime + viewWindow)
      .sort((a, b) => a.departureTime - b.departureTime);
  }, [aircraft, currentEpochTime]);

  const activeAircraftAll = useMemo(() => {
    const routes = activeShipments.length > 0
      ? activeShipments
      : (aircraft?.filter(r => r.status !== "cancelled") ?? []);
    if (routes.length === 0) return [];

    const byId = new Map();
    routes.forEach((r) => {
      const next = {
        id: r.id,
        from: r.from,
        to: r.to,
        status: r.status ?? "normal",
        departureTime: r.departureTime,
        arrivalTime: r.arrivalTime,
        capacityPercent: r.capacityPercent ?? 0,
        progress: r.progress,
        rotation: calculateAircraftRotation(AIRPORT_BY_ICAO[r.from], AIRPORT_BY_ICAO[r.to]),
      };
      const prev = byId.get(next.id);
      if (!prev) {
        byId.set(next.id, next);
        return;
      }
      const nextPriority = STATUS_PRIORITY[next.status] ?? 0;
      const prevPriority = STATUS_PRIORITY[prev.status] ?? 0;
      if (nextPriority > prevPriority) {
        byId.set(next.id, next);
        return;
      }
      if (nextPriority === prevPriority && next.capacityPercent > prev.capacityPercent) {
        byId.set(next.id, next);
      }
    });

    return Array.from(byId.values());
  }, [activeShipments, aircraft]);

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
      if (selectedAircraftId && p.id === selectedAircraftId) {
        selected = p;
      }
      const isCurrentlyInAir = now ? (p.departureTime <= now && now < p.arrivalTime) : true;
      if (isCurrentlyInAir) {
        inAir.push(p);
      } else {
        onGround.push(p);
      }
    }

    const combined = [...inAir, ...onGround];
    const budget = Math.max(0, MAX_MAP_ROUTES - (selected ? 1 : 0));
    const finalSelection = combined.slice(0, budget);

    if (selected && !finalSelection.some((p) => p.id === selected.id)) {
      finalSelection.push(selected);
    }

    return finalSelection;
  }, [rankedAircraftBase, currentEpochTime, smoothSimTime, selectedAircraftId]);

  const selectedAircraft = useMemo(
    () => activeAircraftAll.find((p) => p.id === selectedAircraftId) ?? null,
    [activeAircraftAll, selectedAircraftId]
  );

  useEffect(() => {
    if (selectedAircraftId && !selectedAircraft) {
      setSelectedAircraftId(null);
    }
  }, [selectedAircraftId, selectedAircraft]);

  const selectedFromAirport = selectedAircraft
    ? (AIRPORT_BY_ICAO[selectedAircraft.from] ?? null)
    : null;
  const selectedToAirport = selectedAircraft
    ? (AIRPORT_BY_ICAO[selectedAircraft.to] ?? null)
    : null;

  const selectedAirport = selectedAirportCode
    ? (AIRPORT_BY_ICAO[selectedAirportCode] ?? null)
    : null;

  const selectedAirportMetrics = selectedAirport
    ? (activeMetrics[selectedAirport.icao] ?? null)
    : null;

  const selectedAirportLevel = selectedAirportMetrics?.level ?? "green";

  const globalOccupancyCalculated = useMemo(() => {
    const loads = Object.values(airportLoads);
    if (loads.length === 0) return kpis.globalOccupancy ?? 0;
    const sum = loads.reduce((a, b) => a + b, 0);
    return sum / loads.length;
  }, [airportLoads, kpis.globalOccupancy]);

  const transitByContinent = useMemo(() => {
    const routes = aircraft ?? [];
    if (routes.length === 0) return { america: 0, europe: 0, asia: 0 };

    const americaIcao = ["K", "C", "M", "S", "T"];
    const asiaIcao = ["Z", "R", "V", "W", "O", "U", "P"];
    let america = 0, europe = 0, asia = 0;

    routes.forEach(r => {
      const prefix = (r.to ?? "").charAt(0).toUpperCase();
      if (americaIcao.includes(prefix)) america++;
      else if (asiaIcao.includes(prefix)) asia++;
      else europe++;
    });

    const scale = Math.max(1, kpis.totalBagsWaiting ?? routes.length);
    const total = routes.length || 1;
    return {
      america: Math.round((america / total) * scale),
      europe:  Math.round((europe  / total) * scale),
      asia:    Math.round((asia    / total) * scale),
    };
  }, [aircraft, kpis.totalBagsWaiting]);

  const summary = useMemo(() => {
    if (sessionId && meta.status !== "idle") {
      const pad = (n) => String(n).padStart(2, "0");
      const fmtSim = (epoch, start) => {
        if (!epoch || !start) return "--:--:--";
        const diff = epoch - start;
        const days = Math.floor(diff / (24 * 3600 * 1000)) + 1;
        const hours = Math.floor((diff % (24 * 3600 * 1000)) / (3600 * 1000));
        const minutes = Math.floor((diff % (3600 * 1000)) / (60 * 1000));
        const seconds = Math.floor((diff % (60 * 1000)) / 1000);
        return `Día ${days} - ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
      };

      const fmtReal = (s) => {
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        return `${pad(h)}:${pad(m)}:${pad(sec)}`;
      };

      return {
        scenarioLabel: "Simulación en vivo",
        operationStart: "Día 1",
        systemClock: fmtSim(smoothSimTime || currentEpochTime, meta.startEpoch),
        realTimeElapsed: fmtReal(realElapsedSecs),
        globalCapacity: `${globalOccupancyCalculated.toFixed(1)}%`,
        networkLatency: "OK",
        flightsInCourse: {
          value: aircraft.filter(r => r.status !== "cancelled").length ?? 0,
          delta: "datos reales",
          status: "green"
        },
        storageOccupancy: {
          value: Math.round(globalOccupancyCalculated),
          subtitle: "Promedio red",
          status: (globalOccupancyCalculated >= 90) ? "red" : "green"
        },
        sla: {
          value: kpis.slaPercent?.toFixed(1) ?? 0,
          subtitle: "Real",
          status: (kpis.slaPercent >= 90) ? "green" : "red"
        },
        criticalNodes: {
          value: kpis.criticalNodes ?? 0,
          subtitle: ">90% ocupación",
          status: (kpis.criticalNodes > 5) ? "red" : "green"
        },
        progress: {
          label: meta.status === "DONE" ? "Completado" : "Ejecutando",
          percent: meta.percent ?? 0,
          simulatedTime: clock.simulatedTime ?? `Día ${meta.currentDay}`,
          status: meta.status === "DONE" ? "green" : "amber"
        },
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

  const elapsedOperationTime = summary.progress.simulatedTime;

  const kpiCards = useMemo(() => {
    if (sessionId && meta.status !== "idle") {
      const progressPercent = meta.percent ?? 0;
      const dayLabel = meta.totalDays
        ? `Día ${meta.currentDay} / ${meta.totalDays}`
        : "Iniciando...";

      return [
        {
          key: "flights",
          title: "Vuelos en curso",
          value: aircraft.filter(r => r.status !== "cancelled").length ?? 0,
          subtitle: `Día ${meta.currentDay} de simulación`,
          status: "green",
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
          subtitle: "Maletas atendidas / demanda total",
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
      {
        key: "flights",
        title: "Vuelos en curso",
        value: 0,
        subtitle: "Esperando inicio...",
        status: "green",
      },
      {
        key: "occupancy",
        title: "Ocupación global almacenes",
        value: "0%",
        subtitle: "Esperando inicio...",
        status: "green",
      },
      {
        key: "sla",
        title: "Entregas a tiempo (SLA)",
        value: "0%",
        subtitle: "Esperando inicio...",
        status: "green",
      },
      {
        key: "critical",
        title: "Nodos críticos",
        value: 0,
        subtitle: "Esperando inicio...",
        status: "green",
      },
      {
        key: "progress",
        title: isCollapseScenario ? "Estado de colapso" : "Progreso simulación",
        value: "Listo · 0%",
        subtitle: "Presione Ejecutar simulación",
        status: "amber",
        progress: 0,
      },
    ];
  }, [isCollapseScenario, meta, kpis, aircraft, sessionId, globalOccupancyCalculated]);

  const comparisonData = useMemo(() => {
    if (kpis.comparisonResults) {
      const hgaResult = kpis.comparisonResults.hga || kpis.comparisonResults.HGA;
      const alnsResult = kpis.comparisonResults.alns || kpis.comparisonResults.ALNS;

      return {
        hga: hgaResult ? {
          execTime: hgaResult.execTime ?? "-",
          deliveredOnTime: hgaResult.deliveredOnTime?.toLocaleString('es-PE') ?? "-",
          totalDeliveries: hgaResult.totalDeliveries?.toLocaleString('es-PE') ?? "-",
          slaPercent: hgaResult.slaPercent?.toFixed(1) ?? "-",
          avgRouteLength: hgaResult.avgRouteLength ?? "-",
          replanifications: hgaResult.replanifications ?? "-",
          rescuedFlights: hgaResult.rescuedFlights ?? 0,
        } : null,
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

  const eventLog = logs;
  const totalBagsWaiting = kpis.totalBagsWaiting ?? 0;

  useEffect(() => {
    if (!isAirportDetailOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setIsAirportDetailOpen(false);
    };
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
    selectedAirportMetrics,
  };
};
