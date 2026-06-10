import React from 'react';

function ShipmentDetailPanel({ isVisible, onHide, searchedShipment }) {
  if (!isVisible) {
    return null
  }

  const s = searchedShipment;

  return (
    <aside className="ct-panel ct-panel--shipment" aria-label="Detalle de envío">
      <div className="ct-panel-header">
        <p>DETALLE DE ENVÍO {s?.isLocal ? '⚡ ACTIVO' : '🏛️ HISTÓRICO'}</p>
        <button type="button" className="ct-panel-close" onClick={onHide}>
          Ocultar
        </button>
      </div>

      {!s ? (
        <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8' }}>
          Ingrese un ID en el buscador superior para ver detalles.
        </div>
      ) : (
        <div className="ct-shipment-detail">
          <div className="ct-shipment-detail__summary">
            <div className="ct-shipment-detail__field">
              <span>ID Envío</span>
              <strong style={{ color: '#60a5fa' }}>{s.id}</strong>
            </div>
            <div className="ct-shipment-detail__field">
              <span>Ruta</span>
              <strong>{s.origin} → {s.destination}</strong>
            </div>
            <div className="ct-shipment-detail__field">
              <span>Maletas</span>
              <strong>{s.totalBags || '—'}</strong>
            </div>
            <div className="ct-shipment-detail__field">
              <span>Estado</span>
              <strong className={s.status === 'cancelled' ? 'ct-text-red' : 'ct-text-amber'}>
                {s.status?.toUpperCase()}
              </strong>
            </div>
            <div className="ct-shipment-detail__field">
              <span>Llegada</span>
              <strong>{s.arrival ? new Date(s.arrival).toLocaleString() : '—'}</strong>
            </div>
          </div>

          {s.route && s.route.length > 0 && (
            <div className="ct-config-section">
              <p className="ct-config-section__title">🗺️ PLAN DE VIAJE</p>
              <div className="ct-travel-plan">
                {s.route.map((hop, i) => (
                  <div key={i} className="ct-travel-stop">
                    <div className="ct-travel-stop__dot" />
                    <div className="ct-travel-stop__info">
                      <strong>Vuelo: {hop.id}</strong>
                      <span>Tramo: {hop.from} → {hop.to}</span>
                      <span>Dep: {hop.dep} | Arr: {hop.arr}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {!s.isLocal && (
            <div style={{ marginTop: '12px', fontSize: '10px', color: '#94a3b8', fontStyle: 'italic', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '8px' }}>
              * Este envío ya no está en la telemetría activa. Datos obtenidos del servidor.
            </div>
          )}
        </div>
      )}
    </aside>
  )
}

export default ShipmentDetailPanel;
