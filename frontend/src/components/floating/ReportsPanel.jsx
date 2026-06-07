import React, { useState } from "react";

const ReportsPanel = () => {
  const [activeTab, setActiveTab] = useState("ejecutivo");

  const downloadExecutiveReport = () => {
    // Aquí podrías agregar la lógica real de descarga del MD
    alert("Iniciando descarga del Reporte Ejecutivo .md...");
  };

  const downloadConsolidated = () => {
    // Lógica para exportar consolidado
    alert("Iniciando descarga del Consolidado General...");
  };

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

      {/* Contenido de la pestaña activa */}
      {activeTab === "ejecutivo" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <p style={{ fontSize: "12px", color: "#cbd5e1", margin: 0, lineHeight: "1.5" }}>
            Genera un documento Markdown detallado con el resumen narrativo de la simulación. 
            Incluye métricas operativas y análisis de embotellamientos.
          </p>
          <button 
            onClick={downloadExecutiveReport}
            style={{
              padding: "10px", borderRadius: "8px", border: "none",
              background: "linear-gradient(90deg, #db2777, #be185d)", color: "white",
              fontWeight: "bold", fontSize: "13px", cursor: "pointer",
              boxShadow: "0 4px 15px rgba(219, 39, 119, 0.3)"
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
            style={{
              padding: "10px", borderRadius: "8px", border: "none",
              background: "linear-gradient(90deg, #059669, #047857)", color: "white",
              fontWeight: "bold", fontSize: "13px", cursor: "pointer",
              boxShadow: "0 4px 15px rgba(5, 150, 105, 0.3)"
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
