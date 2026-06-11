import React from 'react';

const REPLAN_HISTORY = [
  { date: '2026-04-09 18:42', reason: 'Cancelación vuelo BOG→MEX', oldRoute: 'LIM→BOG→MEX→MAD', newRoute: 'LIM→BOG→IAD→LHR→MAD' },
]

const STATUS_LABELS = {
  normal: "En tránsito",
  high: "Carga alta",
  critical: "Crítico",
  blocked: "Bloqueado",
  rescued: "Rescatado",
  cancelled: "Cancelado",
};

function ShipmentDetailPanel({ isVisible, onHide, searchedShipment, selectedAircraft = null, airportByCode = {} }) {      
  if (!isVisible) {
    return null
  }

  const fromAirport = selectedAircraft ? airportByCode[selectedAircraft.from] : null;
  const toAirport = selectedAircraft ? airportByCode[selectedAircraft.to] : null;
  const routeLabel = selectedAircraft ? `${selectedAircraft.from} → ${selectedAircraft.to}` : "--";
  const statusLabel = selectedAircraft
    ? (STATUS_LABELS[selectedAircraft.status] ?? selectedAircraft.status ?? "En tránsito")
    : "--";
  const progressPct = selectedAircraft
    ? Math.round((selectedAircraft.progress ?? 0) * 100)
    : 0;
  const travelPlan = selectedAircraft ? [
    {
      airport: selectedAircraft.from,
      arrived: "—",
      departed: "—",
      status: progressPct > 10 ? "completado" : "en escala",
    },
    {
      airport: selectedAircraft.to,
      arrived: "—",
      departed: "—",
      status: progressPct > 85 ? "en escala" : "pendiente",
    },
  ] : [];
  const showMockHistory = !selectedAircraft;
  const s = searchedShipment;

  return (
    <aside className="ct-panel ct-panel--shipment" aria-label="Detalle de envío">
      <div className="ct-panel-header">
        <p>DETALLE DE ENVÍO {s?.isLocal ? '⚡ ACTIVO' : '🏛️ HISTÓRICO'}</p>
        <button type="button" className="ct-panel-close" onClick={onHide}>
          Ocultar
        </button>
      </div>

      {!s && !selectedAircraft ? (
        <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8' }}>
          Ingrese un ID en el buscador superior o seleccione un vuelo en el mapa para ver detalles.
        </div>
      ) : (
        <div className="ct-shipment-detail">
          <div className="ct-shipment-detail__summary">
            <div className="ct-shipment-detail__field">
              <span>ID Envío / Vuelo</span>
              <strong style={{ color: '#60a5fa' }}>{s?.id || selectedAircraft?.id}</strong>
            </div>
            <div className="ct-shipment-detail__field">
              <span>Ruta</span>
              <strong>{s ? `${s.origin} → ${s.destination}` : routeLabel}</strong>
            </div>
            <div className="ct-shipment-detail__field">
              <span>Maletas / Capacidad</span>
              <strong>{s?.totalBags || '—'}</strong>
            </div>
            <div className="ct-shipment-detail__field">
              <span>Estado</span>
              <strong className={s?.status === 'cancelled' || selectedAircraft?.status === 'cancelled' ? 'ct-text-red' : 'ct-text-amber'}>
                {s ? s.status?.toUpperCase() : statusLabel}
              </strong>
            </div>
            <div className="ct-shipment-detail__field">
              <span>Llegada</span>
              <strong>{s?.arrival ? new Date(s.arrival).toLocaleString() : '—'}</strong>
            </div>
          </div>

          {s?.route && s.route.length > 0 && (
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

          {selectedAircraft && !s && (
            <div className="ct-config-section">
              <p className="ct-config-section__title">🗺️ PLAN DE VIAJE</p>
              <div className="ct-travel-plan">
                {travelPlan.map((stop, i) => (
                  <div key={i} className={`ct-travel-stop ct-travel-stop--${stop.status === 'completado' ? 'done' : stop.status === 'en escala' ? 'current' : 'pending'}`}>
                    <div className="ct-travel-stop__dot" />
                    <div className="ct-travel-stop__info">
                      <strong>{stop.airport}</strong>
                      <span>Llegada: {stop.arrived}</span>
                      <span>Salida: {stop.departed}</span>
                    </div>
                    <span className={`ct-travel-stop__status ct-travel-stop__status--${stop.status === 'completado' ? 'done' : stop.status === 'en escala' ? 'current' : 'pending'}`}>
                      {stop.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {s && !s.isLocal && (
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