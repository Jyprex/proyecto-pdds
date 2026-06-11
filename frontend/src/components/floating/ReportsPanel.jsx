import React, { useState } from "react";

const ReportsPanel = ({
  sessionId,
  selectedAlgorithm = "alns",
  exportSimulationExcel = () => {},
  exportDetailedSimulationReport = () => {},
}) => {
  const [activeTab, setActiveTab] = useState("ejecutivo");

  const downloadExecutiveReport = () => {
    if (!sessionId) return;
    exportDetailedSimulationReport(sessionId);
  };

  const downloadConsolidated = () => {
    if (!sessionId) return;
    exportSimulationExcel(sessionId, selectedAlgorithm);
  };

  const hasNoSession = !sessionId;

  return (
    <div className="ct-panel-content" style={{ padding: "16px", minWidth: "300px" }}>
      
      {/* Selector de Pestañas (Tabs) */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px", borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: "8px" }}>
        <button 
          onClick={() => setActiveTab("ejecutivo")}
          style={{
            flex: 1, padding: "8px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: "bold", fontSize: "12px",
            background: activeTab === "ejecutivo" ? "rgba(59, 130, 246, 0.2)" : "transparent",
            color: activeTab === "ejecutivo" ? "#60a5fa" : "#94a3b8",
            transition: "all 0.2s"
          }}
        >
          Reporte Ejecutivo
        </button>
        <button 
          onClick={() => setActiveTab("consolidado")}
          style={{
            flex: 1, padding: "8px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: "bold", fontSize: "12px",
            background: activeTab === "consolidado" ? "rgba(16, 185, 129, 0.2)" : "transparent",
            color: activeTab === "consolidado" ? "#34d399" : "#94a3b8",
            transition: "all 0.2s"
          }}
        >
          Consolidado General
        </button>
      </div>

      {/* Alerta de sesión inactiva */}
      {hasNoSession && (
        <div style={{
          padding: "10px 12px",
          borderRadius: "6px",
          background: "rgba(239, 68, 68, 0.1)",
          border: "1px solid rgba(239, 68, 68, 0.2)",
          color: "#f87171",
          fontSize: "11px",
          lineHeight: "1.4",
          marginBottom: "16px"
        }}>
          ⚠️ <strong>Sesión Inactiva:</strong> Inicie un escenario desde el menú de configuración (⚙) para habilitar las descargas de reportes reales del backend.
        </div>
      )}

      {/* Contenido de la pestaña activa */}
      {activeTab === "ejecutivo" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <p style={{ fontSize: "12px", color: "#cbd5e1", margin: 0, lineHeight: "1.5" }}>
            Genera un documento Markdown detallado con el resumen narrativo de la simulación. 
            Incluye métricas operativas y análisis de embotellamientos.
          </p>
          <button 
            onClick={downloadExecutiveReport}
            disabled={hasNoSession}
            style={{
              padding: "10px", borderRadius: "8px", border: "none",
              background: hasNoSession 
                ? "rgba(255,255,255,0.08)" 
                : "linear-gradient(90deg, #db2777, #be185d)",
              color: hasNoSession ? "#64748b" : "white",
              fontWeight: "bold", fontSize: "13px", 
              cursor: hasNoSession ? "not-allowed" : "pointer",
              boxShadow: hasNoSession ? "none" : "0 4px 15px rgba(219, 39, 119, 0.3)",
              transition: "all 0.2s"
            }}
          >
            📝 Descargar .MD
          </button>
        </div>
      )}

      {activeTab === "consolidado" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <p style={{ fontSize: "12px", color: "#cbd5e1", margin: 0, lineHeight: "1.5" }}>
            Exporta una sábana de datos completa. Incluye el detalle de todos los vuelos, 
            maletas atendidas, cancelaciones y reacomodaciones por evento.
          </p>
          <button 
            onClick={downloadConsolidated}
            disabled={hasNoSession}
            style={{
              padding: "10px", borderRadius: "8px", border: "none",
              background: hasNoSession 
                ? "rgba(255,255,255,0.08)" 
                : "linear-gradient(90deg, #059669, #047857)",
              color: hasNoSession ? "#64748b" : "white",
              fontWeight: "bold", fontSize: "13px", 
              cursor: hasNoSession ? "not-allowed" : "pointer",
              boxShadow: hasNoSession ? "none" : "0 4px 15px rgba(5, 150, 105, 0.3)",
              transition: "all 0.2s"
            }}
          >
            📊 Descargar CSV / Excel
          </button>
        </div>
      )}
    </div>
  );
};

export default ReportsPanel;
