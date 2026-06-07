function KpiControls({ isCollapsed, onToggle }) {
  return (
    <div
      className={`ct-kpi-controls ${
        isCollapsed ? 'ct-kpi-controls--collapsed' : 'ct-kpi-controls--expanded'
      }`}
      aria-label="Controles de resumen"
    >
      <button
        type="button"
        className="ct-kpi-controls-btn"
        aria-expanded={!isCollapsed}
        onClick={onToggle}
      >
        {isCollapsed ? 'Mostrar resumen' : 'Ocultar resumen'}
      </button>

      {/* Leyenda operativa integrada en los controles */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        fontSize: "10px",
        color: "#cbd5e1",
        fontFamily: "sans-serif",
        flexWrap: "wrap",
        marginLeft: "16px"
      }}>
        <span style={{ fontWeight: "bold", color: "#60a5fa" }}>🗺️ LEYENDA OPERATIVA:</span>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#10b981", border: "1px solid white" }}></span> Nodos Estables
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#f59e0b", border: "1px solid white" }}></span> Saturación Media
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#ef4444", border: "1px solid white" }}></span> Saturación Crítica
        </div>
        <div style={{ borderLeft: "1px solid rgba(255,255,255,0.2)", height: "10px", margin: "0 2px" }}></div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span style={{ width: "16px", height: "2px", background: "#10b981", boxShadow: "0 0 4px #10b981" }}></span> Vuelo Normal
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span style={{ width: "16px", height: "2px", background: "#f59e0b", boxShadow: "0 0 4px #f59e0b" }}></span> Vuelo Crítico
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span style={{ width: "16px", height: "2px", background: "#f43f5e", boxShadow: "0 0 4px #f43f5e" }}></span> Cancelado
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span style={{ width: "16px", height: "2px", background: "#3b82f6", boxShadow: "0 0 4px #3b82f6" }}></span> Rescatado
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span style={{ width: "16px", height: "2px", background: "#3b82f6", borderStyle: "dashed", opacity: 0.6 }}></span> Completado
        </div>
      </div>
    </div>
  )
}

export default KpiControls
