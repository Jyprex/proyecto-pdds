import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Client } from '@stomp/stompjs';
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
};

const KPI_COLLAPSED_STORAGE_KEY = "ct-kpi-collapsed";
const POLL_INTERVAL_MS = 1000;

const readStoredKpiCollapsed = () => {
  if (typeof window === "undefined") return false;
  const stored = window.localStorage.getItem(KPI_COLLAPSED_STORAGE_KEY);
  return stored ? stored === "true" : false;
};

export const useControlTowerController = () => {
  const [activeTab, setActiveTab] = useState("vivo");
  const [panelVisibility, setPanelVisibility] = useState(PANEL_VISIBILITY_DEFAULT);
  const [isKpiCollapsed, setIsKpiCollapsed] = useState(readStoredKpiCollapsed);
  const [selectedAircraftId, setSelectedAircraftId] = useState(1);
  const [selectedAirportCode, setSelectedAirportCode] = useState(null);
  const [isAirportDetailOpen, setIsAirportDetailOpen] = useState(false);
  const [isDockCollapsed, setIsDockCollapsed] = useState(false);
  const [isScenarioConfigOpen, setIsScenarioConfigOpen] = useState(false);
  const [selectedAlgorithm, setSelectedAlgorithm] = useState("hga");
  const [simState, setSimState] = useState("idle");
  const [simSpeed, setSimSpeed] = useState(1);

  const [sessionId, setSessionId] = useState(null);
  const [isFluidMode, setIsFluidMode] = useState(false);

  /** Métricas vivas recibidas del backend via polling */
  const [liveStatus, setLiveStatus] = useState(null);

  /** Reloj de simulación interpolado a 60 FPS */
  const [simClockEpoch, setSimClockEpoch] = useState(0);
  const simClockRef = useRef({ serverEpoch: 0, receivedAt: 0 });

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

  /**
   * Reinicia la simulación a estado idle.
   * Usado por el botón "Nueva simulación" en los paneles de config.
   */
  const resetSimulation = useCallback(() => {
    setSimState("idle");
    setSessionId(null);
    setLiveStatus(null);
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
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
      setLiveStatus(null);

      const playbackMin = isFluidMode ? 60 : 1;
      const res = await fetch(`/api/v1/simulation/run/${dias}?algorithm=${selectedAlgorithm}&playbackMinutes=${playbackMin}`, {
        method: "POST",
      });

      if (!res.ok) throw new Error(`Backend respondió ${res.status}`);

      const data = await res.json();
      setSessionId(data.sessionId);
    } catch (err) {
      console.error("[Tasf.B2B] Error al iniciar simulación:", err);
      setSimState("idle");
    }
  }, [selectedAlgorithm]);

  /**
   * Inicia simulación Día a Día con fecha de inicio y número de días específicos.
   * Este es el punto de entrada del escenario "Operación Día a Día".
   * Pasa startDate al backend para el epoch parametrizable.
   */
  const startDayToDaySimulation = useCallback(async (startDate, dias = 5) => {
    try {
      setSimState("running");
      setLiveStatus(null);

      const playbackMin = isFluidMode ? 60 : 1;
      const url = `/api/v1/simulation/run/${dias}?algorithm=${selectedAlgorithm}&startDate=${startDate}&playbackMinutes=${playbackMin}`;
      const res = await fetch(url, { method: "POST" });

      if (!res.ok) throw new Error(`Backend respondió ${res.status}`);

      const data = await res.json();
      setSessionId(data.sessionId);
      console.info(`[Tasf.B2B] Simulación día a día iniciada: ${startDate} × ${dias} días | ${selectedAlgorithm.toUpperCase()}`);
    } catch (err) {
      console.error("[Tasf.B2B] Error al iniciar simulación día a día:", err);
      setSimState("idle");
    }
  }, [selectedAlgorithm]);

  /**
   * Descarga el Excel de resultados de la simulación completada.
   * Llama a POST /api/v1/simulation/export-excel/{sessionId}
   */
  const exportSimulationExcel = useCallback(async (sid, algorithm = "ALNS") => {
    if (!sid) return;
    try {
      const res = await fetch(
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
   * Inicia simulación de colapso con fecha de inicio opcional.
   * @param {number} dias - Días a simular (default 5)
   * @param {string} startDate - Fecha inicio YYYY-MM-DD (opcional)
   */
  const startCollapseSimulation = useCallback(async (dias = 5, startDate = null, stressFactor = 5) => {
    try {
      setSimState("running");
      setLiveStatus(null);

      const playbackMin = isFluidMode ? 60 : 1;
      const dateParam   = startDate    ? `&startDate=${startDate}`       : "";
      const stressParam = stressFactor ? `&stressFactor=${stressFactor}` : "";
      const res = await fetch(
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
  }, [selectedAlgorithm]);


  /**
   * Conexión WebSocket / STOMP
   */
  useEffect(() => {
    if (!sessionId) return;

    const client = new Client({
      brokerURL: 'ws://localhost:8080/ws/websocket', // Usando endpoint websocket nativo de SockJS
      reconnectDelay: 5000,
      heartbeatIncoming: 4000,
      heartbeatOutgoing: 4000,
    });

    client.onConnect = () => {
      console.info('[Tasf.B2B] STOMP conectado al backend.');

      client.subscribe(`/topic/sim/${sessionId}/snapshot`, (msg) => {
        try {
          const envelope = JSON.parse(msg.body);
          const data = envelope?.data ?? {};
          if (data.currentEpochTime) {
            simClockRef.current = {
              serverEpoch: data.currentEpochTime,
              receivedAt: Date.now(),
            };
          }
          setLiveStatus((prev) => ({
            ...prev,
            status: data.status,
            simulatedTime: data.simulatedTime,
            currentEpochTime: data.currentEpochTime,
            activeRoutes: data.activeRoutes,
          }));
        } catch (err) {
          console.error('Error parsing snapshot:', err);
        }
      });

      client.subscribe(`/topic/sim/${sessionId}/kpi`, async (msg) => {
        try {
          const envelope = JSON.parse(msg.body);
          const data = envelope?.data ?? {};

          setLiveStatus((prev) => ({
            ...prev,
            status: data.status,
            percent: data.percent,
            currentDay: data.currentDay,
            totalDays: data.totalDays,
            slaPercent: data.slaPercent,
            globalOccupancy: data.globalOccupancy,
            criticalNodes: data.criticalNodes,
            airportLoads: data.airportLoads || prev?.airportLoads,
            totalBagsWaiting: data.totalBagsWaiting,
            isCollapseMode: data.isCollapseMode,
            rescuedFlights: data.rescuedFlights,
            errorMessage: data.errorMessage,
            comparisonResults: data.comparisonResults || prev?.comparisonResults,
          }));

          if (data.status === 'DONE') {
            setSimState('completed');
            try {
              const finalRes = await fetch(`/api/v1/simulation/status/${sessionId}`);
              if (finalRes.ok) {
                const finalStatus = await finalRes.json();
                setLiveStatus((prev) => ({ ...prev, ...finalStatus }));
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
        } catch (err) {
          console.error('Error parsing kpi:', err);
        }
      });

      client.subscribe(`/topic/sim/${sessionId}/eventLog`, (msg) => {
        try {
          const envelope = JSON.parse(msg.body);
          const logEntry = envelope?.data;
          if (!logEntry) return;
          setLiveStatus((prev) => {
            const currentLog = prev?.eventLog || [];
            return {
              ...prev,
              eventLog: [...currentLog, logEntry],
            };
          });
        } catch (err) {
          console.error('Error parsing eventLog:', err);
        }
      });
    };

    client.onStompError = (frame) => {
      console.warn('[Tasf.B2B] STOMP error:', frame?.headers?.message, frame?.body);
    };

    client.activate();

    return () => {
      client.deactivate();
    };
  }, [sessionId]);

  // Interpolar clock para animacion suave a 60 FPS
  useEffect(() => {
    let rafId;
    let isActive = true;

    const tick = () => {
      if (!isActive) return;
      const { serverEpoch, receivedAt } = simClockRef.current;
      if (serverEpoch && receivedAt) {
        const elapsed = Date.now() - receivedAt;
        const simNow = serverEpoch + elapsed;
        setSimClockEpoch(simNow);
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      isActive = false;
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  const airportByCode = AIRPORT_BY_ICAO;

  /**
   * Métricas de aeropuerto: si hay datos live del backend (airportLoads),
   * se construyen desde ahí. Si no, arranca limpio (mapa en gris/verde oscuro, sin saturación).
   */
  const activeMetrics = useMemo(() => {
    if (liveStatus?.airportLoads && Object.keys(liveStatus.airportLoads).length > 0) {
      return buildAirportMetrics(AIRPORTS, liveStatus.airportLoads);
    }
    return {};
  }, [liveStatus]);

  /**
   * Top aeropuertos por ocupación — reales si hay datos del backend, estáticos si no.
   */
  const activeAirportRows = useMemo(() => {
    const base = isCollapseScenario ? COLLAPSE_AIRPORT_ROWS : AIRPORT_ROWS;
    if (!liveStatus?.airportLoads || Object.keys(liveStatus.airportLoads).length === 0) {
      return base;
    }
    // Construir desde airportLoads reales: ordenar por ocupación desc y tomar top 8
    return Object.entries(liveStatus.airportLoads)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([icao, pct]) => ({
        city: AIRPORT_BY_ICAO[icao]?.city ?? icao,
        capacity: `${pct}%`,
        icao,
      }));
  }, [liveStatus, isCollapseScenario]);

  const currentEpochTime = simClockEpoch || liveStatus?.currentEpochTime || 0;

  const activeShipments = useMemo(() => {
    if (!liveStatus?.activeRoutes || !currentEpochTime) return [];
    const oneDayMs = 24 * 3600 * 1000;
    return liveStatus.activeRoutes.filter(r => 
      r.departureTime >= currentEpochTime && r.departureTime <= currentEpochTime + oneDayMs
    ).sort((a, b) => a.departureTime - b.departureTime);
  }, [liveStatus?.activeRoutes, currentEpochTime]);

  const computeLocalProgress = (route, simNow) => {
    const dep = route?.departureTime ?? 0;
    const arr = route?.arrivalTime ?? 0;
    if (!dep || !arr || arr <= dep) return route?.progress ?? 0;
    const p = (simNow - dep) / (arr - dep);
    if (p < 0) return 0;
    if (p > 1) return 1;
    return p;
  };

  /**
   * Aviones en el mapa con filtro hop-a-hop
   */
  const activeAircraft = useMemo(() => {
    const routes = activeShipments.length > 0 
      ? activeShipments 
      : (liveStatus?.activeRoutes ?? []);
    if (routes.length === 0) return [];

    return routes
      .map((r) => {
        const progress = computeLocalProgress(r, currentEpochTime);
        return {
          id: r.id,
          from: r.from,
          to: r.to,
          progress,
          status: r.status ?? "normal",
          departureTime: r.departureTime,
        };
      })
      .filter((r) => r.progress >= 0 && r.progress < 1)
      .slice(0, 220); // Límite seguro
  }, [activeShipments, liveStatus?.activeRoutes, currentEpochTime]);

  const selectedAircraft = useMemo(
    () => activeAircraft.find((p) => p.id === selectedAircraftId) ?? null,
    [activeAircraft, selectedAircraftId],
  );

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

  // ── KPI cards y Telemetría: reales si hay liveStatus, fallback limpio si no ──

  const summary = useMemo(() => {
    if (liveStatus && sessionId) {
      return {
        scenarioLabel: "Simulación en vivo",
        operationStart: "Día 1",
        systemClock: liveStatus.simulatedTime ?? `Día ${liveStatus.currentDay}`,
        globalCapacity: `${liveStatus.globalOccupancy?.toFixed(1) ?? 0}%`,
        networkLatency: "OK",
        flightsInCourse: {
          value: liveStatus.activeRoutes?.length ?? 0,
          delta: "datos reales",
          status: "green"
        },
        storageOccupancy: {
          value: Math.round(liveStatus.globalOccupancy ?? 0),
          subtitle: "Promedio red",
          status: (liveStatus.globalOccupancy >= 90) ? "red" : "green"
        },
        sla: {
          value: liveStatus.slaPercent?.toFixed(1) ?? 0,
          subtitle: "Real",
          status: (liveStatus.slaPercent >= 90) ? "green" : "red"
        },
        criticalNodes: {
          value: liveStatus.criticalNodes ?? 0,
          subtitle: ">90% ocupación",
          status: (liveStatus.criticalNodes > 5) ? "red" : "green"
        },
        progress: {
          label: liveStatus.status === "DONE" ? "Completado" : "Ejecutando",
          percent: liveStatus.percent ?? 0,
          simulatedTime: liveStatus.simulatedTime ?? `Día ${liveStatus.currentDay}`,
          status: liveStatus.status === "DONE" ? "green" : "amber"
        },
        transitByContinent: (() => {
          const routes = liveStatus.activeRoutes ?? [];
          // Clasificar maletas en tránsito por continente segun ICAO del destino
          const americaIcao = ["K","C","M","S","T"]; // prefijos OACI de América
          const asiaIcao   = ["Z","R","V","W","O","U","P"]; // Asia/Ocea
          let america = 0, europe = 0, asia = 0;
          routes.forEach(r => {
            const prefix = (r.to ?? "").charAt(0).toUpperCase();
            if (americaIcao.includes(prefix)) america++;
            else if (asiaIcao.includes(prefix)) asia++;
            else europe++;
          });
          // Escalar por totalBagsWaiting para dar magnitud (estimado)
          const scale = Math.max(1, liveStatus.totalBagsWaiting ?? routes.length);
          const total = routes.length || 1;
          return {
            america: Math.round((america / total) * scale),
            europe:  Math.round((europe  / total) * scale),
            asia:    Math.round((asia    / total) * scale),
          };
        })(),
      };
    }

    return {
      scenarioLabel: "Esperando simulación...",
      operationStart: "--:--",
      systemClock: "--:--",
      globalCapacity: "0%",
      networkLatency: "--",
      flightsInCourse: { value: 0, delta: "--", status: "green" },
      storageOccupancy: { value: 0, subtitle: "--", status: "green" },
      sla: { value: 0, subtitle: "--", status: "green" },
      criticalNodes: { value: 0, subtitle: "--", status: "green" },
      progress: { label: "Listo", percent: 0, simulatedTime: "00:00:00", status: "amber" },
      transitByContinent: { america: 0, europe: 0, asia: 0 },
    };
  }, [liveStatus, sessionId]);

  const elapsedOperationTime = summary.progress.simulatedTime;

  const kpiCards = useMemo(() => {
    // Si hay datos live del backend, construir KPIs desde ellos
    if (liveStatus && sessionId) {
      const progressPercent = liveStatus.percent ?? 0;
      const dayLabel = liveStatus.totalDays
        ? `Día ${liveStatus.currentDay} / ${liveStatus.totalDays}`
        : "Iniciando...";

      return [
        {
          key: "flights",
          title: "Vuelos en curso",
          value: liveStatus.activeRoutes?.length ?? 0,
          subtitle: `Día ${liveStatus.currentDay} de simulación`,
          status: "green",
        },
        {
          key: "occupancy",
          title: "Ocupación global almacenes",
          value: `${liveStatus.globalOccupancy?.toFixed(1) ?? 0}%`,
          subtitle: "Promedio red · datos reales",
          status: liveStatus.globalOccupancy >= 90 ? "red"
                : liveStatus.globalOccupancy >= 70 ? "amber" : "green",
        },
        {
          key: "sla",
          title: "Entregas a tiempo (SLA)",
          value: `${liveStatus.slaPercent?.toFixed(1) ?? 0}%`,
          subtitle: "Maletas atendidas / demanda total",
          status: liveStatus.slaPercent >= 90 ? "green"
                : liveStatus.slaPercent >= 70 ? "amber" : "red",
        },
        {
          key: "critical",
          title: "Nodos críticos",
          value: liveStatus.criticalNodes ?? 0,
          subtitle: "Almacenes con ocupación > 90%",
          status: liveStatus.criticalNodes > 5 ? "red"
                : liveStatus.criticalNodes > 2 ? "amber" : "green",
        },
        {
          key: "progress",
          title: "Progreso simulación",
          value: `${dayLabel} · ${progressPercent}%`,
          subtitle: liveStatus.status === "DONE" ? "✓ Completado" : "En ejecución...",
          status: liveStatus.status === "FAILED" ? "red"
                : liveStatus.status === "DONE" ? "green" : "amber",
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
  }, [isCollapseScenario, liveStatus, sessionId]);

  const comparisonData = useMemo(() => {
    if (liveStatus?.comparisonResults) {
      // Intentar leer la llave en mayúscula o minúscula para mayor robustez
      const hgaResult = liveStatus.comparisonResults.hga || liveStatus.comparisonResults.HGA;
      const alnsResult = liveStatus.comparisonResults.alns || liveStatus.comparisonResults.ALNS;

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
  }, [liveStatus]);

  const eventLog = liveStatus?.eventLog ?? [];
  const totalBagsWaiting = liveStatus?.totalBagsWaiting ?? 0;

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
    setSimSpeed,
    setSimState,
    showAirportDetail,
  };
};






