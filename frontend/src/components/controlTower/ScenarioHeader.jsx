import React from "react";
import { useNavigate } from "react-router-dom";

const ScenarioHeader = ({
  activeTab = "vivo",
  isCollapseScenario = false,
  onTabChange = () => {},
  tabs = [],
  systemClock = "--:--",
  realClock = "--:--",
  simulatedElapsed = "--:--",
  realTimeElapsed = "--:--",
}) => {
  const navigate = useNavigate();

  return (
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

      <div className="ct-header-actions">

        <div className={`ct-session ${isCollapseScenario ? "ct-session--danger" : ""}`} role="status">
          {isCollapseScenario ? "⚠ Modo Colapso" : "● Sesión Activa"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
          {realClock && realClock !== "--:--" && (
            <div style={{ display: "flex", alignItems: "center", gap: "2px", fontSize: "10px" }}>
              <span style={{ color: "#64748b", fontWeight: 600, whiteSpace: "nowrap" }}>Actual:</span>
              <span style={{ color: "#0f172a", fontWeight: 700, fontVariantNumeric: "tabular-nums", fontFamily: "monospace, monospace", whiteSpace: "nowrap", display: "inline-block" }}>
                {realClock}
              </span>
            </div>
          )}
          <span style={{ color: "#cbd5e1", fontSize: "10px", userSelect: "none" }}>|</span>
          {systemClock && systemClock !== "--:--" && systemClock !== "--:--:--" && (
            <div style={{ display: "flex", alignItems: "center", gap: "2px", fontSize: "10px" }}>
              <span style={{ color: "#0284c7", fontWeight: 600, whiteSpace: "nowrap" }}>
                {activeTab === "vivo" ? "UTC:" : "Simulada:"}
              </span>
              <span style={{ color: "#0c4a6e", fontWeight: 700, fontVariantNumeric: "tabular-nums", fontFamily: "monospace, monospace", whiteSpace: "nowrap", display: "inline-block" }}>
                {systemClock}
              </span>
            </div>
          )}
          <span style={{ color: "#cbd5e1", fontSize: "10px", userSelect: "none" }}>|</span>
          {simulatedElapsed && simulatedElapsed !== "00:00:00" && simulatedElapsed !== "--:--" && (
            <div style={{ display: "flex", alignItems: "center", gap: "2px", fontSize: "10px" }}>
              <span style={{ color: "#64748b", fontWeight: 600, whiteSpace: "nowrap" }}>T. simulado:</span>
              <span style={{ color: "#0f172a", fontWeight: 700, fontVariantNumeric: "tabular-nums", fontFamily: "monospace, monospace", whiteSpace: "nowrap", display: "inline-block" }}>
                {simulatedElapsed}
              </span>
            </div>
          )}
          <span style={{ color: "#cbd5e1", fontSize: "10px", userSelect: "none" }}>|</span>
          {realTimeElapsed && realTimeElapsed !== "00:00:00" && realTimeElapsed !== "--:--" && (
            <div style={{ display: "flex", alignItems: "center", gap: "2px", fontSize: "10px" }}>
              <span style={{ color: "#64748b", fontWeight: 600, whiteSpace: "nowrap" }}>T. real:</span>
              <span style={{ color: "#0f172a", fontWeight: 700, fontVariantNumeric: "tabular-nums", fontFamily: "monospace, monospace", whiteSpace: "nowrap", display: "inline-block" }}>
                {realTimeElapsed}
              </span>
            </div>
          )}
        </div>

        <button
          onClick={() => {
            sessionStorage.removeItem('userRole');
            navigate('/');
          }}
          style={{
            background: 'transparent',
            color: '#ef4444',
            border: '1px solid rgba(239, 68, 68, 0.5)',
            borderRadius: '4px',
            padding: '2px 8px',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: '10px',
            transition: 'all 0.2s',
            marginLeft: '6px'
          }}
          onMouseEnter={(e) => {
            e.target.style.color = '#ffffff';
            e.target.style.background = '#ef4444';
            e.target.style.borderColor = '#ef4444';
          }}
          onMouseLeave={(e) => {
            e.target.style.color = '#ef4444';
            e.target.style.background = 'transparent';
            e.target.style.borderColor = 'rgba(239, 68, 68, 0.5)';
          }}
        >
          Cerrar Sesión
        </button>
      </div>
    </header>
  );
};

export default ScenarioHeader;
