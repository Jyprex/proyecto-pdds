import React, { useState } from 'react';

const statusColor = {
  cancelled: '#ef4444',
  rescued: '#3b82f6',
  critical: '#f97316',
  normal: '#10b981',
};

const FlightDetailPanel = ({ flightId, activeAircraft, sessionId }) => {
  const flight = activeAircraft.find((p) => p.id === flightId);
  const [cancelling, setCancelling] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [error, setError] = useState(null);

  if (!flight) {
    return (
      <div className="ct-panel-content" style={{ padding: '16px', color: '#cbd5e1' }}>
        Buscando información del vuelo...
      </div>
    );
  }

  const flightNumericId = flight.id.toString().replace('vuelo-', '').split('-')[0];

  // B12: Cancelación en vivo
  const handleCancelFlight = async () => {
    if (!window.confirm(`¿Confirmar cancelación del Vuelo ${flightNumericId}?\nSe activará replanificación ALNS automática.`)) return;
    setCancelling(true);
    setError(null);
    try {
      const url = sessionId
        ? `/api/v1/simulation/cancel-flight/${sessionId}/${flightNumericId}`
        : `/api/v1/simulation/cancel-flight/${flightNumericId}`;
      const res = await fetch(url, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.status === 'ok') {
        setCancelled(true);
      } else {
        setError(data.message || 'Error al cancelar');
      }
    } catch (e) {
      setError('Error de conexión con el servidor');
    } finally {
      setCancelling(false);
    }
  };

  const isCancelled = cancelled || flight.status === 'cancelled';
  const progress = Math.round((flight.progress ?? 0) * 100);
  const capacityPct = flight.capacityPercent?.toFixed(1) ?? '—';
  const color = statusColor[flight.status] ?? '#10b981';

  return (
    <div className="ct-panel-content" style={{ padding: '16px', minWidth: '280px', maxWidth: '320px' }}>

      {/* Header: ID y ruta */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px' }}>
        <span style={{ color: '#94a3b8', fontSize: '11px', textTransform: 'uppercase' }}>ID Vuelo</span>
        <span style={{ fontWeight: 'bold', color: '#60a5fa', fontSize: '14px' }}>#{flightNumericId}</span>
      </div>

      {/* Origen → Destino */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#f8fafc', letterSpacing: '1px' }}>{flight.from}</div>
          <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase' }}>Origen</div>
        </div>
        <div style={{ color: '#475569', fontSize: '18px' }}>✈</div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#f8fafc', letterSpacing: '1px' }}>{flight.to}</div>
          <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase' }}>Destino</div>
        </div>
      </div>

      {/* Estado + Progreso */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
        <div style={{ background: 'rgba(0,0,0,0.25)', padding: '10px', borderRadius: '8px', borderLeft: `3px solid ${color}` }}>
          <div style={{ fontSize: '10px', color: '#94a3b8', marginBottom: '4px' }}>Estado</div>
          <div style={{ fontSize: '12px', fontWeight: 'bold', color }}>{(flight.status || 'normal').toUpperCase()}</div>
        </div>
        <div style={{ background: 'rgba(0,0,0,0.25)', padding: '10px', borderRadius: '8px' }}>
          <div style={{ fontSize: '10px', color: '#94a3b8', marginBottom: '4px' }}>Progreso</div>
          <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#f8fafc' }}>{progress}%</div>
        </div>
      </div>

      {/* Barra de progreso */}
      <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: '4px', height: '4px', marginBottom: '14px', overflow: 'hidden' }}>
        <div style={{ width: `${progress}%`, height: '100%', background: isCancelled ? '#ef4444' : '#3b82f6', transition: 'width 0.5s ease', borderRadius: '4px' }} />
      </div>

      {/* Carga */}
      <div style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '10px 12px', borderRadius: '8px', marginBottom: '14px' }}>
        <div style={{ fontSize: '11px', color: '#34d399', fontWeight: 'bold', marginBottom: '8px' }}>📦 Capacidad de Carga</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#e2e8f0', marginBottom: '4px' }}>
          <span>Ocupación:</span>
          <span style={{ fontWeight: 'bold', color: parseFloat(capacityPct) < 50 ? '#f97316' : '#10b981' }}>{capacityPct}%</span>
        </div>
        <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '4px', height: '4px', overflow: 'hidden' }}>
          <div style={{ width: `${Math.min(100, parseFloat(capacityPct) || 0)}%`, height: '100%', background: parseFloat(capacityPct) < 50 ? '#f97316' : '#10b981', borderRadius: '4px' }} />
        </div>
      </div>

      {/* B12: Botón cancelación en vivo */}
      {!isCancelled ? (
        <button
          onClick={handleCancelFlight}
          disabled={cancelling}
          style={{
            width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.5)',
            background: cancelling ? 'rgba(239,68,68,0.1)' : 'rgba(239,68,68,0.15)',
            color: '#fca5a5', fontSize: '12px', fontWeight: 'bold', cursor: cancelling ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s', letterSpacing: '0.5px',
          }}
          onMouseEnter={e => { if (!cancelling) e.target.style.background = 'rgba(239,68,68,0.3)'; }}
          onMouseLeave={e => { e.target.style.background = cancelling ? 'rgba(239,68,68,0.1)' : 'rgba(239,68,68,0.15)'; }}
        >
          {cancelling ? '⏳ Cancelando...' : '⛔ Cancelar Vuelo (Replanificar)'}
        </button>
      ) : (
        <div style={{ padding: '10px', borderRadius: '8px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', textAlign: 'center', fontSize: '12px', color: '#fca5a5', fontWeight: 'bold' }}>
          🚨 VUELO CANCELADO — ALNS en ejecución
        </div>
      )}

      {error && (
        <div style={{ marginTop: '8px', padding: '8px', borderRadius: '6px', background: 'rgba(239,68,68,0.1)', color: '#fca5a5', fontSize: '11px', textAlign: 'center' }}>
          ⚠️ {error}
        </div>
      )}
    </div>
  );
};

export default FlightDetailPanel;
