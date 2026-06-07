const ScenarioHeader = ({
  activeTab = "vivo",
  isCollapseScenario = false,
  onTabChange = () => {},
  tabs = [],
  systemClock = "--:--:--",
  selectedAlgorithm = "hga",
  onAlgorithmChange = () => {}
}) => (
  <header className="ct-header">
    <div className="ct-brand">
      <p className="ct-title">Control Tower</p>
      <nav className="ct-tabs" aria-label="Escenarios de operación">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`ct-tab ${activeTab === tab.key ? "ct-tab--active" : ""} ${tab.key === "colapso" ? "ct-tab--danger" : ""}`}
            type="button"
            onClick={() => onTabChange(tab.key)}
          >
            {tab.key === "colapso" && "⚠ "}
            {tab.label}
          </button>
        ))}
      </nav>
    </div>

    <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: "8px", background: "rgba(15, 23, 42, 0.6)", padding: "4px 8px", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.05)" }}>
      <span style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" }}>Algoritmo:</span>
      <div style={{ display: "flex", gap: "4px" }}>
        <button
          onClick={() => onAlgorithmChange("alns")}
          style={{
            background: selectedAlgorithm === "alns" ? "#10b981" : "transparent",
            color: selectedAlgorithm === "alns" ? "white" : "#cbd5e1",
            border: "none", borderRadius: "6px", padding: "4px 10px",
            fontSize: "12px", fontWeight: "bold", cursor: "pointer",
            transition: "all 0.2s"
          }}
        >
          ALNS
        </button>
        <button
          onClick={() => onAlgorithmChange("hga")}
          style={{
            background: selectedAlgorithm === "hga" ? "#3b82f6" : "transparent",
            color: selectedAlgorithm === "hga" ? "white" : "#cbd5e1",
            border: "none", borderRadius: "6px", padding: "4px 10px",
            fontSize: "12px", fontWeight: "bold", cursor: "pointer",
            transition: "all 0.2s"
          }}
        >
          HGA
        </button>
      </div>
    </div>

    {/* Reloj del Sistema Digital en la cabecera - Altamente visible y premium */}
    {systemClock && systemClock !== "--:--:--" && (
      <div className="ct-system-clock-badge" style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        background: "rgba(15, 23, 42, 0.75)",
        border: isCollapseScenario ? "1px dashed rgba(239, 68, 68, 0.5)" : "1px solid rgba(96, 165, 250, 0.4)",
        borderRadius: "8px",
        padding: "6px 14px",
        color: isCollapseScenario ? "#f43f5e" : "#60a5fa",
        fontFamily: "'Courier New', Courier, monospace",
        fontSize: "13px",
        fontWeight: "bold",
        boxShadow: isCollapseScenario ? "0 0 10px rgba(239, 68, 68, 0.2)" : "0 0 10px rgba(96, 165, 250, 0.2)",
        letterSpacing: "0.5px",
        backdropFilter: "blur(4px)"
      }}>
        <span style={{ animation: "pulse 2s infinite" }}>🕒</span>
        <span>RELOJ: {systemClock}</span>
      </div>
    )}

    <div className="ct-header-actions">
      <div
        className={`ct-session ${isCollapseScenario ? "ct-session--danger" : ""}`}
      >
        {isCollapseScenario ? "⚠ Modo Colapso" : "Sesión Activa"}
      </div>
      <button type="button" className="ct-icon-btn" aria-label="Métricas">
        <span className="ct-icon-bars" />
      </button>
      <button type="button" className="ct-icon-btn" aria-label="Bandeja">
        <span className="ct-icon-inbox" />
      </button>
      <button type="button" className="ct-icon-btn" aria-label="Perfil">
        <span className="ct-icon-user" />
      </button>
    </div>
  </header>
);

export default ScenarioHeader;
