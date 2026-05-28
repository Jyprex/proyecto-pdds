import { useState, useMemo } from "react";

// ── Constantes ────────────────────────────────────────────────────────────────
const DAYS_IN_MONTH = [31,28,31,30,31,30,31,31,30,31,30,31];
const MONTHS = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"
];
const YEARS = [2026, 2027, 2028, 2029];
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
  onAlgorithmChange,
  onStart,           // (dias: number, startDate: string) => void
  liveStatus,
  sessionId,
  simState,
  onExportExcel,
  onExportMd,
  onReset,           // () => void — reinicia simState a idle
}) {
  // ── Todos los hooks PRIMERO ───────────────────────────────────────────────
  const [day,        setDay]        = useState(1);
  const [month,      setMonth]      = useState(1);
  const [year,       setYear]       = useState(2026);
  const [isStarting, setIsStarting] = useState(false);

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
    await onStart(DIAS_SIMULACION, startDate);
    setIsStarting(false);
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
                  onChange={e => { setMonth(Number(e.target.value)); setDay(1); }}
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
                  onChange={e => setYear(Number(e.target.value))}
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

            {/* Número de días — fijo en 5 */}
            <div className="ct-config-section">
              <p className="ct-config-section__title">🗓 PERÍODO DE SIMULACIÓN</p>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                gap: 12, marginTop: 8,
                background: "rgba(99,102,241,0.08)", borderRadius: 8, padding: "12px",
              }}>
                <span style={{ fontSize: 32, fontWeight: 800, color: "#818cf8" }}>5</span>
                <div>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>días</p>
                  <p style={{ margin: 0, fontSize: 10, color: "#475569" }}>valor académico fijo</p>
                </div>
              </div>
            </div>

            {/* Selector de algoritmo */}
            <div className="ct-config-section">
              <p className="ct-config-section__title">⚡ ALGORITMO</p>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                {[
                  { val: "alns", icon: "⚡", name: "ALNS", sub: "Adaptive Large Neighborhood" },
                  { val: "hga",  icon: "🧬", name: "HGA",  sub: "Hybrid Genetic Algorithm" },
                ].map(opt => (
                  <button key={opt.val} id={`period-algo-${opt.val}`} type="button"
                    onClick={() => onAlgorithmChange(opt.val)}
                    style={{
                      flex: 1, padding: "10px 0", borderRadius: 8, border: "none",
                      fontWeight: 700, fontSize: 13, cursor: "pointer",
                      transition: "all 0.2s",
                      background: selectedAlgorithm === opt.val
                        ? "linear-gradient(135deg, #4f46e5, #7c3aed)"
                        : "rgba(255,255,255,0.06)",
                      color: selectedAlgorithm === opt.val ? "#fff" : "#94a3b8",
                      boxShadow: selectedAlgorithm === opt.val ? "0 4px 15px rgba(79,70,229,0.4)" : "none",
                    }}
                  >
                    {opt.icon} {opt.name}
                    <span style={{ display: "block", fontSize: 9, fontWeight: 400, opacity: 0.75, marginTop: 2 }}>
                      {opt.sub}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Botón iniciar */}
            <div style={{ paddingBottom: 8 }}>
              <button
                id="period-btn-start"
                type="button"
                onClick={handleStart}
                disabled={isStarting}
                style={{
                  width: "100%", padding: "14px 0", borderRadius: 10, border: "none",
                  background: isStarting
                    ? "rgba(16,185,129,0.4)"
                    : "linear-gradient(135deg, #10b981, #059669)",
                  color: "white", fontWeight: 700, fontSize: 15, cursor: isStarting ? "default" : "pointer",
                  letterSpacing: 1, boxShadow: "0 4px 20px rgba(16,185,129,0.35)",
                  transition: "transform 0.15s",
                }}
                onMouseEnter={e => !isStarting && (e.currentTarget.style.transform = "translateY(-2px)")}
                onMouseLeave={e => (e.currentTarget.style.transform = "translateY(0)")}
              >
                {isStarting ? "⏳ Iniciando..." : `▶ EJECUTAR SIMULACIÓN — 5 DÍAS`}
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
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6, color: "#1a3a5a" }}>
                  <span>Día {liveStatus?.currentDay ?? 0} / {liveStatus?.totalDays ?? DIAS_SIMULACION}</span>
                  <span style={{ color: "#1a70c0", fontWeight: 700 }}>{liveStatus?.percent ?? 0}%</span>
                </div>
                <div style={{ height: 8, background: "rgba(10,60,110,0.1)", borderRadius: 4 }}>
                  <div style={{
                    height: "100%", borderRadius: 4,
                    width: `${liveStatus?.percent ?? 0}%`,
                    background: "linear-gradient(90deg, #1a70c0, #0ca36e)",
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
              background: "linear-gradient(135deg, rgba(5,150,105,0.08), rgba(4,120,87,0.05))",
              border: "1px solid rgba(5,150,105,0.35)", borderRadius: 10,
              padding: "12px 14px", marginBottom: 12,
            }}>
              <p style={{ color: "#065f46", fontWeight: 700, fontSize: 13, margin: 0 }}>
                ✅ SIMULACIÓN COMPLETADA
              </p>
              <p style={{ fontSize: 11, color: "#374151", margin: "4px 0 0" }}>
                Algoritmo: <strong style={{ color: "#1a3a6a" }}>{selectedAlgorithm?.toUpperCase()}</strong>
                {" · "}{reportMetrics.diasCount} días · {startDate}
              </p>
            </div>

            {/* Acumulados (simulacion) */}
            <RSection title="⚖️ ACUMULADOS BRUTOS (simulación)">
              <MRow label="Demanda total"       value={fmt(reportMetrics.totalDemanda)} />
              <MRow label="Atendidas (cap)"     value={fmt(reportMetrics.atendidas)}    color="#065f46" />
              <MRow label="No atendidas (Ecap)" value={fmt(reportMetrics.ecap)}         color="#b91c1c" />
            </RSection>

            {/* Demanda real de los archivos .txt */}
            {liveStatus?.dailyRealDemand && Object.keys(liveStatus.dailyRealDemand).length > 0 && (
              <RSection title="📂 DEMANDA REAL (archivos fuente)">
                {Object.entries(liveStatus.dailyRealDemand).map(([fecha, total]) => {
                  const d = `${fecha.slice(0,4)}-${fecha.slice(4,6)}-${fecha.slice(6,8)}`;
                  return <MRow key={fecha} label={d} value={`${Number(total).toLocaleString('es-PE')} maletas`} />;
                })}
                <div style={{ borderTop: '1px solid rgba(10,60,110,0.12)', marginTop: 6, paddingTop: 6 }}>
                  <MRow
                    label="Total real 5 días"
                    value={fmt(Object.values(liveStatus.dailyRealDemand).reduce((a,b) => a+b, 0))}
                    color="#1a3a6a"
                  />
                </div>
              </RSection>
            )}

            {/* Promedios */}
            <RSection title="÷ PROMEDIOS DIARIOS">
              <MRow label="Demanda / día"   value={fmt(Math.round(reportMetrics.avgDemanda))} />
              <MRow label="Atendidas / día" value={fmt(Math.round(reportMetrics.avgAtendidas))} color="#065f46" />
              <MRow label="Ecap / día"      value={fmt(Math.round(reportMetrics.avgEcap))} color="#b91c1c" />
            </RSection>

            {/* KPIs */}
            <RSection title="📊 KPIs">
              <MRow label="Ocupación eff."     value={fmtPct(reportMetrics.ocupacion)} />
              <MRow label="Cumplimiento"        value={fmtPct(reportMetrics.cumplimiento)}
                color={reportMetrics.cumplimiento >= 90 ? "#065f46" : "#b91c1c"} />
              <MRow label="Sat. aeroportuaria"  value={fmtPct(reportMetrics.saturacion)}
                color={reportMetrics.saturacion > 100 ? "#b91c1c" : "#92400e"} />
            </RSection>

            {/* Fitness Score */}
            <div style={{
              background: "linear-gradient(135deg, rgba(79,70,229,0.07), rgba(99,102,241,0.04))",
              border: "1px solid rgba(79,70,229,0.25)", borderRadius: 10,
              padding: "12px 14px", marginBottom: 12,
            }}>
              <p style={{ fontSize: 10, color: "#4338ca", margin: "0 0 3px", fontWeight: 700 }}>🧠 FITNESS SCORE</p>
              <p style={{ fontSize: 9, color: "#6b7280", margin: "0 0 8px" }}>10A − 0.005Ecap − 2Dh − 12Saero</p>
              <p style={{
                fontSize: 24, fontWeight: 800, margin: 0,
                color: reportMetrics.score >= 0 ? "#065f46" : "#b91c1c",
              }}>
                {Number(reportMetrics.score).toLocaleString("es-PE", { maximumFractionDigits: 1 })}
              </p>
            </div>

            {/* Desglose por día */}
            {reportMetrics.byDay?.length > 0 && (
              <RSection title="📅 DESGLOSE POR DÍA">
                <table style={{ width: "100%", fontSize: 10, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ color: "#3a5a78" }}>
                      {["Día","Demanda","Atend.","Ecap","SLA"].map(h => (
                        <th key={h} style={{ textAlign: "right", padding: "4px 4px", borderBottom: "1px solid rgba(10,60,110,0.12)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {reportMetrics.byDay.map(d => (
                      <tr key={d.dia} style={{ background: d.colapsed ? "rgba(220,38,38,0.06)" : "transparent" }}>
                        <td style={{ textAlign: "right", padding: "3px 4px", color: d.colapsed ? "#b91c1c" : "#0a2a4a", fontWeight: 600 }}>{d.dia}{d.colapsed ? " ⚠" : ""}</td>
                        <td style={{ textAlign: "right", padding: "3px 4px", color: "#374151" }}>{(d.demanda/1000).toFixed(0)}k</td>
                        <td style={{ textAlign: "right", padding: "3px 4px", color: "#065f46", fontWeight: 600 }}>{(d.atendidas/1000).toFixed(0)}k</td>
                        <td style={{ textAlign: "right", padding: "3px 4px", color: "#b91c1c" }}>{(d.ecap/1000).toFixed(0)}k</td>
                        <td style={{ textAlign: "right", padding: "3px 4px", color: "#92400e", fontWeight: 600 }}>{d.sla.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </RSection>
            )}

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
                  📝 Exportar Reporte (.md)
                </button>
              )}
              <button id="period-btn-new" type="button"
                onClick={() => { onReset && onReset(); }}
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
    <div style={{ background: "rgba(10,60,110,0.05)", borderRadius: 8, padding: "10px 12px", marginBottom: 10,
                  border: "1px solid rgba(10,60,110,0.1)" }}>
      <p style={{ fontSize: 10, fontWeight: 700, color: "#3a5a78", margin: "0 0 8px", letterSpacing: 1 }}>{title}</p>
      {children}
    </div>
  );
}

function MRow({ label, value, color }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
      <span style={{ fontSize: 11, color: "#4a6a85" }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: color ?? "#0a2a4a" }}>{value}</span>
    </div>
  );
}

const btnSm = {
  width: 32, height: 32, borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(255,255,255,0.07)", color: "#e2e8f0",
  fontSize: 18, fontWeight: 700, cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
};

export default PeriodSimConfig;
