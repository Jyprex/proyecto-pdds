import { useState, useMemo } from "react";

// ── Constantes ────────────────────────────────────────────────────────────────
const DAYS_IN_MONTH = [31,28,31,30,31,30,31,31,30,31,30,31];
const MONTHS = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"
];
const YEARS = [2026, 2027, 2028, 2029, 2030, 2031];
const MAX_DIAS = 10;
const DIAS_SIMULACION = 5;   // Siempre 5 días — valor académico fijo
const CAPACIDAD_AVIONES_DIA = 946_000;

function pad(n) { return String(n).padStart(2, "0"); }
function fmt(n)  { return n == null ? "—" : Number(n).toLocaleString("es-PE"); }
function fmtPct(n) { return n == null ? "—" : Number(n).toFixed(1) + "%"; }

// ── Componente principal ──────────────────────────────────────────────────────
function PeriodSimConfig({
  isOpen,
  onClose,
  selectedAlgorithm,
  onStart,           // (dias: number, startDate: string) => void
  liveStatus,
  simState,
  sessionId,
  onExportExcel,
  onExportMd,
  onExportDetails,
  onReset,           // () => void — reinicia simState a idle
}) {
  // ── Todos los hooks PRIMERO ───────────────────────────────────────────────
  const [day,        setDay]        = useState(1);
  const [month,      setMonth]      = useState(1);
  const [year,       setYear]       = useState(2026);
  const [startTime,  setStartTime]  = useState("00:00");
  const [isStarting, setIsStarting] = useState(false);
  const [preCancelledFlights] = useState([]);

  const PLAYBACK_OPTIONS = [
    { label: "Balanceado", value: 15, sub: "15 min" },
    { label: "Análisis", value: 30, sub: "30 min" },
    { label: "Detallado", value: 60, sub: "60 min" },
  ];

  const daysInSel = month === 2 && year % 4 === 0 ? 29 : DAYS_IN_MONTH[month - 1];
  const startDate = `${year}-${pad(month)}-${pad(day)}`;

  // Fecha fin — usar constructor local (no string) para evitar offset UTC
  const endDateStr = (() => {
    const d = new Date(year, month - 1, day); // local, sin UTC
    d.setDate(d.getDate() + DIAS_SIMULACION - 1);
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  })();

  // Fase actual
  const phase = (simState === "running" || liveStatus?.status === "RUNNING") ? "running"
              : (simState === "completed" || liveStatus?.status === "DONE")   ? "report"
              : "config";

  // Métricas del reporte final
  const reportMetrics = useMemo(() => {
    if (phase !== "report" || !liveStatus) return null;

    const reports = liveStatus.reports ?? [];
    if (reports.length === 0) {
      const totalDemanda  = (liveStatus.totalAttended ?? 0) + (liveStatus.totalMissed ?? 0);
      const atendidas     = liveStatus.totalAttended ?? 0;
      const ecap          = liveStatus.totalMissed ?? 0;
      const diasCount     = liveStatus.totalDays ?? 1;
      const avgAtendidas  = atendidas / diasCount;
      const ocupacion     = (avgAtendidas / CAPACIDAD_AVIONES_DIA) * 100;
      const cumplimiento  = totalDemanda > 0 ? (atendidas / totalDemanda) * 100 : 0;
      const saturacion    = liveStatus.globalOccupancy ?? 0;
      const score = 10 * (atendidas > 0 ? diasCount : 0) - 0.005 * ecap - 2 * 0 - 12 * saturacion;
      return { totalDemanda, atendidas, ecap, diasCount,
               avgDemanda: totalDemanda/diasCount, avgAtendidas, avgEcap: ecap/diasCount,
               ocupacion, cumplimiento, saturacion, score, byDay: [] };
    }

    const totalDemanda  = reports.reduce((s,r) => s + (r.totalMaletas ?? 0), 0);
    const atendidas     = reports.reduce((s,r) => s + (r.malatetasAtendidas ?? 0), 0);
    const ecap          = totalDemanda - atendidas;
    const diasCount     = reports.length;
    const avgAtendidas  = atendidas / diasCount;
    const ocupacion     = (avgAtendidas / CAPACIDAD_AVIONES_DIA) * 100;
    const cumplimiento  = totalDemanda > 0 ? (atendidas / totalDemanda) * 100 : 0;
    const satSum        = reports.reduce((s,r) => s + (r.airportSaturation ?? 0), 0);
    const saturacion    = satSum / diasCount;
    const lotsA         = reports.filter(r => (r.malatetasAtendidas ?? 0) > 0).length;
    const score         = 10 * lotsA - 0.005 * ecap - 2 * 0 - 12 * saturacion;
    const byDay         = reports.map((r, i) => ({
      dia: i + 1, demanda: r.totalMaletas ?? 0,
      atendidas: r.malatetasAtendidas ?? 0,
      ecap: (r.totalMaletas ?? 0) - (r.malatetasAtendidas ?? 0),
      sla: r.slaPercent ?? 0, colapsed: r.colapsed ?? false,
    }));
    return { totalDemanda, atendidas, ecap, diasCount,
             avgDemanda: totalDemanda/diasCount, avgAtendidas, avgEcap: ecap/diasCount,
             ocupacion, cumplimiento, saturacion, score, byDay, lotsA };
  }, [liveStatus, phase]);

  // ── Early return DESPUÉS de todos los hooks ───────────────────────────────
  if (!isOpen) return null;

  const handleStart = async () => {
    if (!onStart) return;
    setIsStarting(true);
    try {
      await onStart(DIAS_SIMULACION, startDate, preCancelledFlights, startTime);
    } catch (e) {
      // Antes el botón quedaba bloqueado en "iniciando" si onStart fallaba.
      console.error('[PeriodSim] Error al iniciar simulación:', e);
    } finally {
      setIsStarting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <aside className="ct-scenario-config ct-scenario-config--periodo" aria-label="Configuración simulación de periodo">

      {/* Header */}
      <div className="ct-scenario-config__header ct-scenario-config__header--periodo">
        <div>
          <p className="ct-scenario-config__label">ESCENARIO ACTIVO</p>
          <h3 className="ct-scenario-config__title">Simulación de Periodo</h3>
        </div>
          <button type="button" className="ct-scenario-config__close" onClick={onClose}>✕</button>
      </div>

      <div className="ct-scenario-config__body">

        {/* ════════════════════════════════════════════════════════════
            FASE CONFIG — antes de iniciar
        ════════════════════════════════════════════════════════════ */}
        {phase === "config" && (
          <>
            {/* Selector de fecha inicio */}
            <div className="ct-config-section">
              <p className="ct-config-section__title">📅 FECHA DE INICIO</p>
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                {/* Día */}
                <select
                  id="period-day"
                  className="ct-config-form__select"
                  style={{ flex: 1 }}
                  value={day}
                  onChange={e => setDay(Number(e.target.value))}
                >
                  {Array.from({ length: daysInSel }, (_, i) => i + 1).map(d => (
                    <option key={d} value={d}>{pad(d)}</option>
                  ))}
                </select>
                {/* Mes */}
                <select
                  id="period-month"
                  className="ct-config-form__select"
                  style={{ flex: 2 }}
                  value={month}
                  onChange={e => {
                    const newMonth = Number(e.target.value);
                    setMonth(newMonth);
                    const newDaysInSel = newMonth === 2 && year % 4 === 0 ? 29 : DAYS_IN_MONTH[newMonth - 1];
                    if (day > newDaysInSel) setDay(newDaysInSel);
                  }}
                >
                  {MONTHS.map((m, i) => (
                    <option key={i+1} value={i+1}>{m}</option>
                  ))}
                </select>
                {/* Año */}
                <select
                  id="period-year"
                  className="ct-config-form__select"
                  style={{ flex: 1 }}
                  value={year}
                  onChange={e => {
                    const newYear = Number(e.target.value);
                    setYear(newYear);
                    const newDaysInSel = month === 2 && newYear % 4 === 0 ? 29 : DAYS_IN_MONTH[month - 1];
                    if (day > newDaysInSel) setDay(newDaysInSel);
                  }}
                >
                  {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <p style={{ fontSize: 11, color: "#64748b", marginTop: 6, textAlign: "center" }}>
                Del <strong style={{ color: "#818cf8" }}>{startDate}</strong>
                {" "}al <strong style={{ color: "#818cf8" }}>{endDateStr}</strong>
                {" · "}<span style={{ color: "#475569" }}>5 días</span>
              </p>
            </div>

{/* Hora de inicio */}
            <div className="ct-config-section">
              <p className="ct-config-section__title">🕒 HORA DE INICIO</p>
              <div style={{ marginTop: 8 }}>
                <input
                  type="time"
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    padding: '8px 10px', borderRadius: 7,
                    background: '#f8fafc', border: '1px solid rgba(79,70,229,0.45)',
                    color: '#1e293b', fontSize: 14, fontWeight: 600,
                    colorScheme: 'light',
                  }}
                />
              </div>
            </div>

            {/* Playback fijo en 30 min — sin controles visibles para el usuario */}

            {/* Botón iniciar */}
            <div style={{ paddingBottom: 8 }}>
              <button
                id="period-btn-start"
                type="button"
                onClick={handleStart}
                disabled={isStarting}
                style={{
                  width: "100%", padding: "11px 0", borderRadius: 8, border: "none",
                  background: isStarting
                    ? "rgba(5,150,105,0.4)"
                    : "linear-gradient(135deg, #059669, #047857)",
                  color: "white", fontWeight: 700, fontSize: 12, cursor: isStarting ? "default" : "pointer",
                  letterSpacing: 0.8, boxShadow: "0 4px 16px rgba(5,150,105,0.32)",
                  transition: "transform 0.15s, box-shadow 0.15s",
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
                onMouseEnter={e => !isStarting && (e.currentTarget.style.transform = "translateY(-1px)")}
                onMouseLeave={e => (e.currentTarget.style.transform = "translateY(0)")}
              >
                {isStarting ? "⏳ Iniciando..." : "▶ EJECUTAR SIMULACIÓN — 5 DÍAS"}
              </button>
              {!onStart && (
                <p style={{ fontSize: 11, color: "#f59e0b", marginTop: 6, textAlign: "center" }}>
                  ⚠ Backend no disponible — modo demo visual
                </p>
              )}
            </div>
          </>
        )}

        {/* ════════════════════════════════════════════════════════════
            FASE RUNNING — simulación en curso
        ════════════════════════════════════════════════════════════ */}
        {phase === "running" && (
          <>
            <div className="ct-config-section">
              <p className="ct-config-section__title">⏳ PROGRESO</p>
              <div style={{ margin: "10px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6, color: "#cbd5e1" }}>
                  <span>Día {liveStatus?.currentDay ?? 0} / {liveStatus?.totalDays ?? DIAS_SIMULACION}</span>
                  <span style={{ color: "#38bdf8", fontWeight: 700 }}>{liveStatus?.percent ?? 0}%</span>
                </div>
                <div
                  style={{ height: 8, background: "rgba(255,255,255,0.08)", borderRadius: 4 }}
                  role="progressbar"
                  aria-valuenow={Math.round(liveStatus?.percent ?? 0)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Progreso de la simulación por periodo"
                >
                  <div style={{
                    height: "100%", borderRadius: 4,
                    width: `${liveStatus?.percent ?? 0}%`,
                    background: "linear-gradient(90deg, #38bdf8, #34d399)",
                    transition: "width 0.5s ease",
                  }} />
                </div>
              </div>
            </div>

            <div className="ct-config-section">
              <p className="ct-config-section__title">📊 MÉTRICAS EN TIEMPO REAL</p>
              <div className="ct-progress-detail">
                {[
                  ["SLA cumplido",     `${liveStatus?.slaPercent?.toFixed(1) ?? 0}%`],
                  ["Ocupación global", `${liveStatus?.globalOccupancy?.toFixed(1) ?? 0}%`],
                  ["Nodos críticos",   liveStatus?.criticalNodes ?? 0],
                  ["Vuelos activos",   liveStatus?.activeRoutes?.length ?? 0],
                  ["Salto Algoritmo (Sa)", `${liveStatus?.saMinutes ?? 10} min`],
                  ["Latencia ALNS (Ta)", `${liveStatus?.taMs ?? 0} ms`],
                ].map(([label, val]) => (
                  <div key={label} className="ct-progress-detail__item">
                    <span>{label}</span><strong>{val}</strong>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ════ FASE REPORT ════ */}
        {phase === "report" && reportMetrics && (
          <>
            {/* Encabezado */}
            <div style={{
              background: "linear-gradient(135deg, rgba(5,150,105,0.15), rgba(4,120,87,0.1))",
              border: "1px solid rgba(52,211,153,0.35)", borderRadius: 10,
              padding: "12px 14px", marginBottom: 12,
            }}>
              <p style={{ color: "#34d399", fontWeight: 700, fontSize: 13, margin: 0 }}>
                ✅ SIMULACIÓN COMPLETADA
              </p>
              <p style={{ fontSize: 11, color: "#94a3b8", margin: "4px 0 0" }}>
                Algoritmo: <strong style={{ color: "#60a5fa" }}>{selectedAlgorithm?.toUpperCase()}</strong>
                {" · "}{reportMetrics.diasCount} días · {startDate}
              </p>
            </div>



            {/* Acciones */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
              {onExportExcel && (
                <button id="period-btn-export" type="button"
                  onClick={() => onExportExcel(sessionId, selectedAlgorithm?.toUpperCase() ?? "ALNS")}
                  style={{
                    padding: "11px 0", borderRadius: 8, border: "none",
                    background: "linear-gradient(135deg, #059669, #047857)",
                    color: "white", fontWeight: 700, fontSize: 13, cursor: "pointer",
                    boxShadow: "0 4px 15px rgba(5,150,105,0.35)",
                  }}
                >
                  📊 Exportar a Excel
                </button>
              )}
              {onExportMd && (
                <button id="period-btn-export-md" type="button"
                  onClick={() => onExportMd(sessionId, `Periodo_${selectedAlgorithm?.toUpperCase() ?? "ALNS"}`)}
                  style={{
                    padding: "11px 0", borderRadius: 8, border: "none",
                    background: "linear-gradient(135deg, #4f46e5, #4338ca)",
                    color: "white", fontWeight: 700, fontSize: 13, cursor: "pointer",
                    boxShadow: "0 4px 15px rgba(79, 70, 229, 0.35)",
                  }}
                >
                  📋 Exportar Última Planificación (.md)
                </button>
              )}
              {onExportDetails && (
                <button id="period-btn-export-details" type="button"
                  onClick={() => onExportDetails(sessionId)}
                  style={{
                    padding: "11px 0", borderRadius: 8, border: "none",
                    background: "linear-gradient(135deg, #0f172a, #1e293b)",
                    color: "white", fontWeight: 700, fontSize: 13, cursor: "pointer",
                    boxShadow: "0 4px 15px rgba(15, 23, 42, 0.35)",
                  }}
                >
                  ✈️ Reporte Detallado de Vuelos
                </button>
              )}
              <button id="period-btn-new" type="button"
                onClick={() => {
                  if (onReset) onReset();
                }}
                style={{
                  padding: "10px 0", borderRadius: 8,
                  border: "1px solid rgba(10,60,110,0.2)",
                  background: "transparent", color: "#3a5a78",
                  fontWeight: 600, fontSize: 12, cursor: "pointer",
                }}
              >
                ↩ Nueva simulación
              </button>
            </div>
          </>
        )}

      </div>
    </aside>
  );
}

// ── Sub-componentes ───────────────────────────────────────────────────────────
function RSection({ title, children }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "10px 12px", marginBottom: 10,
                  border: "1px solid rgba(255,255,255,0.08)" }}>
      <p style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", margin: "0 0 8px", letterSpacing: 1 }}>{title}</p>
      {children}
    </div>
  );
}

function MRow({ label, value, color }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
      <span style={{ fontSize: 11, color: "#cbd5e1" }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: color ?? "#f8fafc" }}>{value}</span>
    </div>
  );
}

export default PeriodSimConfig;
