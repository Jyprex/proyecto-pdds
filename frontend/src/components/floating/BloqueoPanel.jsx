import React, { useState, useEffect, useCallback } from 'react';
import { useSelectionBridge } from '../../hooks/useSelectionBridge';

const AVERIA_TIPOS = [
  { value: 1, label: 'Tipo 1 — Capacidad al 50%', desc: 'El almacén del nodo opera al 50% de su capacidad máxima', color: '#f59e0b' },
  { value: 2, label: 'Tipo 2 — Cierre de Origen', desc: 'Cancela todos los vuelos que salen del nodo durante el período', color: '#f97316' },
  { value: 3, label: 'Tipo 3 — Demora de Tránsito', desc: 'Duplica el tiempo de tránsito del tramo afectado', color: '#ef4444' },
  { value: 4, label: 'Tipo 4 — Corte Total de Tramo', desc: 'Bloquea completamente el tramo origen→destino', color: '#1e1b4b' },
];

const fieldStyle = {
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: '6px',
  color: '#f1f5f9',
  padding: '6px 10px',
  fontSize: '12px',
  width: '100%',
  boxSizing: 'border-box',
  outline: 'none',
};

const labelStyle = {
  fontSize: '10px',
  color: '#94a3b8',
  textTransform: 'uppercase',
  marginBottom: '3px',
  display: 'block',
};

const TAB_COLORS = { TRAMO: '#f59e0b', NODO: '#3b82f6', AVERIA: '#ef4444' };
const TAB_ICONS  = { TRAMO: '🔒', NODO: '🏚️', AVERIA: '⚠️' };

/** B05/B06/B07-B10: Panel unificado de Bloqueos y Averías con vinculación al mapa */
const BloqueoPanel = ({ activeAircraft = [] }) => {
  const [activeTab, setActiveTab] = useState('TRAMO');
  const [bloqueos, setBloqueos] = useState([]);
  const [form, setForm] = useState({
    tipo: 'TRAMO',
    origenIcao: '',
    destinoIcao: '',
    inicio: '',
    fin: '',
    capacidadReducidaPct: 50,
    averiaType: 1,
    descripcion: '',
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [expandedBloqueo, setExpandedBloqueo] = useState(null);

  // ── Selection Bridge para interacción con el mapa ────────────────────────
  const {
    setExceptionHighlight,
    dispatchMapCommand,
    setFocusedEntity,
  } = useSelectionBridge();

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/bloqueos');
      if (res.ok) setBloqueos(await res.json());
    } catch { /* noop */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setForm(f => ({ ...f, tipo: tab }));
    setMsg(null);
  };

  const handleChange = (field, value) => setForm(f => ({ ...f, [field]: value }));

  const handleSubmit = async () => {
    if (!form.origenIcao.trim()) { setMsg({ type: 'err', text: 'El ICAO de origen es obligatorio' }); return; }
    if (form.tipo === 'TRAMO' && !form.destinoIcao.trim()) { setMsg({ type: 'err', text: 'El ICAO de destino es obligatorio para TRAMO' }); return; }
    if (!form.inicio || !form.fin) { setMsg({ type: 'err', text: 'Las fechas de inicio y fin son obligatorias' }); return; }
    setSaving(true);
    setMsg(null);
    try {
      const body = {
        tipo: form.tipo,
        origenIcao: form.origenIcao.toUpperCase().trim(),
        destinoIcao: form.tipo === 'TRAMO' || form.tipo === 'AVERIA' && form.averiaType === 4
          ? form.destinoIcao.toUpperCase().trim() || null
          : null,
        inicio: new Date(form.inicio).toISOString(),
        fin: new Date(form.fin).toISOString(),
        capacidadReducidaPct: form.tipo === 'AVERIA' ? parseInt(form.capacidadReducidaPct, 10) : null,
        averiaType: form.tipo === 'AVERIA' ? parseInt(form.averiaType, 10) : null,
        descripcion: form.descripcion || null,
      };
      const res = await fetch('/api/v1/bloqueos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setMsg({ type: 'ok', text: `✅ Bloqueo de ${form.tipo} registrado correctamente` });
        setForm(f => ({ ...f, origenIcao: '', destinoIcao: '', inicio: '', fin: '', descripcion: '' }));
        await load();
      } else {
        const err = await res.json().catch(() => ({}));
        setMsg({ type: 'err', text: `❌ Error: ${err.message || res.status}` });
      }
    } catch {
      setMsg({ type: 'err', text: '❌ Error de conexión con el servidor' });
    } finally {
      setSaving(false);
    }
  };

  const handleDesactivar = async (id) => {
    await fetch(`/api/v1/bloqueos/${id}/desactivar`, { method: 'PATCH' });
    await load();
  };

  // ── Paso 5: Enfocar bloqueo en el mapa ──────────────────────────────────
  const handleFocusBloqueo = useCallback((bloqueo) => {
    // 1. Enviar highlight de excepción al mapa
    setExceptionHighlight({
      type: bloqueo.tipo,
      origenIcao: bloqueo.origenIcao,
      destinoIcao: bloqueo.destinoIcao || null,
      averiaType: bloqueo.averiaType || null,
      ts: Date.now(),
    });

    // 2. Hacer flyTo al nodo de origen
    // Necesitamos las coordenadas — las obtenemos del lookup global
    import('../../data/airportsData').then(({ AIRPORT_BY_ICAO }) => {
      const airport = AIRPORT_BY_ICAO[bloqueo.origenIcao];
      if (airport) {
        dispatchMapCommand('flyTo', {
          coordinates: airport.coordinates,
          zoom: 4,
          targetId: bloqueo.origenIcao,
        });
      }
    });

    // 3. Expandir para mostrar vuelos afectados
    setExpandedBloqueo(expandedBloqueo === bloqueo.id ? null : bloqueo.id);
  }, [setExceptionHighlight, dispatchMapCommand, expandedBloqueo]);

  // ── Paso 5: Vuelos afectados por un bloqueo ─────────────────────────────
  const getAffectedFlights = useCallback((bloqueo) => {
    if (!activeAircraft || activeAircraft.length === 0) return [];
    return activeAircraft.filter(f => {
      if (f.status === 'cancelled') return false;
      if (bloqueo.tipo === 'TRAMO') {
        return f.from === bloqueo.origenIcao && f.to === bloqueo.destinoIcao;
      }
      if (bloqueo.tipo === 'NODO') {
        return f.from === bloqueo.origenIcao || f.to === bloqueo.origenIcao;
      }
      if (bloqueo.tipo === 'AVERIA') {
        if (parseInt(bloqueo.averiaType) === 2) {
          return f.from === bloqueo.origenIcao; // Cierre de origen
        }
        if (parseInt(bloqueo.averiaType) === 4 && bloqueo.destinoIcao) {
          return f.from === bloqueo.origenIcao && f.to === bloqueo.destinoIcao;
        }
        return f.from === bloqueo.origenIcao || f.to === bloqueo.origenIcao;
      }
      return false;
    });
  }, [activeAircraft]);

  const filteredBloqueos = bloqueos.filter(b => b.tipo === activeTab && b.activo);
  const color = TAB_COLORS[activeTab];

  return (
    <div style={{ padding: '16px', minWidth: '360px', maxWidth: '440px' }}>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '14px' }}>
        {['TRAMO', 'NODO', 'AVERIA'].map(tab => (
          <button key={tab} onClick={() => handleTabChange(tab)}
            style={{ flex: 1, padding: '7px 4px', borderRadius: '7px', fontSize: '11px', fontWeight: 'bold',
              cursor: 'pointer', transition: 'all 0.15s',
              border: activeTab === tab ? `1px solid ${TAB_COLORS[tab]}50` : '1px solid rgba(255,255,255,0.08)',
              background: activeTab === tab ? `${TAB_COLORS[tab]}18` : 'rgba(255,255,255,0.03)',
              color: activeTab === tab ? TAB_COLORS[tab] : '#64748b' }}>
            {TAB_ICONS[tab]} {tab}
          </button>
        ))}
      </div>

      {/* Descripción del tab */}
      <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '12px' }}>
        {activeTab === 'TRAMO' && 'B05 · Bloquea un tramo origen→destino por período'}
        {activeTab === 'NODO'  && 'B06 · Bloquea un aeropuerto/nodo completo por período'}
        {activeTab === 'AVERIA' && 'B07-B10 · Aplica avería con efecto sobre la red'}
      </div>

      {msg && (
        <div style={{ padding: '8px 12px', borderRadius: '6px', marginBottom: '10px', fontSize: '12px',
          background: msg.type === 'ok' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
          color: msg.type === 'ok' ? '#34d399' : '#fca5a5',
          border: `1px solid ${msg.type === 'ok' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}` }}>
          {msg.text}
        </div>
      )}

      {/* Formulario */}
      <div style={{ background: 'rgba(0,0,0,0.15)', borderRadius: '8px', padding: '12px', marginBottom: '14px', border: `1px solid ${color}20` }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
          <div>
            <label style={labelStyle}>ICAO Origen *</label>
            <input style={fieldStyle} placeholder="Ej: SBBR" maxLength={4}
              value={form.origenIcao} onChange={e => handleChange('origenIcao', e.target.value.toUpperCase())} />
          </div>
          {(activeTab === 'TRAMO' || (activeTab === 'AVERIA' && form.averiaType === 4)) && (
            <div>
              <label style={labelStyle}>ICAO Destino {activeTab === 'TRAMO' ? '*' : ''}</label>
              <input style={fieldStyle} placeholder="Ej: LDZA" maxLength={4}
                value={form.destinoIcao} onChange={e => handleChange('destinoIcao', e.target.value.toUpperCase())} />
            </div>
          )}
        </div>

        {activeTab === 'AVERIA' && (
          <>
            <div style={{ marginBottom: '8px' }}>
              <label style={labelStyle}>Tipo de Avería</label>
              <select style={fieldStyle} value={form.averiaType} onChange={e => handleChange('averiaType', e.target.value)}>
                {AVERIA_TIPOS.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <div style={{ fontSize: '10px', color: '#64748b', marginTop: '4px' }}>
                {AVERIA_TIPOS.find(t => t.value === parseInt(form.averiaType))?.desc}
              </div>
            </div>
            {parseInt(form.averiaType) === 1 && (
              <div style={{ marginBottom: '8px' }}>
                <label style={labelStyle}>Capacidad Reducida (%)</label>
                <input type="range" min="10" max="90" step="5" style={{ width: '100%' }}
                  value={form.capacidadReducidaPct} onChange={e => handleChange('capacidadReducidaPct', e.target.value)} />
                <div style={{ fontSize: '11px', color: '#f97316', textAlign: 'center' }}>{form.capacidadReducidaPct}% de capacidad</div>
              </div>
            )}
          </>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
          <div>
            <label style={labelStyle}>Inicio *</label>
            <input type="datetime-local" style={fieldStyle} value={form.inicio} onChange={e => handleChange('inicio', e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Fin *</label>
            <input type="datetime-local" style={fieldStyle} value={form.fin} onChange={e => handleChange('fin', e.target.value)} />
          </div>
        </div>

        <div style={{ marginBottom: '10px' }}>
          <label style={labelStyle}>Descripción (opcional)</label>
          <input style={fieldStyle} placeholder="Ej: Tormenta eléctrica, mantenimiento..." value={form.descripcion} onChange={e => handleChange('descripcion', e.target.value)} />
        </div>

        <button onClick={handleSubmit} disabled={saving}
          style={{ width: '100%', padding: '9px', borderRadius: '7px', border: `1px solid ${color}50`,
            background: `${color}18`, color, fontSize: '12px', fontWeight: 'bold',
            cursor: saving ? 'not-allowed' : 'pointer' }}>
          {saving ? '⏳ Registrando...' : `${TAB_ICONS[activeTab]} Registrar ${activeTab}`}
        </button>
      </div>

      {/* Lista de bloqueos activos con interacción al mapa */}
      <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '6px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {activeTab}S ACTIVOS ({filteredBloqueos.length})
      </div>
      <div style={{ maxHeight: '280px', overflowY: 'auto' }}>
        {filteredBloqueos.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '20px', color: '#475569', fontSize: '12px' }}>
            Sin bloqueos de tipo {activeTab} activos
          </div>
        ) : (
          filteredBloqueos.map(b => {
            const isExpanded = expandedBloqueo === b.id;
            const affectedFlights = isExpanded ? getAffectedFlights(b) : [];
            const averiaColor = b.averiaType
              ? AVERIA_TIPOS.find(t => t.value === parseInt(b.averiaType))?.color || color
              : color;

            return (
              <div key={b.id} style={{
                borderRadius: '6px', marginBottom: '4px',
                background: 'rgba(255,255,255,0.04)', border: `1px solid ${averiaColor}30`,
                overflow: 'hidden',
              }}>
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '8px 10px', cursor: 'pointer' }}
                  onClick={() => handleFocusBloqueo(b)}
                >
                  <div>
                    <span style={{ fontWeight: 'bold', color: averiaColor, fontSize: '12px' }}>
                      {b.origenIcao}{b.destinoIcao ? ` → ${b.destinoIcao}` : ''}
                      {b.averiaType ? ` · T${b.averiaType}` : ''}
                    </span>
                    <div style={{ fontSize: '10px', color: '#64748b' }}>
                      {new Date(b.inicio).toLocaleDateString()} → {new Date(b.fin).toLocaleDateString()}
                    </div>
                    {b.descripcion && <div style={{ fontSize: '10px', color: '#94a3b8', fontStyle: 'italic' }}>{b.descripcion}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <span style={{ fontSize: '9px', color: '#64748b' }}>📍 Ver en mapa</span>
                    <button onClick={(e) => { e.stopPropagation(); handleDesactivar(b.id); }}
                      style={{ padding: '3px 8px', borderRadius: '5px', border: '1px solid rgba(239,68,68,0.3)',
                        background: 'rgba(239,68,68,0.1)', color: '#fca5a5', fontSize: '11px', cursor: 'pointer' }}>
                      ✕
                    </button>
                  </div>
                </div>

                {/* Paso 5: Lista de vuelos afectados */}
                {isExpanded && (
                  <div style={{ background: 'rgba(0,0,0,0.2)', padding: '8px 10px', borderTop: `1px solid ${averiaColor}20` }}>
                    <div style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 'bold', marginBottom: '6px', textTransform: 'uppercase' }}>
                      ✈ Vuelos afectados ({affectedFlights.length})
                    </div>
                    {affectedFlights.length > 0 ? affectedFlights.slice(0, 8).map(f => {
                      const fId = f.id?.toString().replace("vuelo-", "").split("-")[0];
                      return (
                        <div
                          key={f.id}
                          style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', padding: '3px 0', color: '#cbd5e1', cursor: 'pointer', borderBottom: '1px dashed rgba(255,255,255,0.05)' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setFocusedEntity('flight', f.id, 'panel');
                          }}
                        >
                          <span>Vuelo {fId}: {f.from} → {f.to}</span>
                          <span style={{ color: statusColor(f.status), textTransform: 'uppercase', fontWeight: 'bold' }}>{f.status}</span>
                        </div>
                      );
                    }) : (
                      <div style={{ fontSize: '10px', color: '#475569', fontStyle: 'italic' }}>
                        No hay vuelos activos en este tramo/nodo en este momento.
                      </div>
                    )}
                    {affectedFlights.length > 8 && (
                      <div style={{ fontSize: '9px', color: '#475569', marginTop: '4px' }}>
                        ... y {affectedFlights.length - 8} más
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

const statusColor = (status) => {
  switch (status) {
    case 'cancelled': return '#ef4444';
    case 'critical': return '#f59e0b';
    case 'rescued': return '#3b82f6';
    default: return '#10b981';
  }
};

export default BloqueoPanel;
