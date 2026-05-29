import React, { useState } from "react";

const FlightCancellationPanel = ({ isVisible, onHide, onCancelFlight }) => {
  const [flightId, setFlightId] = useState("");

  if (!isVisible) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (flightId.trim()) {
      onCancelFlight(flightId.trim());
      setFlightId("");
    }
  };

  return (
    <aside className="ct-panel ct-panel--cancellation">
      <div className="ct-panel-header">
        <p>CANCELACIÓN DE VUELO</p>
        <button type="button" className="ct-panel-close-btn" onClick={onHide} aria-label="Cerrar">
          ×
        </button>
      </div>
      <div className="ct-panel-body" style={{ padding: '1rem', color: '#e2e8f0' }}>
        <p style={{ fontSize: '0.8rem', marginBottom: '1rem' }}>
          Ingrese el ID del vuelo para cancelarlo. El sistema ejecutará el planificador ALNS automáticamente para intentar rescatar la carga asignada y cumplir el SLA.
        </p>
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '8px' }}>
          <input 
            type="number" 
            placeholder="ID del Vuelo" 
            value={flightId}
            onChange={(e) => setFlightId(e.target.value)}
            style={{ flex: 1, padding: '6px 8px', borderRadius: '4px', border: '1px solid #334155', background: '#0f172a', color: 'white' }}
          />
          <button 
            type="submit" 
            style={{ background: '#ef4444', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
            Cancelar Vuelo
          </button>
        </form>
      </div>
    </aside>
  );
};

export default FlightCancellationPanel;
