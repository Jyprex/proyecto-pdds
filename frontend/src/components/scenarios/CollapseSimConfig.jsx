import { useState, useMemo } from 'react'


// Fecha mínima = hoy, máxima = 31 dic 2026
function getTodayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function CollapseSimConfig({ isOpen, onClose, selectedAlgorithm, onAlgorithmChange, onStart, liveStatus }) {
  const [activeSection, setActiveSection] = useState('config')
  const [isStarting, setIsStarting]       = useState(false)
  const [startDate, setStartDate]         = useState('2026-04-09')
  const [stressFactor, setStressFactor]   = useState(5)

  const isRunning   = liveStatus?.status === 'RUNNING'
  const isCompleted = liveStatus?.status === 'DONE'
  const isCollapsed = liveStatus?.isCollapseMode && liveStatus?.percent > 0

  const stressLabel = useMemo(() => {
    if (stressFactor <= 2) return { text: 'Bajo', color: '#10b981' }
    if (stressFactor <= 5) return { text: 'Moderado', color: '#f59e0b' }
    if (stressFactor <= 8) return { text: 'Alto', color: '#f97316' }
    return { text: 'EXTREMO', color: '#ef4444' }
  }, [stressFactor])

  const handleStart = async () => {
    if (!onStart) return
    setIsStarting(true)
    await onStart(5, startDate, stressFactor)
    setIsStarting(false)
    setActiveSection('progreso')
  }

  if (!isOpen) return null

  const sections = [
    { key: 'config',   label: '⚙️ Config',    id: 'collapse-tab-config'   },
    { key: 'info',     label: '📖 Escenario', id: 'collapse-tab-info'     },
    { key: 'progreso', label: '📊 Progreso',  id: 'collapse-tab-progreso' },
  ]

  return (
    <aside className="ct-scenario-config ct-scenario-config--colapso" aria-label="Configuración simulación de colapso">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="ct-scenario-config__header ct-scenario-config__header--colapso">
        <div>
          <p className="ct-scenario-config__label">ESCENARIO ACTIVO</p>
          <h3 className="ct-scenario-config__title">
            Simulación de Colapso
            {isRunning && <span style={{ fontSize: 11, marginLeft: 8, color: '#fca5a5', fontWeight: 400, animation: 'pulse 1.5s infinite' }}>● EN CURSO</span>}
          </h3>
        </div>
        <button type="button" className="ct-scenario-config__close ct-scenario-config__close--light" onClick={onClose}>✕</button>
      </div>

      {/* ── Nav ────────────────────────────────────────────────────────────── */}
      <nav className="ct-scenario-config__nav ct-scenario-config__nav--colapso">
        {sections.map((s) => (
          <button
            key={s.key}
            id={s.id}
            type="button"
            className={`ct-scenario-config__nav-btn ${activeSection === s.key ? 'ct-scenario-config__nav-btn--active ct-scenario-config__nav-btn--colapso-active' : ''}`}
            onClick={() => setActiveSection(s.key)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div className="ct-scenario-config__body">

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* TAB: CONFIG                                                        */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {activeSection === 'config' && (
          <>
            {/* Descripción rápida */}
            <div style={{
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
              borderRadius: 10, padding: '10px 12px', marginBottom: 14,
            }}>
              <p style={{ fontSize: 11, color: '#fca5a5', margin: 0, lineHeight: 1.5 }}>
                <strong>¿Qué hace este escenario?</strong><br />
                Inyecta disrupciones controladas: cancela el 15% de rutas y reduce al 50% los 3 hubs principales.
                Detecta si el colapso es <em>computacional</em> (algoritmo lento) o <em>logístico</em> (aviones llenos).
              </p>
            </div>

            {/* ── Selector de fecha premium ──────────────────────────────── */}
            <div className="ct-config-section">
              <p className="ct-config-section__title">📅 FECHA DE INICIO DEL ESTRÉS</p>
              <p className="ct-config-hint">El sistema cargará los envíos reales de esa fecha e inyectará las disrupciones.</p>

              <div style={{
                background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(239,68,68,0.35)',
                borderRadius: 12, padding: '14px 16px', marginTop: 8,
              }}>
                {/* Fecha seleccionada — display visual */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 28 }}>📆</span>
                  <div>
                    <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#fca5a5', letterSpacing: 1 }}>
                      {startDate
                        ? new Date(startDate + 'T12:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })
                        : '—'}
                    </p>
                    <p style={{ margin: 0, fontSize: 10, color: '#6b7280' }}>Día de inicio de la simulación</p>
                  </div>
                </div>

                {/* Input nativo con estilo */}
                <label style={{ display: 'block' }}>
                  <span style={{ fontSize: 10, color: '#9ca3af', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Seleccionar fecha
                  </span>
                  <input
                    id="collapse-date-input"
                    type="date"
                    value={startDate}
                    min="2026-01-01"
                    max="2026-12-31"
                    onChange={e => setStartDate(e.target.value)}
                    style={{
                      width: '100%', padding: '10px 12px', borderRadius: 8, boxSizing: 'border-box',
                      background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)',
                      color: '#f9fafb', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                      colorScheme: 'dark',
                    }}
                  />
                </label>

                {/* Atajos de fecha rápida */}
                <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                  {[
                    { label: 'Mín. histórico', date: '2026-01-05' },
                    { label: 'Promedio', date: '2026-02-15' },
                    { label: 'Máx. histórico', date: '2026-04-09' },
                  ].map(q => (
                    <button
                      key={q.date}
                      type="button"
                      onClick={() => setStartDate(q.date)}
                      style={{
                        padding: '4px 9px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.3)',
                        background: startDate === q.date ? 'rgba(239,68,68,0.25)' : 'rgba(239,68,68,0.08)',
                        color: startDate === q.date ? '#fca5a5' : '#9ca3af',
                        fontSize: 10, cursor: 'pointer', fontWeight: 600,
                      }}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Slider de estrés ───────────────────────────────────────── */}
            <div className="ct-config-section">
              <p className="ct-config-section__title">📈 FACTOR DE ESTRÉS OPERATIVO</p>
              <p className="ct-config-hint">Nivel de interrupción real inyectada al backend. Determina el % de rutas canceladas en cada día simulado.</p>

              <div style={{ background: 'rgba(15,23,42,0.5)', borderRadius: 10, padding: '12px 14px', marginTop: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: '#9ca3af' }}>Nivel de estrés</span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: stressLabel.color }}>
                    ×{stressFactor} — {stressLabel.text}
                  </span>
                </div>
                <input
                  id="collapse-stress-slider"
                  type="range" min="1" max="10" step="0.5"
                  value={stressFactor}
                  onChange={e => setStressFactor(parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: stressLabel.color }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#6b7280', marginTop: 4 }}>
                  <span>×1 Normal</span><span>×5</span><span>×10 Extremo</span>
                </div>
              </div>
            </div>

            {/* ── Algoritmo ─────────────────────────────────────────────── */}
            <div className="ct-config-section">
              <p className="ct-config-section__title">⚙️ ALGORITMO DE RESPUESTA</p>
              <div style={{ background: 'rgba(15,23,42,0.5)', borderRadius: 10, padding: '10px 12px', marginTop: 6 }}>
                {[
                  { val: 'alns', label: 'ALNS — Recomendado ★', sub: 'Rescata vuelos cancelados en ~6.5 s', color: '#818cf8' },
                  { val: 'hga',  label: 'HGA — Comparación',    sub: 'Pierde maletas de rutas canceladas', color: '#6b7280' },
                ].map(opt => (
                  <label key={opt.val} className="ct-algorithm-option" style={{ marginBottom: 8, display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                    <input
                      type="radio" name="algo-collapse" value={opt.val}
                      checked={selectedAlgorithm === opt.val}
                      onChange={() => onAlgorithmChange(opt.val)}
                      style={{ marginTop: 3, accentColor: opt.color }}
                    />
                    <div>
                      <strong style={{ color: selectedAlgorithm === opt.val ? opt.color : '#e2e8f0', fontSize: 12 }}>{opt.label}</strong>
                      <span style={{ display: 'block', fontSize: 10, color: '#9ca3af', marginTop: 2 }}>{opt.sub}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* ── Resumen de lo que pasará ──────────────────────────────── */}
            <div style={{
              background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)',
              borderRadius: 10, padding: '10px 12px', marginBottom: 14, fontSize: 11,
            }}>
              <p style={{ margin: '0 0 6px 0', color: '#fca5a5', fontWeight: 700, fontSize: 12 }}>📤 Qué pondrás · 📥 Qué saldrá</p>
              <div style={{ color: '#9ca3af', lineHeight: 1.7 }}>
                <p style={{ margin: 0 }}>▸ <strong style={{color:'#e2e8f0'}}>Entrada:</strong> Fecha {startDate}, factor ×{stressFactor}, algoritmo {(selectedAlgorithm||'alns').toUpperCase()}, 5 días</p>
                <p style={{ margin: 0 }}>▸ <strong style={{color:'#e2e8f0'}}>Salida:</strong> Rutas rescatadas, E_cap, colapso computacional (Ta≥Sa), SLA violado</p>
                <p style={{ margin: 0 }}>▸ <strong style={{color:'#ef4444'}}>Disrupciones:</strong> −50% cap en BOG/MAD/DEL · {Math.round(stressFactor * 3)}% de rutas canceladas</p>
              </div>
            </div>

            {/* ── Botón de inicio ───────────────────────────────────────── */}
            <div className="ct-config-section">
              <button
                id="collapse-btn-start"
                type="button"
                className="ct-sim-start-btn ct-sim-start-btn--danger"
                onClick={handleStart}
                disabled={isStarting || isRunning || !startDate}
                style={{
                  opacity: (isStarting || isRunning) ? 0.7 : 1,
                  position: 'relative', overflow: 'hidden',
                }}
              >
                {isStarting
                  ? '⏳ Iniciando colapso...'
                  : isRunning
                    ? `⚙ Simulando día ${liveStatus?.currentDay ?? 1}/${liveStatus?.totalDays ?? 5}...`
                    : isCompleted
                      ? '✓ Colapso completado — Reiniciar'
                      : `⚠ Iniciar simulación de colapso real`}
              </button>
              {isCompleted && (
                <p style={{ textAlign: 'center', fontSize: 10, color: '#9ca3af', marginTop: 6 }}>
                  Vuelos rescatados: <strong style={{color:'#818cf8'}}>{liveStatus?.rescuedFlights ?? 0}</strong>
                </p>
              )}
            </div>
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* TAB: INFO — Explicación del escenario                             */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {activeSection === 'info' && (
          <div className="ct-config-section">
            <p className="ct-config-section__title">🔬 ¿QUÉ EVALÚA ESTE ESCENARIO?</p>
            {[
              {
                icon: '💻', title: 'Colapso Computacional (Ta ≥ Sa)',
                desc: 'Detecta si el algoritmo tardó más de 15 s (Sa). Si Ta ≥ Sa, el vuelo podría haber despegado sin solución. En nuestros experimentos: el ALNS NO colapsó computacionalmente.',
                color: '#818cf8',
              },
              {
                icon: '🏭', title: 'Colapso Logístico (E_cap > 0)',
                desc: 'Detecta si los aviones/almacenes se llenaron. Cuando E_cap > 0 el sistema es incapaz de mover todas las maletas. En el nivel MAX (≈35.000 maletas): el 0.86% quedó varado — por física, no por software.',
                color: '#ef4444',
              },
              {
                icon: '🛡️', title: 'Resiliencia ALNS vs HGA',
                desc: 'El ALNS rescata vuelos cancelados usando backup routes precalculadas por el HGA. El HGA pierde las maletas de rutas canceladas. Este contraste es la conclusión clave del experimento.',
                color: '#10b981',
              },
            ].map(item => (
              <div key={item.title} style={{
                background: 'rgba(15,23,42,0.5)', border: `1px solid ${item.color}30`,
                borderLeft: `3px solid ${item.color}`, borderRadius: 8,
                padding: '10px 12px', marginBottom: 10,
              }}>
                <p style={{ margin: '0 0 4px 0', fontSize: 12, fontWeight: 700, color: item.color }}>
                  {item.icon} {item.title}
                </p>
                <p style={{ margin: 0, fontSize: 10, color: '#9ca3af', lineHeight: 1.6 }}>{item.desc}</p>
              </div>
            ))}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* TAB: PROGRESO — conectado al liveStatus real                       */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {activeSection === 'progreso' && (
          <div className="ct-config-section">
            <p className="ct-config-section__title">📊 PROGRESO DEL COLAPSO</p>

            {!liveStatus ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#d1d5db', fontSize: 12 }}>
                Inicia la simulación en la pestaña ⚙️ Config para ver el progreso en tiempo real.
              </div>
            ) : (
              <div className="ct-progress-detail">
                {/* Barra de progreso real */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                    <span style={{ color: '#d1d5db' }}>Días completados</span>
                    <span style={{ color: '#fca5a5', fontWeight: 700 }}>
                      {liveStatus.currentDay ?? 0} / {liveStatus.totalDays ?? 5}
                    </span>
                  </div>
                  <div style={{ height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 4 }}>
                    <div style={{
                      height: '100%', borderRadius: 4,
                      width: `${liveStatus.percent ?? 0}%`,
                      background: liveStatus.percent >= 100 ? '#10b981' : 'linear-gradient(90deg, #ef4444, #f97316)',
                      transition: 'width 0.6s ease',
                    }} />
                  </div>
                </div>

                {[
                  { label: 'Estado', value: liveStatus.status === 'RUNNING' ? '⚙ SIMULANDO' : liveStatus.status === 'DONE' ? '✓ COMPLETADO' : liveStatus.status, red: liveStatus.status === 'RUNNING' },
                  { label: 'Tiempo simulado', value: liveStatus.simulatedTime ?? '—' },
                  { label: 'SLA acumulado', value: liveStatus.slaPercent != null ? `${liveStatus.slaPercent.toFixed(1)}%` : '—', red: liveStatus.slaPercent < 85 },
                  { label: 'Aeropuertos críticos', value: liveStatus.criticalNodes ?? 0, red: (liveStatus.criticalNodes ?? 0) > 0 },
                  { label: 'Vuelos rescatados (ALNS)', value: liveStatus.rescuedFlights ?? 0, green: true },
                  { label: 'Maletas esperando', value: (liveStatus.totalBagsWaiting ?? 0).toLocaleString('es-PE'), red: (liveStatus.totalBagsWaiting ?? 0) > 500 },
                ].map(item => (
                  <div key={item.label} className="ct-progress-detail__item">
                    <span>{item.label}</span>
                    <strong style={{ color: item.green ? '#10b981' : item.red ? '#ef4444' : '#e2e8f0' }}>
                      {item.value}
                    </strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </aside>
  )
}

export default CollapseSimConfig
