const ControlDock = ({
  isCollapsed = false,
  isScenarioConfigOpen = false,
  onToggleDock = () => {},
  onTogglePanel = () => {},
  onToggleScenarioConfig = () => {},
  panelVisibility = {},
  maxWindows = 1,
  setMaxWindows = () => {}
}) => (
  <section
    className={`ct-dock ${isCollapsed ? "ct-dock--collapsed" : ""}`}
    aria-label="Centro de control inferior"
  >
    <div className="ct-dock-main" aria-label="Control de paneles">
      <button
        type="button"
        className="ct-dock-scenario-btn"
        onClick={onToggleScenarioConfig}
        aria-pressed={isScenarioConfigOpen}
      >
        ⚙ Escenario
      </button>
      <button
        type="button"
        className={panelVisibility.telemetry ? "active" : ""}
        aria-pressed={panelVisibility.telemetry}
        onClick={() => onTogglePanel("telemetry")}
      >
        Telemetría
      </button>
      <button
        type="button"
        className={panelVisibility.legend ? "active" : ""}
        aria-pressed={panelVisibility.legend}
        onClick={() => onTogglePanel("legend")}
      >
        Semáforo
      </button>
      <button
        type="button"
        className={panelVisibility.occupancy ? "active" : ""}
        aria-pressed={panelVisibility.occupancy}
        onClick={() => onTogglePanel("occupancy")}
      >
        Top aeropuertos
      </button>
      <button
        type="button"
        className={panelVisibility.transitInventory ? "active" : ""}
        aria-pressed={panelVisibility.transitInventory}
        onClick={() => onTogglePanel("transitInventory")}
      >
        Inventario
      </button>
      <button
        type="button"
        className={panelVisibility.comparison ? "active" : ""}
        aria-pressed={panelVisibility.comparison}
        onClick={() => onTogglePanel("comparison")}
      >
        Comparativa
      </button>
      <button
        type="button"
        className={panelVisibility.shipmentDetail ? "active" : ""}
        aria-pressed={panelVisibility.shipmentDetail}
        onClick={() => onTogglePanel("shipmentDetail")}
      >
        Envío
      </button>
      <button
        type="button"
        className={panelVisibility.airportConfig ? "active" : ""}
        aria-pressed={panelVisibility.airportConfig}
        onClick={() => onTogglePanel("airportConfig")}
      >
        🏢 Almacenes
      </button>
      <button
        type="button"
        className={panelVisibility.bloqueos ? "active" : ""}
        aria-pressed={panelVisibility.bloqueos}
        onClick={() => onTogglePanel("bloqueos")}
      >
        🚧 Bloqueos
      </button>
      <div style={{ width: "1px", height: "24px", background: "rgba(255,255,255,0.1)", margin: "0 4px" }} />
      <button
        type="button"
        className={panelVisibility.reports ? "active" : ""}
        aria-pressed={panelVisibility.reports}
        onClick={() => onTogglePanel("reports")}
      >
        📑 Reportes
      </button>

      <button
        type="button"
        style={{ color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)' }}
        onClick={() => {
          navigator.clipboard.writeText(window.location.href);
          alert("URL de la sesión copiada al portapapeles");
        }}
      >
        🔗 Compartir
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto', background: 'rgba(0,0,0,0.2)', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', color: '#cbd5e1' }}>
        <span>Max. Paneles:</span>
        <button type="button" onClick={() => setMaxWindows(Math.max(1, maxWindows - 1))} style={{ background: 'transparent', border: 'none', color: '#60a5fa', cursor: 'pointer', padding: '0 4px', fontSize: '14px' }}>-</button>
        <span style={{ fontWeight: 'bold', width: '12px', textAlign: 'center' }}>{maxWindows}</span>
        <button type="button" onClick={() => setMaxWindows(Math.min(5, maxWindows + 1))} style={{ background: 'transparent', border: 'none', color: '#60a5fa', cursor: 'pointer', padding: '0 4px', fontSize: '14px' }}>+</button>
      </div>
    </div>

    <button
      type="button"
      className="ct-dock-collapse-btn"
      aria-expanded={!isCollapsed}
      aria-label={
        isCollapsed ? "Mostrar barra inferior" : "Ocultar barra inferior"
      }
      onClick={onToggleDock}
    >
      {isCollapsed ? "↑" : "↓"}
    </button>
  </section>
);

export default ControlDock;
