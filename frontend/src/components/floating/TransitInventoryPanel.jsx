import React from 'react';

const TransitInventoryPanel = React.memo(({ isVisible, transitByContinent, onHide }) => {
  if (!isVisible) {
    return null
  }

  return (
    <aside className="ct-panel ct-panel--transit">
      <div className="ct-panel-header">
        <p>INVENTARIO EN TRÁNSITO</p>
        <button
          type="button"
          className="ct-panel-close"
          onClick={onHide}
        >
          Ocultar
        </button>
      </div>
      <div className="ct-transit-summary ct-transit-summary--panel">
        <p>CONSOLIDADO GLOBAL DE LA RED</p>
        <small className="ct-transit-context">
          Conteo agregado de maletas activas en vuelo y escala (no por avión individual)
        </small>
        <div>
          <span>América: {transitByContinent.america.toLocaleString('es-PE')} maletas</span>
          <span>Europa: {transitByContinent.europe.toLocaleString('es-PE')} maletas</span>
          <span>Asia: {transitByContinent.asia.toLocaleString('es-PE')} maletas</span>
        </div>
      </div>
    </aside>
  )
});

export default TransitInventoryPanel
