import React from "react";

const ScenarioHeader = ({
  activeTab = "vivo",
  isCollapseScenario = false,
  onTabChange = () => {},
  tabs = [],
  systemClock = "--:--:--",
  selectedAlgorithm = "hga",
  onAlgorithmChange = () => {},
  onSearch = () => {},
  isSearching = false
}) => {
  const [searchValue, setSearchValue] = React.useState("");

  const handleSearch = (e) => {
    e.preventDefault();
    onSearch(searchValue);
  };

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

      <form onSubmit={handleSearch} style={{ position: "relative", marginLeft: "20px" }}>
        <input 
          type="text" 
          placeholder="Buscar envío o maleta ID..." 
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          style={{
            background: "rgba(15, 23, 42, 0.6)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "6px",
            padding: "6px 12px",
            paddingRight: "30px",
            color: "white",
            fontSize: "12px",
            width: "200px",
            outline: "none"
          }}
        />
        <button 
          type="submit"
          disabled={isSearching}
          style={{
            position: "absolute",
            right: "8px",
            top: "50%",
            transform: "translateY(-50%)",
            background: "transparent",
            border: "none",
            color: "#94a3b8",
            cursor: "pointer"
          }}
        >
          {isSearching ? "⏳" : "🔍"}
        </button>
      </form>

      <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: "8px", background: "rgba(15, 23, 42, 0.6)", padding: "4px 8px", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.05)" }}>
        <span style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" }}>Algoritmo:</span>
        <div style={{ display: "flex", gap: "4px" }}>
          <button
            onClick={() => onAlgorithmChange("alns")}
            style={{
              background: selectedAlgorithm === "alns" ? "#10b981" : "transparent",
              color: selectedAlgorithm === "alns" ? "white" : "#cbd5e1",
              border: "none", borderRadius: "6px", padding: "4px 10px",
              fontSize: "12px", fontWeight: "bold", cursor: "pointer"
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
              fontSize: "12px", fontWeight: "bold", cursor: "pointer"
            }}
          >
            HGA
          </button>
        </div>
      </div>

      <div className="ct-header-actions">
        <div className={`ct-session ${isCollapseScenario ? "ct-session--danger" : ""}`}>
          {isCollapseScenario ? "⚠ Modo Colapso" : "Sesión Activa"}
        </div>
        {systemClock && systemClock !== "--:--:--" && (
          <div style={{ color: "#60a5fa", fontSize: "12px", fontWeight: "bold", fontFamily: "monospace", marginLeft: "10px" }}>
            🕒 {systemClock}
          </div>
        )}
      </div>
    </header>
  );
};

export default ScenarioHeader;
