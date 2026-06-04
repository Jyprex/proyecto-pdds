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
// Antes: polling; ahora el estado live viene por WebSocket.
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

  const [sessionId, setSessionId] = useState(null);
  const [isFluidMode, setIsFluidMode] = useState(false);
  const [targetPlaybackMinutes, setTargetPlaybackMinutes] = useState(30);

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
  const [clock, setClock] = useState({ simulatedTime: "--:--", currentEpochTime: 0 });
  const [smoothSimTime, setSmoothSimTime] = useState(0);
  const smoothSimTimeRef = useRef(0);
  const [realElapsedSecs, setRealElapsedSecs] = useState(0);
  const realStartRef = useRef(null);
  const [logs, setLogs] = useState([]);

  // ── BUFFER DE SNAPSHOTS PARA SIMULACIÓN FLUIDA ────────────────────────────
  const snapshotBufferRef = useRef([]);
  const BUFFER_MIN_SIZE = 1; // Basta con un snapshot para iniciar visualmente

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
    ratio: (5 * 24 * 60) / 30 // ratio por defecto para 5 días en 30 minutos (240x)
  });

  /** Loop de interpolación suave para el mapa y el reloj */
  useEffect(() => {
    let raf;
    let lastRealTime = performance.now();

    const update = () => {
      const now = performance.now();
      const delta = now - lastRealTime;
      lastRealTime = now;

      // La animación debe continuar si estamos en 'running'
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
                // Para que la animación sea PERFECTAMENTE FLUIDA y LINEAL en CUALQUIER VELOCIDAD
                // (1 min, 5 min, 30 min, 60 min), calculamos la velocidad base ideal:
                const totalDays = meta.totalDays > 0 ? meta.totalDays : 5;
                const totalSimulatedMs = totalDays * 24 * 60 * 60 * 1000;
                const targetPlaybackMs = (targetPlaybackMinutes || 30) * 60 * 1000;
                const baseRatio = totalSimulatedMs / Math.max(1000, targetPlaybackMs);

                // Compensación de red (Jitter Buffer):
                // Si el backend se atrasa (timeDiff bajo) frenamos un poco.
                // Si el backend se adelanta (timeDiff alto) aceleramos un poco.
                // Así evitamos las pausas bruscas y los saltos (parpadeos).
                const idealDelayMs = baseRatio * 500; // 500ms es la ventana de emisión del backend
                let dynamicRatio = baseRatio;

                if (timeDiff > idealDelayMs * 3) {
                    // Si el salto es masivo (reconexión/lag alto), saltar directamente
                    nextTime = maxTargetTime - idealDelayMs;
                } else if (timeDiff > idealDelayMs * 1.5) {
                    dynamicRatio = baseRatio * 1.15; // Acelerar 15% para alcanzar suavemente
                } else if (timeDiff < idealDelayMs * 0.5) {
                    dynamicRatio = baseRatio * 0.85; // Frenar 15% para no chocar y pausar bruscamente
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
        
        // Consumir todos los snapshots cuyo epoch ya fue alcanzado por smoothSimTime
        while (buffer.length > 0 && buffer[0].epoch <= smoothSimTimeRef.current) {
          const snap = buffer.shift();
          if (snap.clock !== undefined) appliedClock = snap.clock;
          if (snap.epoch !== undefined) appliedEpoch = snap.epoch;
          if (snap.routes !== undefined) appliedRoutes = snap.routes;
          if (snap.airportLoads !== undefined) appliedAirportLoads = snap.airportLoads;
          if (snap.kpis !== undefined) appliedKpis = snap.kpis;
        }
        
        if (appliedClock !== null && appliedEpoch !== null) {
           setClock({ simulatedTime: appliedClock, currentEpochTime: appliedEpoch });
        }
        if (appliedRoutes !== null) {
           setAircraft(appliedRoutes);
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
               try {
                   apiFetch(`/api/v1/simulation/status/${sessionId}`).then(res => {
                       if (res.ok) {
                           res.json().then(finalStatus => {
                               setMeta(prev => ({ ...prev, ...finalStatus }));
                           });
                       }
                   });
               } catch (err) {
                   console.error('Error fetching final status', err);
               }
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
    setMeta({ status: "idle", percent: 0, currentDay: 0, totalDays: 0 });
    setKpis({ slaPercent: 0, globalOccupancy: 0, criticalNodes: 0, totalBagsWaiting: 0, rescuedFlights: 0 });
    setAirportLoads({});
    setAircraft([]);
    setClock({ simulatedTime: "--:--", currentEpochTime: 0 });
    setLogs([]);
    smoothSimTimeRef.current = 0;
    setSmoothSimTime(0);
  }, []);

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

  /**
   * Inicia simulación Día a Día con fecha de inicio y número de días específicos.
   */
  const startDayToDaySimulation = useCallback(async (startDate, dias = 5) => {
    try {
      setSimState("running");
      setAircraft([]);
      setLogs([]);
      realStartRef.current = Date.now();
      setRealElapsedSecs(0);

      const url = `/api/v1/simulation/run/${dias}?algorithm=${selectedAlgorithm}&startDate=${startDate}&playbackMinutes=${targetPlaybackMinutes}`;
      const res = await apiFetch(url, { method: "POST" });

      if (!res.ok) throw new Error(`Backend respondió ${res.status}`);

      const data = await res.json();
      setSessionId(data.sessionId);
      console.info(`[Tasf.B2B] Simulación día a día iniciada: ${startDate} × ${dias} días | ${selectedAlgorithm.toUpperCase()}`);
    } catch (err) {
      console.error("[Tasf.B2B] Error al iniciar simulación día a día:", err);
      setSimState("idle");
    }
  }, [selectedAlgorithm, targetPlaybackMinutes]);

  /**
   * Descarga el Excel de resultados de la simulación completada.
   */
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

  /**
   * Descarga un reporte en formato Markdown de la simulación.
   */
  const exportSimulationReportMd = useCallback(async (sid, name = "Escenario") => {
    if (!sid) return;
    try {
      const res = await fetch(`/api/v1/simulation/status/${sid}`);
      if (!res.ok) throw new Error(`Error al obtener status: ${res.status}`);
      const finalStatus = await res.json();

      let md = `# Reporte Detallado de Simulación: ${name.replace(/_/g, ' ')}\n\n`;
      md += `> Documento generado automáticamente por el Sistema de Control Logístico TASF-B2B.\n\n`;
      md += `## 📋 Información de la Sesión\n`;
      md += `- **ID de Sesión:** \`${sid}\`\n`;
      md += `- **Fecha de Generación:** ${new Date().toLocaleString()}\n`;
      md += `- **Duración Simulada:** ${finalStatus.totalDays} días\n`;
      if (finalStatus.startEpoch) {
        md += `- **Fecha Simulada (Inicio):** ${new Date(finalStatus.startEpoch).toLocaleDateString()}\n`;
      }
      let modeText = '✅ Operación Normal';
      if (finalStatus.isCollapseMode) modeText = '🚨 Colapso Inducido';
      else if (name === 'Operacion_Dia_a_Dia') modeText = '📅 Operación Día a Día';
      else if (name === 'Simulacion_Periodo') modeText = '📊 Simulación de Periodo';
      md += `- **Modo de Escenario:** ${modeText}\n`;
      if (finalStatus.isCollapseMode && finalStatus.stressFactor) {
        md += `- **Factor de Estrés Aplicado:** ×${finalStatus.stressFactor} (${(finalStatus.stressFactor * 3)}% rutas canceladas)\n`;
      }
      md += `- **Algoritmo Utilizado:** ${(finalStatus.algorithm || selectedAlgorithm).toUpperCase()}\n\n`;

      md += `## 📊 Resumen Global de KPIs\n`;
      md += `| Métrica | Valor |\n`;
      md += `| --- | --- |\n`;
      md += `| **SLA Global (Acumulado)** | ${(finalStatus.slaFinal ?? 0).toFixed(2)}% |\n`;
      md += `| **Maletas Atendidas** | ${finalStatus.totalAttended} |\n`;
      md += `| **Maletas Perdidas** | ${finalStatus.totalMissed} |\n`;
      md += `| **Total de Envíos (Demanda)** | ${(finalStatus.totalMissed ?? 0) + (finalStatus.totalAttended ?? 0)} |\n`;
      if (finalStatus.isCollapseMode) {
        md += `| **Vuelos Rescatados** | ${finalStatus.rescuedFlights ?? 0} |\n`;
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
        md += `## 📝 Bitácora de Eventos (Event Log)\n\n`;
        md += '```text\n';
        for (const event of finalStatus.eventLog) {
          md += `${event}\n`;
        }
        md += '```\n\n';
      }

      md += `---\n*Reporte generado de forma confidencial. Propiedad exclusiva de TASF.*`;

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
  }, []);

  /**
   * Inicia simulación de colapso con fecha de inicio opcional.
   */
  const startCollapseSimulation = useCallback(async (dias = 5, startDate = null, stressFactor = 5) => {
    try {
      setSimState("running");
      setAircraft([]);
      setLogs([]);
      realStartRef.current = Date.now();
      setRealElapsedSecs(0);

      setMeta(prev => ({ ...prev, status: "RUNNING", percent: 0, currentDay: 0, errorMessage: null }));
      setKpis({ slaPercent: 0, globalOccupancy: 0, criticalNodes: 0, totalBagsWaiting: 0, rescuedFlights: 0 });
      setAirportLoads({});
      
      const dateParam = startDate ? `&startDate=${startDate}` : "";
      const stressParam = stressFactor ? `&stressFactor=${stressFactor}` : "";
      const res = await apiFetch(
        `/api/v1/simulation/run-collapse/${dias}?algorithm=${selectedAlgorithm}${dateParam}${stressParam}&playbackMinutes=${targetPlaybackMinutes}`,
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
  }, [selectedAlgorithm, targetPlaybackMinutes]);


  /**
   * Conexión WebSocket (STOMP) a /ws
   */
  useEffect(() => {
    if (!sessionId) return

    // Reiniciar secuencia para nueva sesión
    simClockRef.current.lastSeq = -1;

    const client = createStompClient()

    client.onConnect = () => {
      let maxEpochReceived = 0;

      // Unir mensajes por seq (snapshot + kpi comparten seq). Esto evita desalineación temporal.
      const pendingBySeq = new Map();
      const BUFFER_MAX_FRAMES = 240;

      const pushCompleteFrame = (seq) => {
        const f = pendingBySeq.get(seq);
        if (!f) return;

        const hasSnapshot = f.clock !== undefined && f.routes !== undefined;
        const hasKpi = f.kpis !== undefined;
        if (!hasSnapshot || !hasKpi) return;

        snapshotBufferRef.current.push(f);
        snapshotBufferRef.current.sort((a, b) => a.epoch - b.epoch);

        // Limitar memoria: conservar los últimos N frames
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

        // Permitir ligero jitter, descartar frames muy viejos
        if (epoch < maxEpochReceived - 60000) return;
        if (epoch > maxEpochReceived) maxEpochReceived = epoch;

        let f = pendingBySeq.get(seq);
        if (!f) {
          f = { seq, epoch };
          pendingBySeq.set(seq, f);
        }

        // Normalizar epoch si cambia (debe ser el mismo para snapshot/kpi tras el fix BE)
        f.epoch = epoch;

        if (type === 'snapshot') {
          f.clock = data.simulatedTime;
          f.routes = data.activeRoutes || [];
        } else if (type === 'kpi') {
          f.kpis = data;
          f.airportLoads = data.airportLoads || {};
        }

        // Limpieza defensiva de pendientes
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
          const seq = envelope?.seq ?? 0

          if (data.currentEpochTime) {
            const totalSimulatedMs = (meta.totalDays || 5) * 24 * 60 * 60 * 1000;
            const targetPlaybackMs = (targetPlaybackMinutes || 30) * 60 * 1000;
            simClockRef.current.ratio = totalSimulatedMs / targetPlaybackMs;

            upsertBySeq(seq, 'snapshot', data);
          }
        } catch (err) {
          console.error('Error parsing snapshot:', err)
        }
      })

      client.subscribe(`/topic/sim/${sessionId}/kpi`, (msg) => {
        try {
          const envelope = JSON.parse(msg.body)
          const data = envelope?.data ?? {}

          if (data.currentEpochTime) {
            upsertBySeq(envelope?.seq ?? 0, 'kpi', data);

            if (data.status === 'DONE' || data.status === 'FAILED') {
              // dar chance a que llegue el snapshot final del mismo seq
              setTimeout(() => client.deactivate(), 250);
            }
          }
        } catch (err) {
          console.error('Error parsing kpi:', err)
        }
      })

      client.subscribe(`/topic/sim/${sessionId}/eventLog`, (msg) => {
        try {
          const envelope = JSON.parse(msg.body)
          const logEntry = envelope?.data
          if (!logEntry) return
          setLogs(prev => [...prev, logEntry])
        } catch (err) {
          console.error('Error parsing eventLog:', err)
        }
      })
    }

    client.onStompError = (frame) => {
      console.warn('[Tasf.B2B] STOMP error:', frame?.headers?.message, frame?.body)
    }

    client.onWebSocketError = (err) => {
      console.warn('[Tasf.B2B] WS error:', err)
      setMeta(prev => prev.status === 'RUNNING' ? { ...prev, status: 'FAILED', errorMessage: 'Error de conexión con el servidor' } : prev)
    }

    client.onWebSocketClose = (evt) => {
      console.warn('[Tasf.B2B] WS close:', evt)
      setMeta(prev => prev.status === 'RUNNING' ? { ...prev, status: 'FAILED', errorMessage: 'Desconexión del servidor' } : prev)
    }

    client.activate()

    return () => {
      client.deactivate()
    }
  }, [sessionId, selectedAlgorithm, targetPlaybackMinutes])

  const airportByCode = AIRPORT_BY_ICAO

  /**
   * Métricas de aeropuerto: si hay datos live del backend (airportLoads),
   * se construyen desde ahí. Si no, arranca limpio (mapa en gris/verde oscuro, sin saturación).
   */
  const activeMetrics = useMemo(() => {
    if (airportLoads && Object.keys(airportLoads).length > 0) {
      return buildAirportMetrics(AIRPORTS, airportLoads);
    }
    return {};
  }, [airportLoads]);

  /**
   * Top aeropuertos por ocupación — reales si hay datos del backend, estáticos si no.
   * Optimización C: Estabilización de referencia para el Top 8.
   */
  const activeAirportRows = useMemo(() => {
    const base = isCollapseScenario ? COLLAPSE_AIRPORT_ROWS : AIRPORT_ROWS;
    if (!airportLoads || Object.keys(airportLoads).length === 0) {
      return base;
    }
    // 1. Obtener el ranking completo O(M log M)
    const sortedAll = Object.entries(airportLoads)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8);

    // 2. Mapear a la estructura requerida por el componente
    return sortedAll.map(([icao, pct]) => ({
      city: AIRPORT_BY_ICAO[icao]?.city ?? icao,
      capacity: `${pct}%`,
      icao,
    }));
  }, [airportLoads, isCollapseScenario]);

  // Se extrae directamente del snapshot (se actualiza a 2Hz, 0 carga para el CPU)
  const currentEpochTime = clock.currentEpochTime || 0;

  // Lógica de Ventana Móvil: Vuelos en curso o que despegan inminentemente.
  const activeShipments = useMemo(() => {
    if (!aircraft || aircraft.length === 0 || !currentEpochTime) return []
    const viewWindow = 12 * 3600 * 1000 // 12 horas de look-ahead asegurado para cualquier velocidad
    return aircraft
      .filter((r) => r.status !== "cancelled") // BUSINESS RULE: Ocultar cancelados de la lista operativa
      .filter((r) => r.arrivalTime > currentEpochTime && r.departureTime <= currentEpochTime + viewWindow)
      .sort((a, b) => a.departureTime - b.departureTime)
  }, [aircraft, currentEpochTime])

  const activeAircraftAll = useMemo(() => {
    const routes = aircraft?.filter(r => r.status !== "cancelled") ?? [] // BUSINESS RULE: Ocultar cancelados del mapa
    if (routes.length === 0) return []

    const byId = new Map()
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
      }
      const prev = byId.get(next.id)
      if (!prev) {
        byId.set(next.id, next)
        return
      }
      const nextPriority = STATUS_PRIORITY[next.status] ?? 0
      const prevPriority = STATUS_PRIORITY[prev.status] ?? 0
      if (nextPriority > prevPriority) {
        byId.set(next.id, next)
        return
      }
      if (nextPriority === prevPriority && next.capacityPercent > prev.capacityPercent) {
        byId.set(next.id, next)
      }
    })

    return Array.from(byId.values())
  }, [aircraft])

  // ── Optimización A: Ranking de Aviones (Nivel 1: Estático) ───────────────
  const rankedAircraftBase = useMemo(() => {
    if (activeAircraftAll.length === 0) return [];

    // Pre-ordenar por criterios que NO dependen del reloj: prioridad, capacidad y tiempo
    return [...activeAircraftAll].sort((a, b) => {
      const pA = STATUS_PRIORITY[a.status] ?? 0;
      const pB = STATUS_PRIORITY[b.status] ?? 0;
      if (pA !== pB) return pB - pA;
      if (a.capacityPercent !== b.capacityPercent) return b.capacityPercent - a.capacityPercent;
      return a.departureTime - b.departureTime;
    });
  }, [activeAircraftAll]);

  // ── Optimización A: Selección Final (Nivel 2: Dinámico O(N)) ─────────────
  const activeAircraft = useMemo(() => {
    if (rankedAircraftBase.length === 0) return [];
    if (rankedAircraftBase.length <= MAX_MAP_ROUTES && !selectedAircraftId) return rankedAircraftBase;

    const now = smoothSimTime || currentEpochTime;

    // En lugar de sort(), particionamos la lista pre-ordenada en O(N)
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

    // Combinar manteniendo el orden de ranking base: primero los que vuelan, luego tierra
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
    [activeAircraftAll, selectedAircraftId],
  )

  useEffect(() => {
    if (selectedAircraftId && !selectedAircraft) {
      setSelectedAircraftId(null)
    }
  }, [selectedAircraftId, selectedAircraft])

  // selectedFromAirport/selectedToAirport derivadas del vuelo seleccionado
  const selectedFromAirport = selectedAircraft
    ? (AIRPORT_BY_ICAO[selectedAircraft.from] ?? null)
    : null;
  const selectedToAirport = selectedAircraft
    ? (AIRPORT_BY_ICAO[selectedAircraft.to] ?? null)
    : null;

  const selectedAirport = selectedAirportCode
    ? (AIRPORT_BY_ICAO[selectedAirportCode] ?? null)
    : null

  const selectedAirportMetrics = selectedAirport
    ? (activeMetrics[selectedAirport.icao] ?? null)
    : null

  const selectedAirportLevel = selectedAirportMetrics?.level ?? "green"

  // ── Distribución geográfica de carga (independiente del reloj) ──────────
  const transitByContinent = useMemo(() => {
    const routes = aircraft ?? [];
    if (routes.length === 0) return { america: 0, europe: 0, asia: 0 };

    // Clasificar maletas en tránsito por continente segun ICAO del destino
    const americaIcao = ["K", "C", "M", "S", "T"]; // prefijos OACI de América
    const asiaIcao = ["Z", "R", "V", "W", "O", "U", "P"]; // Asia/Ocea
    let america = 0, europe = 0, asia = 0;

    routes.forEach(r => {
      const prefix = (r.to ?? "").charAt(0).toUpperCase();
      if (americaIcao.includes(prefix)) america++;
      else if (asiaIcao.includes(prefix)) asia++;
      else europe++;
    });

    // Escalar por totalBagsWaiting para dar magnitud (estimado)
    const scale = Math.max(1, kpis.totalBagsWaiting ?? routes.length);
    const total = routes.length;

    return {
      america: Math.round((america / total) * scale),
      europe: Math.round((europe / total) * scale),
      asia: Math.round((asia / total) * scale),
    };
  }, [aircraft, kpis.totalBagsWaiting]);

  // ── Distribución geográfica de carga (independiente del reloj) ──────────
  const globalOccupancyCalculated = useMemo(() => {
    const loads = Object.values(airportLoads);
    if (loads.length === 0) return kpis.globalOccupancy ?? 0;
    const sum = loads.reduce((a, b) => a + b, 0);
    return sum / loads.length;
  }, [airportLoads, kpis.globalOccupancy]);

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
          value: aircraft.length ?? 0,
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

  const elapsedOperationTime = summary.realTimeElapsed;

  const kpiCards = useMemo(() => {
    // Si hay datos live del backend, construir KPIs desde ellos
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

    // Estado inicial en cero/limpio
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

  // ── Efectos secundarios ────────────────────────────────────────────────────

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
    handleSelectAircraft,
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
    selectedAircraft,
    selectedAircraftId,
    selectedAirportCode,
    selectedAirport,
    selectedAirportLevel,
    selectedAirportMetrics,
    selectedAlgorithm,
    selectedFromAirport,
    selectedToAirport,
    sessionId,
    isFluidMode,
    setIsFluidMode,
    targetPlaybackMinutes,
    setTargetPlaybackMinutes,
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
    cancelFlight,
  };
};
