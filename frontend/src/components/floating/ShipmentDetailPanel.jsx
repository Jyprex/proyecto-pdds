const MOCK_PLAN = [
  { airport: 'LIM', arrived: '2026-04-09 08:00', departed: '2026-04-09 08:25', status: 'completado' },
  { airport: 'BOG', arrived: '2026-04-09 14:30', departed: '2026-04-09 14:55', status: 'completado' },
  { airport: 'IAD', arrived: '2026-04-10 02:10', departed: '2026-04-10 02:35', status: 'completado' },
  { airport: 'LHR', arrived: '2026-04-10 14:00', departed: '—', status: 'en escala' },
  { airport: 'MAD', arrived: '—', departed: '—', status: 'pendiente' },
]

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

function ShipmentDetailPanel({ isVisible, onHide, selectedAircraft = null, airportByCode = {} }) {
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
  ] : MOCK_PLAN;
  const showMockHistory = !selectedAircraft;

  return (
    <aside className="ct-panel ct-panel--shipment" aria-label="Detalle de envío">
      <div className="ct-panel-header">
        <p>DETALLE DE ENVÍO</p>
        <button type="button" className="ct-panel-close" onClick={onHide}>
          Ocultar
        </button>
      </div>

      <div className="ct-shipment-detail">
        {!selectedAircraft && (
          <p style={{ marginBottom: 10, fontSize: 12, color: "#9ca3af" }}>
            Selecciona un vuelo en el mapa para ver su ruta y progreso.
          </p>
        )}
        <div className="ct-shipment-detail__summary">
          <div className="ct-shipment-detail__field">
            <span>ID Envío</span>
            <strong>{selectedAircraft?.id ?? "—"}</strong>
          </div>
          <div className="ct-shipment-detail__field">
            <span>Origen</span>
            <strong>{fromAirport?.city ?? selectedAircraft?.from ?? "—"}</strong>
          </div>
          <div className="ct-shipment-detail__field">
            <span>Destino</span>
            <strong>{toAirport?.city ?? selectedAircraft?.to ?? "—"}</strong>
          </div>
          <div className="ct-shipment-detail__field">
            <span>Ruta</span>
            <strong>{routeLabel}</strong>
          </div>
          <div className="ct-shipment-detail__field">
            <span>Estado</span>
            <strong className="ct-text-amber">{statusLabel}</strong>
          </div>
          <div className="ct-shipment-detail__field">
            <span>Progreso</span>
            <strong>{selectedAircraft ? `${progressPct}%` : "—"}</strong>
          </div>
        </div>

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

        {showMockHistory && REPLAN_HISTORY.length > 0 && (
          <div className="ct-config-section">
            <p className="ct-config-section__title">🔄 HISTORIAL REPLANIFICACIÓN</p>
            {REPLAN_HISTORY.map((r, i) => (
              <div key={i} className="ct-replan-entry">
                <span className="ct-replan-entry__date">{r.date}</span>
                <p className="ct-replan-entry__reason">{r.reason}</p>
                <div className="ct-replan-entry__routes">
                  <span className="ct-replan-entry__old">❌ {r.oldRoute}</span>
                  <span className="ct-replan-entry__new">✅ {r.newRoute}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}

export default ShipmentDetailPanel
