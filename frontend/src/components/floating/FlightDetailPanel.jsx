import React from 'react';

const FlightDetailPanel = ({ flightId, activeAircraft }) => {
  const flight = activeAircraft.find((p) => p.id === flightId);

  if (!flight) {
    return (
      <div className="ct-panel-content" style={{ padding: "16px", color: "#cbd5e1" }}>
        Buscando información del vuelo...
      </div>
    );
  }

  return (
    <div className="ct-panel-content" style={{ padding: "16px", minWidth: "260px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px", borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: "8px" }}>
        <span style={{ color: "#94a3b8", fontSize: "11px", textTransform: "uppercase" }}>ID Vuelo</span>
        <span style={{ fontWeight: "bold", color: "#60a5fa", fontSize: "13px" }}>{flight.id.toString().replace("vuelo-", "").split("-")[0]}</span>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "18px", fontWeight: "bold", color: "#f8fafc" }}>{flight.from}</div>
          <div style={{ fontSize: "10px", color: "#94a3b8", textTransform: "uppercase" }}>Origen</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", color: "#475569" }}>
          ➔
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "18px", fontWeight: "bold", color: "#f8fafc" }}>{flight.to}</div>
          <div style={{ fontSize: "10px", color: "#94a3b8", textTransform: "uppercase" }}>Destino</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "12px" }}>
        <div style={{ background: "rgba(0,0,0,0.2)", padding: "8px", borderRadius: "6px" }}>
          <div style={{ fontSize: "10px", color: "#94a3b8", marginBottom: "4px" }}>Estado</div>
          <div style={{ fontSize: "12px", fontWeight: "bold", color: flight.status === 'cancelled' ? '#ef4444' : flight.status === 'rescued' ? '#3b82f6' : '#10b981' }}>
            {flight.status.toUpperCase()}
          </div>
        </div>
        <div style={{ background: "rgba(0,0,0,0.2)", padding: "8px", borderRadius: "6px" }}>
          <div style={{ fontSize: "10px", color: "#94a3b8", marginBottom: "4px" }}>Progreso</div>
          <div style={{ fontSize: "12px", fontWeight: "bold", color: "#f8fafc" }}>
            {Math.round((flight.progress ?? 0) * 100)}%
          </div>
        </div>
      </div>

      <div style={{ background: "rgba(16, 185, 129, 0.1)", border: "1px solid rgba(16, 185, 129, 0.2)", padding: "10px", borderRadius: "6px" }}>
        <div style={{ fontSize: "11px", color: "#34d399", fontWeight: "bold", marginBottom: "6px" }}>
          📦 Carga y Maletas (Estimado)
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#e2e8f0", marginBottom: "4px" }}>
          <span>Capacidad Total:</span>
          <span style={{ fontWeight: "bold" }}>~180 paxs</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#e2e8f0" }}>
          <span>Maletas Asignadas:</span>
          <span style={{ fontWeight: "bold" }}>~150 pcs</span>
        </div>
      </div>
    </div>
  );
};

export default FlightDetailPanel;
