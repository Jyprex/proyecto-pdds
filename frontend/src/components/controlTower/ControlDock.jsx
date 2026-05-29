const ControlDock = ({
  isCollapsed = false,
  isScenarioConfigOpen = false,
  onToggleDock = () => {},
  onTogglePanel = () => {},
  onToggleScenarioConfig = () => {},
  panelVisibility = {},
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
        className={panelVisibility.cancellation ? "active" : ""}
        aria-pressed={panelVisibility.cancellation}
        onClick={() => onTogglePanel("cancellation")}
      >
        Cancelación
      </button>
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
