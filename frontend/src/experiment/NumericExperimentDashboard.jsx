import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNumericExperiment } from './useNumericExperiment';
import { apiFetch, apiUrl } from '../hooks/api';

// ── Paleta de colores por nivel ──────────────────────────────────────────────
const LEVEL_COLORS = {
    MIN:      { border: '#3b82f6', bg: 'rgba(59,130,246,0.08)',  badge: '#1d4ed8', label: '#93c5fd' },
    MID_LOW:  { border: '#06b6d4', bg: 'rgba(6,182,212,0.08)',   badge: '#0e7490', label: '#67e8f9' },
    AVG:      { border: '#f59e0b', bg: 'rgba(245,158,11,0.08)',  badge: '#b45309', label: '#fcd34d' },
    MID_HIGH: { border: '#f97316', bg: 'rgba(249,115,22,0.08)',  badge: '#c2410c', label: '#fdba74' },
    MAX:      { border: '#ef4444', bg: 'rgba(239,68,68,0.08)',   badge: '#b91c1c', label: '#fca5a5' },
};

const LEVEL_ICONS = { MIN: '📉', MID_LOW: '📊', AVG: '⚖️', MID_HIGH: '📈', MAX: '🔥' };

// ── Utilidades ───────────────────────────────────────────────────────────────
const fmt = (n) => (n !== undefined && n !== null) ? Number(n).toLocaleString('es-PE') : '—';
const fmtPct = (n) => n !== undefined ? `${n}%` : '—';
const fmtMs = (ms) => ms !== undefined ? `${ms.toLocaleString()} ms` : '—';

// ── Componente: Encabezado DOE ───────────────────────────────────────────────
const DOEHeader = ({ levels }) => (
    <div style={s.doeHeader}>
        <div style={s.doeHeaderTitle}>
            📊 Resumen de Niveles de Carga (Detectados)
        </div>
        <div style={s.doeGrid}>
            {levels.map((lvl, i) => {
                const colors = LEVEL_COLORS[lvl.levelTag] || LEVEL_COLORS.AVG;
                return (
                    <div key={i} style={{ ...s.doeCard, borderTop: `3px solid ${colors.border}` }}>
                        <div style={{ fontSize: 18 }}>{LEVEL_ICONS[lvl.levelTag]}</div>
                        <div style={{ fontSize: 11, color: colors.label, fontWeight: 700, marginBottom: 4 }}>
                            {lvl.name}
                        </div>
                        <div style={{ fontSize: 22, fontWeight: 900, color: '#f1f5f9' }}>
                            {fmt(lvl.suitcaseCount)}
                        </div>
                        <div style={{ fontSize: 10, color: '#64748b' }}>maletas / día</div>
                        <div style={{ fontSize: 10, color: '#475569', marginTop: 4 }}>
                            Fecha: {lvl.fecha}
                        </div>
                    </div>
                );
            })}
        </div>
    </div>
);

// ── Componente: Barra de info de la sesión activa ─────────────────────────────────
const ProgressBar = ({ running, done, color }) => (
    <div style={s.progressBg}>
        <div style={{
            ...s.progressFill,
            width: done ? '100%' : (running ? '100%' : '0%'),
            background: done ? '#10b981' : color,
            animation: running && !done ? 'pulse-bar 1.5s ease-in-out infinite' : 'none',
        }} />
    </div>
);

// ── Componente: Card de nivel individual ─────────────────────────────────────
const LevelCard = ({ levelDef, result, isRunning }) => {
    const colors    = LEVEL_COLORS[levelDef.levelTag] || LEVEL_COLORS.AVG;
    const icon      = LEVEL_ICONS[levelDef.levelTag] || '📋';
    const isDone    = !!result;
    const isActive  = isRunning && !isDone;

    return (
        <div style={{ ...s.levelCard, borderLeft: `5px solid ${colors.border}`, background: isDone ? colors.bg : '#1e293b' }}>
            {/* ── Cabecera del caso ── */}
            <div style={s.cardHeader}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 220 }}>
                    <div style={{ fontSize: 28 }}>{icon}</div>
                    <div>
                        <div style={{ fontSize: 17, fontWeight: 800, color: '#e2e8f0' }}>
                            {levelDef.name}
                        </div>
                        <div style={{ fontSize: 12, color: '#64748b' }}>
                            {fmt(levelDef.suitcaseCount)} maletas · {levelDef.fecha}
                        </div>
                    </div>
                </div>

                <div style={{ flex: 1, margin: '0 30px' }}>
                    <ProgressBar running={isActive} done={isDone} color={colors.border} />
                    <div style={{ fontSize: 10, fontWeight: 700, color: isDone ? '#10b981' : (isActive ? colors.label : '#475569'), marginTop: 6, letterSpacing: 1 }}>
                        {isDone ? '✅  COMPLETADO' : (isActive ? '⚙  EJECUTANDO...' : '🕒  PENDIENTE')}
                    </div>
                </div>

                {isDone && (
                    <div style={{ ...s.scoreBadge, background: result.fitnessScore >= 0 ? 'linear-gradient(135deg,#f59e0b,#d97706)' : 'linear-gradient(135deg,#ef4444,#b91c1c)' }}>
                        <div style={{ fontSize: 9, opacity: 0.85, letterSpacing: 1 }}>FITNESS SCORE</div>
                        <div style={{ fontSize: 15, fontWeight: 900 }}>{fmt(result.fitnessScore)}</div>
                        <div style={{ fontSize: 8, opacity: 0.7 }}>10A − 0.005Ecap − 2Dh − 12Saero</div>
                    </div>
                )}
            </div>

            {/* ── Resultados expandidos (solo cuando está completado) ── */}
            {isDone && (
                <div style={s.resultSection}>
                    {/* Impacto Logístico */}
                    <div style={s.resultCol}>
                        <div style={s.colTitle}>📦 Impacto Logístico</div>
                        <MetricRow label="Ocupación Efectiva"  value={fmtPct(result.occupancyRate)} />
                        <MetricRow label="Lead Time (avg)"     value={`${result.leadTimeAvg} h`} />
                        <MetricRow label="Cumplimiento"        value={fmtPct(result.complianceRate)} />
                        <MetricRow label="Saturación Aero."    value={fmtPct(result.avgAirportSaturation)}
                            highlight={result.avgAirportSaturation > 80} />
                    </div>

                    {/* Resumen de Carga */}
                    <div style={s.resultCol}>
                        <div style={s.colTitle}>📋 Resumen de Carga</div>
                        <MetricRow label="Total Procesado"   value={fmt(result.totalProcessed)} />
                        <MetricRow label="Maletas Atend."    value={fmt(result.totalAttended)}  accent="#10b981" />
                        <MetricRow label="Ecap (no atend.)" value={fmt(result.totalEcap)}       accent="#ef4444" />
                    </div>

                    {/* Vuelos y Rutas */}
                    <div style={s.resultCol}>
                        <div style={s.colTitle}>✈️ Vuelos / Rutas</div>
                        <MetricRow label="Total Rutas"      value={fmt(result.totalRoutes)} />
                        <MetricRow label="Rutas Atend."     value={fmt(result.routesServed)}   accent="#10b981" />
                        <MetricRow label="Rutas No Atend." value={fmt(result.routesUnserved)} accent={result.routesUnserved > 0 ? '#ef4444' : undefined} />
                        <MetricRow label="Máx. Cap. Ruta"   value={fmt(result.maxRouteCapacity)} accent="#f59e0b" />
                        <MetricRow label="Avg Cap. Ruta"    value={fmt(Math.round(result.avgRouteCapacity ?? 0))} />
                    </div>

                    {/* Computacional */}
                    <div style={s.resultCol}>
                        <div style={s.colTitle}>⚡ Desempeño Cmp.</div>
                        <MetricRow label="Memoria Usada"  value={`${result.memoryUsedMb} MB`} />
                        <MetricRow label="CPU Promedio"   value={fmtPct(result.cpuUsagePercent)} />
                    </div>
                </div>
            )}

            {/* Desglose de Tiempos por Fase */}
            {isDone && (
                <div style={s.phaseTimeline}>
                    <div style={s.phaseTitle}>⏱ Desglose de Tiempos — {fmtMs(result.executionTimeMs)} total</div>
                    <div style={s.phaseRow}>
                        <PhaseBar label="🗂 Carga / Filtrado" ms={result.loadingTimeMs ?? 0}    total={result.executionTimeMs || 1} color="#06b6d4" />
                        <PhaseBar label="🧠 Planificación"   ms={result.planningTimeMs ?? 0}   total={result.executionTimeMs || 1} color="#6366f1" />
                        <PhaseBar label="🚀 Simulación"      ms={result.simulationTimeMs ?? 0} total={result.executionTimeMs || 1} color="#10b981" />
                    </div>
                </div>
            )}
        </div>
    );
};

const MetricRow = ({ label, value, highlight, accent }) => (
    <div style={s.metricRow}>
        <span style={{ color: '#94a3b8' }}>{label}</span>
        <strong style={{ color: highlight ? '#ef4444' : (accent || '#e2e8f0') }}>{value}</strong>
    </div>
);

const PhaseBar = ({ label, ms, total, color }) => {
    const pct = total > 0 ? Math.min(100, Math.round((ms / total) * 100)) : 0;
    return (
        <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: '#94a3b8' }}>{label}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color }}>{ms} ms ({pct}%)</span>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.3)', height: 6, borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.5s ease' }} />
            </div>
        </div>
    );
};

const SessionInfoBar = ({ fechaBase, algorithm, totalMaletas }) => (
    <div style={s.sessionBar}>
        <div style={s.sessionItem}>
            <span style={s.sessionLabel}>📅 Fecha Analizada</span>
            <span style={s.sessionValue}>{fechaBase || '—'}</span>
        </div>
        <div style={s.sessionDivider} />
        <div style={s.sessionItem}>
            <span style={s.sessionLabel}>🧳 Total Maletas del Día</span>
            <span style={{ ...s.sessionValue, color: '#6366f1', fontSize: 18 }}>
                {totalMaletas > 0 ? Number(totalMaletas).toLocaleString('es-PE') : '—'}
            </span>
        </div>
        <div style={s.sessionDivider} />
        <div style={s.sessionItem}>
            <span style={s.sessionLabel}>🤖 Algoritmo</span>
            <span style={{ ...s.sessionValue, color: algorithm === 'ALNS' ? '#818cf8' : '#34d399' }}>
                {algorithm}
            </span>
        </div>
        <div style={s.sessionDivider} />
        <div style={s.sessionItem}>
            <span style={s.sessionLabel}>📊 Niveles DOE</span>
            <span style={s.sessionValue}>5 escenarios de carga</span>
        </div>
    </div>
);

// ── Componente Principal ─────────────────────────────────────────────────────
const NumericExperimentDashboard = () => {
    const navigate = useNavigate();
    const [selectedAlgo, setSelectedAlgo] = useState('ALNS');

    // Estado de la exportación Excel
    const [exportStatus, setExportStatus] = useState('IDLE'); // IDLE|RUNNING|DONE|FAILED
    const [exportProgress, setExportProgress] = useState(0);
    const [exportSession, setExportSession] = useState(null);
    const [exportLabel, setExportLabel] = useState('');
    const exportTimerRef = useRef(null);

    const {
        doeData, doeLoaded,
        sessionData, isRunning, isDone, isFailed,
        loadDOE, startExperiment, reset, error,
    } = useNumericExperiment();

    const levels    = doeData?.levels || [];
    const results   = sessionData?.results || [];
    const currentIdx = sessionData?.currentLevelIndex ?? -1;
    const progress  = sessionData?.progressPercent ?? 0;

    const canStart  = doeLoaded && !isRunning;
    const canExport = doeLoaded && exportStatus !== 'RUNNING';

    const handleStart = () => {
        startExperiment(selectedAlgo);
    };

    const handleExport = async () => {
        if (!canExport) return;
        setExportStatus('RUNNING');
        setExportProgress(0);
        setExportSession(null);
        setExportLabel('Iniciando...');
        try {
            const res = await apiFetch('/api/v1/numeric-experiment/export/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ algorithm: selectedAlgo }),
            });
            if (!res.ok) throw new Error('Error al iniciar exportación');
            const data = await res.json();
            const eid = data.exportSessionId;
            setExportSession(eid);

            // Polling cada 3s
            if (exportTimerRef.current) clearInterval(exportTimerRef.current);
            exportTimerRef.current = setInterval(async () => {
                try {
                    const r2 = await apiFetch(`/api/v1/numeric-experiment/export/status/${eid}`);
                    const d2 = await r2.json();
                    setExportProgress(d2.progressPercent || 0);
                    setExportLabel(`Iteración ${d2.currentIteration}/10 · Nivel ${d2.currentLevel}/5 (${d2.completedWork}/${d2.totalWork})`);

                    if (d2.status === 'DONE') {
                        clearInterval(exportTimerRef.current);
                        setExportStatus('DONE');
                        setExportLabel(`✅ Archivo listo: ${d2.fileName}`);
                        // Auto-descarga
                        const a = document.createElement('a');
                        a.href = apiUrl(`/api/v1/numeric-experiment/export/download/${eid}`);
                        a.download = d2.fileName || `ResultadoIteraciones${selectedAlgo}.xlsx`;
                        a.click();
                    } else if (d2.status === 'FAILED') {
                        clearInterval(exportTimerRef.current);
                        setExportStatus('FAILED');
                        setExportLabel(`❌ Error: ${d2.errorMessage}`);
                    }
                } catch (err) {
                    console.warn('[Export] Error polling:', err)
                }
             }, 3000);
        } catch (e) {
            setExportStatus('FAILED');
            setExportLabel(`❌ ${e.message}`);
        }
    };

    // Limpieza al desmontar
    useEffect(() => {
        return () => { if (exportTimerRef.current) clearInterval(exportTimerRef.current); };
    }, []);

    return (
        <div style={s.page}>
            {/* ────────── BARRA SUPERIOR ────────── */}
            <div style={s.topBar}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <button onClick={() => navigate('/')} style={s.backBtn}>← Torre de Control</button>
                    <div>
                        <h1 style={s.pageTitle}>🧪 Tablero de Experimentación Numérica</h1>
                        <p style={s.pageSubtitle}>Esquema Académico DOE · Análisis sobre Archivos Planos · 1 Día Comprimido por Nivel</p>
                    </div>
                </div>

                {/* Controles */}
                <div style={s.controls}>
                    {/* Selector de algoritmo */}
                    <div style={s.algoSelector}>
                        {['ALNS'].map(algo => (
                            <button
                                key={algo}
                                onClick={() => setSelectedAlgo(algo)}
                                disabled={isRunning}
                                style={{
                                    ...s.algoBtn,
                                    ...(selectedAlgo === algo ? s.algoBtnActive : {}),
                                    opacity: isRunning ? 0.5 : 1,
                                }}
                            >
                                {algo === 'ALNS' ? '⚡ ALNS' : '🧬 HGA'}
                            </button>
                        ))}
                    </div>

                    {/* Input de fecha ELIMINADO: en DOE cada nivel usa su propia fecha histórica */}

                    {/* Botón Calcular DOE */}
                    {!doeLoaded && (
                        <button onClick={loadDOE} style={s.doeBtn}>
                            🔍 Calcular Niveles DOE
                        </button>
                    )}

                    {/* Botón Iniciar / Reset */}
                    {doeLoaded && (
                        isDone || isFailed ? (
                            <button onClick={reset} style={s.resetBtn}>↺ Nueva Ejecución</button>
                        ) : (
                            <button
                                onClick={handleStart}
                                disabled={!canStart}
                                style={{ ...s.startBtn, opacity: canStart ? 1 : 0.5 }}
                            >
                                {isRunning ? '⚙ Ejecutando...' : '▶ Iniciar Experimento'}
                            </button>
                        )
                    )}

                    {/* Botón Exportar Excel (10 iteraciones) */}
                    {doeLoaded && (
                        <button
                            onClick={handleExport}
                            disabled={!canExport}
                            style={{
                                ...s.exportBtn,
                                opacity: canExport ? 1 : 0.45,
                                cursor: canExport ? 'pointer' : 'not-allowed',
                            }}
                            title="Ejecuta 10 iteraciones del DOE y descarga el Excel con MEDIA y DESV.EST"
                        >
                            {exportStatus === 'RUNNING'
                                ? `⏳ ${exportProgress}% exportando...`
                                : exportStatus === 'DONE'
                                    ? '✅ Descargar de nuevo'
                                    : '📊 Exportar 10 iteraciones → .xlsx'}
                        </button>
                    )}
                </div>
            </div>

            {/* ────────── ESTADO INICIAL: sin datos DOE ────────── */}
            {!doeLoaded && !error && (
                <div style={s.emptyState}>
                    <div style={{ fontSize: 64, marginBottom: 20 }}>🧪</div>
                    <h2 style={{ color: '#e2e8f0', marginBottom: 12 }}>Módulo de Experimentación Numérica</h2>
                    <p style={{ color: '#64748b', maxWidth: 500, textAlign: 'center', lineHeight: 1.6 }}>
                        Haz clic en <strong style={{ color: '#6366f1' }}>Calcular Niveles DOE</strong> para que el sistema
                        escanee todos los archivos históricos de envíos y determine automáticamente los 5 niveles
                        de carga estadísticos (Mínimo, Intermedio, Promedio, Alto, Máximo).
                    </p>
                </div>
            )}

            {/* ────────── ENCABEZADO DOE ────────── */}
            {doeLoaded && levels.length > 0 && (
                <DOEHeader levels={levels} />
            )}

            {/* ────────── BARRA DE PROGRESO GLOBAL ────────── */}
            {isRunning && (
                <div style={s.globalProgressBar}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 700 }}>
                            {selectedAlgo} · Progreso Global
                        </span>
                        <span style={{ fontSize: 12, color: '#6366f1', fontWeight: 700 }}>{progress}%</span>
                    </div>
                    <div style={s.progressBg}>
                        <div style={{ ...s.progressFill, width: `${progress}%`, background: 'linear-gradient(90deg,#6366f1,#8b5cf6)' }} />
                    </div>
                </div>
            )}

            {/* ────────── LOS 5 CASOS ────────── */}
            {doeLoaded && (
                <div style={s.casesContainer}>
                    {levels.map((levelDef, idx) => {
                        const result   = results.find(r => r.levelIndex === idx);
                        const isActive = isRunning && currentIdx === idx && !result;
                        return (
                            <LevelCard
                                key={idx}
                                levelDef={levelDef}
                                result={result}
                                isRunning={isActive}
                            />
                        );
                    })}
                </div>
            )}

            {/* ────────── PROGRESO DE EXPORTACIÓN ────────── */}
            {exportStatus !== 'IDLE' && (
                <div style={s.exportProgressBox}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.5,
                            color: exportStatus === 'DONE' ? '#10b981' : exportStatus === 'FAILED' ? '#ef4444' : '#f59e0b' }}>
                            {exportStatus === 'RUNNING' ? '📊 GENERANDO EXCEL DOE — 10 ITERACIONES'
                                : exportStatus === 'DONE' ? '✅ EXCEL GENERADO Y DESCARGADO'
                                : '❌ ERROR EN EXPORTACIÓN'}
                        </span>
                        <span style={{ fontSize: 11, color: '#94a3b8' }}>{exportLabel}</span>
                    </div>
                    <div style={s.progressBg}>
                        <div style={{ ...s.progressFill, width: `${exportProgress}%`,
                            background: exportStatus === 'DONE' ? '#10b981' : 'linear-gradient(90deg,#f59e0b,#d97706)',
                            transition: 'width 0.5s ease' }} />
                    </div>
                    {exportStatus === 'DONE' && exportSession && (
                        <div style={{ marginTop: 10, textAlign: 'right' }}>
                            <a
                                href={apiUrl(`/api/v1/numeric-experiment/export/download/${exportSession}`)}
                                download
                                style={{ fontSize: 12, color: '#6366f1', fontWeight: 700, textDecoration: 'none',
                                    background: 'rgba(99,102,241,0.1)', padding: '5px 14px', borderRadius: 8,
                                    border: '1px solid rgba(99,102,241,0.4)' }}
                            >
                                ⬇ Descargar Resultado{selectedAlgo}.xlsx de nuevo
                            </a>
                        </div>
                    )}
                </div>
            )}

            {/* ────────── MENSAJE DE ERROR ────────── */}
            {error && (
                <div style={s.errorBanner}>❌ {error}</div>
            )}

            {/* ────────── CSS ANIMACIONES ────────── */}
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap');
                @keyframes pulse-bar {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.5; }
                }
            `}</style>
        </div>
    );
};

// ── Estilos ──────────────────────────────────────────────────────────────────
const s = {
    page: {
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0f172a 0%, #0d1b2a 100%)',
        color: '#f8fafc',
        padding: '28px 32px',
        fontFamily: "'Inter', sans-serif",
        boxSizing: 'border-box',
    },
    topBar: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 28,
        paddingBottom: 20,
        borderBottom: '1px solid rgba(255,255,255,0.06)',
    },
    backBtn: {
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        color: '#94a3b8',
        padding: '8px 14px',
        borderRadius: 8,
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: 600,
    },
    pageTitle: { fontSize: 22, fontWeight: 900, margin: 0, letterSpacing: -0.5 },
    pageSubtitle: { fontSize: 12, color: '#475569', margin: '4px 0 0', letterSpacing: 0.3 },
    controls: { display: 'flex', alignItems: 'center', gap: 12 },
    dateInputWrapper: { display: 'flex', flexDirection: 'column', gap: 3 },
    dateLabel: { fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 },
    dateInput: {
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.12)',
        color: '#e2e8f0',
        padding: '7px 12px',
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 600,
        outline: 'none',
        cursor: 'pointer',
        colorScheme: 'dark',
    },
    algoSelector: {
        display: 'flex',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 10,
        padding: 4,
    },
    algoBtn: {
        padding: '8px 18px',
        border: 'none',
        background: 'transparent',
        color: '#64748b',
        borderRadius: 8,
        cursor: 'pointer',
        fontWeight: 700,
        fontSize: 13,
        transition: 'all 0.2s',
    },
    algoBtnActive: { background: '#6366f1', color: 'white', boxShadow: '0 2px 8px rgba(99,102,241,0.4)' },
    doeBtn: {
        background: 'rgba(99,102,241,0.15)',
        border: '1px solid #6366f1',
        color: '#818cf8',
        padding: '9px 18px',
        borderRadius: 9,
        cursor: 'pointer',
        fontWeight: 700,
        fontSize: 13,
    },
    startBtn: {
        background: 'linear-gradient(135deg,#6366f1,#4f46e5)',
        color: 'white',
        border: 'none',
        padding: '10px 22px',
        borderRadius: 10,
        fontWeight: 800,
        cursor: 'pointer',
        fontSize: 13,
        boxShadow: '0 4px 15px rgba(99,102,241,0.4)',
    },
    resetBtn: {
        background: 'rgba(16,185,129,0.1)',
        border: '1px solid #10b981',
        color: '#34d399',
        padding: '9px 18px',
        borderRadius: 9,
        cursor: 'pointer',
        fontWeight: 700,
        fontSize: 13,
    },
    // Session Info Bar
    sessionBar: {
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        background: 'rgba(99,102,241,0.05)',
        border: '1px solid rgba(99,102,241,0.2)',
        borderRadius: 12,
        padding: '14px 28px',
        marginBottom: 16,
    },
    sessionItem: { flex: 1, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' },
    sessionLabel: { fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 },
    sessionValue: { fontSize: 15, fontWeight: 800, color: '#e2e8f0' },
    sessionDivider: { width: 1, height: 40, background: 'rgba(255,255,255,0.08)', margin: '0 20px' },
    // Phase Timeline
    phaseTimeline: {
        marginTop: 16,
        background: 'rgba(0,0,0,0.2)',
        borderRadius: 10,
        padding: '12px 16px',
    },
    phaseTitle: { fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
    phaseRow: { display: 'flex', gap: 16 },
    // DOE Header
    doeHeader: {
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 14,
        padding: '18px 22px',
        marginBottom: 24,
    },
    doeHeaderTitle: {
        fontSize: 13,
        fontWeight: 700,
        color: '#94a3b8',
        marginBottom: 14,
        letterSpacing: 0.5,
        textTransform: 'uppercase',
    },
    doeGrid: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 },
    doeCard: {
        background: 'rgba(0,0,0,0.25)',
        borderRadius: 10,
        padding: '14px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        alignItems: 'center',
        textAlign: 'center',
    },
    // Progress
    globalProgressBar: {
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 10,
        padding: '12px 18px',
        marginBottom: 20,
    },
    progressBg: { background: 'rgba(0,0,0,0.3)', height: 8, borderRadius: 8, overflow: 'hidden' },
    progressFill: { height: '100%', borderRadius: 8, transition: 'width 0.4s ease' },
    // Cases
    casesContainer: { display: 'flex', flexDirection: 'column', gap: 16 },
    levelCard: {
        borderRadius: 14,
        padding: '22px 26px',
        boxShadow: '0 8px 25px rgba(0,0,0,0.2)',
        transition: 'all 0.3s ease',
    },
    cardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
    scoreBadge: {
        padding: '10px 18px',
        borderRadius: 12,
        textAlign: 'center',
        minWidth: 130,
        color: 'white',
    },
    resultSection: {
        display: 'grid',
        gridTemplateColumns: 'repeat(4,1fr)',
        gap: 20,
        paddingTop: 18,
        marginTop: 18,
        borderTop: '1px solid rgba(255,255,255,0.06)',
    },
    resultCol: { display: 'flex', flexDirection: 'column', gap: 7 },
    colTitle: {
        fontSize: 11,
        fontWeight: 800,
        color: '#94a3b8',
        marginBottom: 6,
        textTransform: 'uppercase',
        letterSpacing: 0.8,
    },
    metricRow: {
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: 13,
        color: '#cbd5e1',
        padding: '3px 0',
        borderBottom: '1px solid rgba(255,255,255,0.03)',
    },
    emptyState: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '55vh',
        color: '#64748b',
    },
    errorBanner: {
        background: 'rgba(239,68,68,0.1)',
        border: '1px solid #ef4444',
        color: '#fca5a5',
        padding: 16,
        borderRadius: 10,
        marginTop: 20,
        textAlign: 'center',
        fontWeight: 600,
    },
    // Export button
    exportBtn: {
        background: 'linear-gradient(135deg, #059669, #047857)',
        border: 'none',
        color: '#fff',
        padding: '10px 18px',
        borderRadius: 10,
        fontWeight: 800,
        fontSize: 13,
        boxShadow: '0 4px 15px rgba(5,150,105,0.35)',
        transition: 'all 0.2s',
        whiteSpace: 'nowrap',
    },
    exportProgressBox: {
        background: 'rgba(245,158,11,0.06)',
        border: '1px solid rgba(245,158,11,0.25)',
        borderRadius: 12,
        padding: '14px 20px',
        marginTop: 20,
        marginBottom: 8,
    },
};

export default NumericExperimentDashboard;
