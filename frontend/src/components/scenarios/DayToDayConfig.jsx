import { useState, useMemo } from "react";
import FlightCancellationPanel from "./FlightCancellationPanel";

// ── DayToDayConfig — Panel del escenario "Operación Día a Día" ──────────────
// Muestra monitoreo en vivo y permite iniciar la simulación con la fecha real
// del dispositivo. No expone selector de fecha ni rango — eso es para "Periodo".

function DayToDayConfig({
  isOpen,
  onClose,
  selectedAlgorithm,
  onAlgorithmChange,
  activeShipments,
  totalBagsWaiting,
  simState,
  liveStatus,
  onStartDayToDay,
  onReset,
  sessionId,
}) {
  // ── Todos los hooks PRIMERO (antes de cualquier return condicional) ─────────
  const [activeSection, setActiveSection] = useState("envios");
  const [preCancelledFlightIds, setPreCancelledFlightIds] = useState([]);
  const [tempPreCancelId, setTempPreCancelId] = useState("");

  const handleAddPreCancel = () => {
    const id = parseInt(tempPreCancelId.trim(), 10);
    if (!isNaN(id) && !preCancelledFlightIds.includes(id)) {
      setPreCancelledFlightIds([...preCancelledFlightIds, id]);
    }
    setTempPreCancelId("");
  };

  const handleRemovePreCancel = (idToRemove) => {
    setPreCancelledFlightIds(preCancelledFlightIds.filter(id => id !== idToRemove));
  };

  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }, []);

  const yesterdayStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }, []);

  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [startTime, setStartTime] = useState("00:00");

  // ── Early return DESPUÉS de todos los hooks ───────────────────────────────
  if (!isOpen) return null;

  const isRunning   = simState === "running" || liveStatus?.status === "RUNNING";
  const isCompleted = simState === "completed" || liveStatus?.status === "DONE";

  const sections = [
    { key: "envios",  label: "Monitor" },
    { key: "vuelos",  label: "Vuelos" },
    { key: "config",  label: "Config" },
  ];

  return (
    <aside className="ct-scenario-config ct-scenario-config--vivo" aria-label="Configuración día a día">

      {/* Header */}
      <div className="ct-scenario-config__header">
        <div>
          <p className="ct-scenario-config__label">ESCENARIO ACTIVO</p>
          <h3 className="ct-scenario-config__title">Operación Día a Día</h3>
        </div>
        <button type="button" className="ct-scenario-config__close" onClick={onClose}>✕</button>
      </div>

      {/* Nav */}
      <nav className="ct-scenario-config__nav">
        {sections.map(s => (
          <button
            key={s.key}
            type="button"
            className={`ct-scenario-config__nav-btn ${activeSection === s.key ? "ct-scenario-config__nav-btn--active" : ""}`}
            onClick={() => setActiveSection(s.key)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div className="ct-scenario-config__body">

        {/* ── INICIAR / ESTADO ─────────────────────────────────────────────── */}
        <div className="ct-config-section" style={{ marginBottom: 0 }}>
          {!isRunning && !isCompleted ? (
          <>
            {/* Selector de fecha */}
            <div style={{
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(79,70,229,0.3)',
              borderRadius: 10, padding: '12px 14px', marginBottom: 10,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 20 }}>📅</span>
                <div>
                  <p style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#818cf8' }}>
                    {selectedDate
                      ? new Date(selectedDate + 'T12:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })
                      : '—'}
                  </p>
                  <p style={{ margin: 0, fontSize: 10, color: '#64748b' }}>Día de Monitoreo Activo</p>
                </div>
              </div>
              <input
                id="dtd-date-input"
                type="date"
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '8px 10px', borderRadius: 7,
                  background: '#f8fafc', border: '1px solid rgba(79,70,229,0.45)',
                  color: '#1e293b', fontSize: 13, fontWeight: 600,
                  colorScheme: 'light',
                }}
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                {[{ label: 'Ayer', date: yesterdayStr }, { label: 'Hoy', date: todayStr }].map(q => (
                  <button
                    key={q.date}
                    type="button"
                    onClick={() => setSelectedDate(q.date)}
                    style={{
                      flex: 1, padding: '4px 0', borderRadius: 6,
                      border: '1px solid rgba(79,70,229,0.3)',
                      background: selectedDate === q.date ? 'rgba(79,70,229,0.25)' : 'rgba(79,70,229,0.08)',
                      color: selectedDate === q.date ? '#818cf8' : '#64748b',
                      fontSize: 11, cursor: 'pointer', fontWeight: 700,
                    }}
                  >{q.label}</button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4, textTransform: 'uppercase' }}>
                Seleccionar hora de inyección:
              </label>
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

            <button
              id="dtd-btn-start"
              type="button"
              onClick={() => onStartDayToDay && onStartDayToDay(selectedDate, 1, preCancelledFlightIds, startTime, { isRealTime: true, planningHorizon: 30 })}
              style={{
                width: "100%", padding: "12px 0", borderRadius: 8, border: "none",
                background: "linear-gradient(135deg, #10b981, #059669)",
                color: "white", fontWeight: 700, fontSize: 14, cursor: "pointer",
                boxShadow: "0 4px 15px rgba(16,185,129,0.35)",
                letterSpacing: 0.5,
              }}
            >
              📡 CONECTAR Y MONITOREAR EN VIVO
            </button>
          </>
        ) : isRunning ? (
          <div style={{ textAlign: "center", padding: "8px 0" }}>
            <span style={{ color: "#10b981", fontSize: 13, fontWeight: 700 }}>
              📡 TRANSMITIENDO EN VIVO — Día {liveStatus?.currentDay ?? 1}
            </span>
            <div style={{ height: 4, background: "rgba(255,255,255,0.08)", borderRadius: 4, marginTop: 8 }}>
              <div style={{
                height: "100%", borderRadius: 4,
                width: `${liveStatus?.percent ?? 0}%`,
                background: "linear-gradient(90deg, #4f46e5, #10b981)",
                transition: "width 0.5s ease",
              }} />
            </div>
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "6px 0" }}>
            <span style={{ color: "#34d399", fontSize: 12, fontWeight: 700 }}>✓ Monitoreo finalizado</span>
            <button
              id="dtd-btn-reset"
              type="button"
              onClick={() => {
                if (onReset) onReset();
              }}
              style={{
                display: "block", width: "100%", marginTop: 8,
                padding: "8px 0", borderRadius: 7,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "transparent", color: "#94a3b8",
                fontWeight: 600, fontSize: 12, cursor: "pointer",
              }}
            >
              ↩ Reiniciar conexión
            </button>
          </div>
        )}
        </div>

        {/* ── SECCIÓN MONITOR ──────────────────────────────────────────────── */}
        {activeSection === "envios" && (
          <>
            <div className="ct-config-section">
              <p className="ct-config-section__title">📦 MALETAS EN ESPERA</p>
              <div style={{ padding: "14px", background: "rgba(255,255,255,0.04)", borderRadius: 8, textAlign: "center" }}>
                <span style={{ fontSize: 26, fontWeight: 800, color: "#10b981" }}>
                  {(totalBagsWaiting ?? 0).toLocaleString("es-PE")}
                </span>
                <span style={{ display: "block", fontSize: 11, opacity: 0.6, marginTop: 4 }}>
                  maletas esperando en almacenes
                </span>
              </div>
            </div>

            <div className="ct-config-section">
              <p className="ct-config-section__title">✈️ VENTANA MÓVIL (24H)</p>
              <div className="ct-shipment-list">
                {(!activeShipments || activeShipments.length === 0) ? (
                  <div style={{ padding: "20px", textAlign: "center", opacity: 0.5, fontSize: 12 }}>
                    Esperando próxima ventana de vuelos...
                  </div>
                ) : activeShipments.slice(0, 6).map(s => {
                  const depDate = new Date(s.departureTime);
                  const depFmt  = depDate.toLocaleTimeString("es-PE",
                    { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
                  const colors  = { cancelled: "#ef4444", rescued: "#3b82f6",
                                    blocked: "#f59e0b", critical: "#f97316" };
                  const dot     = colors[s.status] ?? "#10b981";
                  return (
                    <div key={`s-${s.id}`} className="ct-shipment-item">
                      <div className="ct-shipment-item__header">
                        <strong>Vuelo {s.id.toString().replace("vuelo-", "").split("-")[0]}</strong>
                        <span className="ct-sla-dot" style={{ background: dot }} title={s.status} />
                      </div>
                      <p className="ct-shipment-item__route">{s.from} → {s.to} · {depFmt}</p>
                      <p className="ct-shipment-item__meta">
                        {s.status?.toUpperCase()} · <em>Cap: {s.capacityPercent?.toFixed(1)}%</em>
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Resumen de métricas del día cuando hay simulación activa */}
            {liveStatus && (
              <div className="ct-config-section" style={{ marginTop: 4 }}>
                <p className="ct-config-section__title">📊 RESUMEN DEL DÍA</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {[
                    {
                      label: 'Vuelos activos',
                      value: liveStatus.activeRoutes?.length ?? 0,
                      color: '#818cf8',
                    },
                    {
                      label: 'SLA cumplido',
                      value: liveStatus.slaPercent != null ? `${liveStatus.slaPercent.toFixed(1)}%` : '—',
                      color: (liveStatus.slaPercent ?? 100) >= 85 ? '#10b981' : '#f97316',
                    },
                    {
                      label: 'Maletas atendidas',
                      value: (liveStatus.totalAttended ?? 0).toLocaleString('es-PE'),
                      color: '#34d399',
                    },
                    {
                      label: 'Maletas perdidas',
                      value: (liveStatus.totalMissed ?? 0).toLocaleString('es-PE'),
                      color: (liveStatus.totalMissed ?? 0) > 0 ? '#ef4444' : '#34d399',
                    },
                    {
                      label: 'Nodos críticos',
                      value: liveStatus.criticalNodes ?? 0,
                      color: (liveStatus.criticalNodes ?? 0) > 3 ? '#f97316' : '#94a3b8',
                    },
                    {
                      label: 'Ocupación global',
                      value: liveStatus.globalOccupancy != null ? `${liveStatus.globalOccupancy.toFixed(1)}%` : '—',
                      color: (liveStatus.globalOccupancy ?? 0) >= 90 ? '#ef4444' : '#818cf8',
                    },
                  ].map(item => (
                    <div key={item.label} style={{
                      background: 'rgba(255,255,255,0.04)', borderRadius: 8,
                      padding: '8px 10px', textAlign: 'center',
                    }}>
                      <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: item.color }}>
                        {item.value}
                      </p>
                      <p style={{ margin: 0, fontSize: 9, color: '#64748b', marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                        {item.label}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Barra de progreso */}
                {liveStatus.percent != null && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#64748b', marginBottom: 4 }}>
                      <span>{liveStatus.simulatedTime ?? `Día ${liveStatus.currentDay}`}</span>
                      <span style={{ color: liveStatus.status === 'DONE' ? '#10b981' : '#818cf8', fontWeight: 700 }}>
                        {liveStatus.status === 'DONE' ? '✓ Completado' : `${liveStatus.percent}%`}
                      </span>
                    </div>
                    <div style={{ height: 5, background: 'rgba(255,255,255,0.07)', borderRadius: 4 }}>
                      <div style={{
                        height: '100%', borderRadius: 4,
                        width: `${liveStatus.percent ?? 0}%`,
                        background: liveStatus.status === 'DONE'
                          ? 'linear-gradient(90deg,#10b981,#34d399)'
                          : 'linear-gradient(90deg,#4f46e5,#818cf8)',
                        transition: 'width 0.6s ease',
                      }} />
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ── SECCIÓN VUELOS ───────────────────────────────────────────────── */}
        {activeSection === "vuelos" && (
          <div className="ct-config-section">
            {/* Si no está corriendo la simulación, configurar cancelaciones previas */}
            {!isRunning && !isCompleted ? (
              <div style={{
                background: 'rgba(15, 23, 42, 0.85)',
                backdropFilter: 'blur(12px)',
                borderRadius: '12px',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                padding: '14px 16px',
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  marginBottom: '10px',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#818cf8',
                  letterSpacing: '0.5px',
                }}>
                  ⚙️ CONFIGURAR CANCELACIONES PREVIAS
                </div>
                <p style={{ fontSize: '11px', color: '#64748b', margin: '0 0 12px 0', lineHeight: '1.4' }}>
                  Define qué vuelos iniciarán cancelados desde el primer ciclo de la simulación.
                </p>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '14px' }}>
                  <input
                    type="number"
                    placeholder="ID de vuelo a pre-cancelar"
                    value={tempPreCancelId}
                    onChange={(e) => setTempPreCancelId(e.target.value)}
                    style={{
                      flex: 1,
                      background: 'rgba(30, 41, 59, 0.8)',
                      border: '1px solid rgba(100, 116, 139, 0.4)',
                      borderRadius: '8px',
                      padding: '8px 12px',
                      color: '#e2e8f0',
                      fontSize: '13px',
                      outline: 'none',
                    }}
                  />
                  <button
                    onClick={handleAddPreCancel}
                    disabled={!tempPreCancelId}
                    style={{
                      background: !tempPreCancelId
                        ? 'rgba(100, 116, 139, 0.4)'
                        : 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '8px 16px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: !tempPreCancelId ? 'not-allowed' : 'pointer',
                      transition: 'all 0.2s ease',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    ➕ Agregar
                  </button>
                </div>

                {preCancelledFlightIds.length > 0 ? (
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', marginBottom: '6px' }}>
                      Lista de vuelos a pre-cancelar:
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {preCancelledFlightIds.map(id => (
                        <div
                          key={`pre-${id}`}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            background: 'rgba(239, 68, 68, 0.15)',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            borderRadius: '20px',
                            padding: '4px 10px',
                            fontSize: '11px',
                            color: '#ef4444',
                            fontWeight: 700,
                          }}
                        >
                          <span>Vuelo {id}</span>
                          <button
                            onClick={() => handleRemovePreCancel(id)}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: '#ef4444',
                              cursor: 'pointer',
                              fontWeight: 'bold',
                              padding: 0,
                              fontSize: '12px',
                              lineHeight: 1,
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => setPreCancelledFlightIds([])}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#64748b',
                        fontSize: '10px',
                        cursor: 'pointer',
                        marginTop: '10px',
                        padding: 0,
                        textDecoration: 'underline',
                      }}
                    >
                      Limpiar lista
                    </button>
                  </div>
                ) : (
                  <div style={{ fontSize: '11px', color: '#64748b', fontStyle: 'italic', textAlign: 'center', padding: '8px 0' }}>
                    Ningún vuelo configurado para pre-cancelar.
                  </div>
                )}
              </div>
            ) : (
              <div>
                {/* Si la simulación está corriendo o completada, mostramos panel interactivo en curso */}
                <FlightCancellationPanel
                  sessionId={sessionId}
                  isRunning={isRunning}
                />
                
                {/* Si hubo pre-cancelados, mostrar el listado como referencia de lectura */}
                {preCancelledFlightIds.length > 0 && (
                  <div style={{
                    marginTop: '10px',
                    background: 'rgba(15, 23, 42, 0.5)',
                    borderRadius: '12px',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    padding: '12px 14px',
                  }}>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', marginBottom: '8px' }}>
                      📋 Vuelos pre-cancelados al inicio:
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {preCancelledFlightIds.map(id => (
                        <span
                          key={`pre-run-${id}`}
                          style={{
                            background: 'rgba(255, 255, 255, 0.06)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '20px',
                            padding: '3px 8px',
                            fontSize: '10px',
                            color: '#94a3b8',
                            fontWeight: 600,
                          }}
                        >
                          Vuelo {id}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── SECCIÓN CONFIG ───────────────────────────────────────────────── */}
        {activeSection === "config" && (
          <div className="ct-config-section">
            <p className="ct-config-section__title" style={{ marginTop: 16 }}>🚦 SEMÁFORO DE MALETAS</p>
            <div className="ct-sla-legend">
              {[
                { cls: "green",  label: "Verde: <70% del plazo" },
                { cls: "amber",  label: "Ámbar: 70-95% del plazo" },
                { cls: "red",    label: "Rojo: >95% o retrasada" },
              ].map(item => (
                <div key={item.cls} className="ct-sla-legend__item">
                  <span className={`ct-sla-dot ct-sla-dot--${item.cls}`} />
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </aside>
  );
}

export default DayToDayConfig;
