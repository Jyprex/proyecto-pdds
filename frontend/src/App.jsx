import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import WorldMap from "./components/map/WorldMap";
import AirportDetailPanel from "./components/controlTower/AirportDetailPanel";

import ControlDock from "./components/controlTower/ControlDock";
import ScenarioHeader from "./components/controlTower/ScenarioHeader";
import TelemetryPanel from "./components/floating/TelemetryPanel";
import CapacityLegendPanel from "./components/floating/CapacityLegendPanel";
import TopAirportsPanel from "./components/floating/TopAirportsPanel";
import TransitInventoryPanel from "./components/floating/TransitInventoryPanel";
import AlgorithmComparisonPanel from "./components/floating/AlgorithmComparisonPanel";
import ShipmentDetailPanel from "./components/floating/ShipmentDetailPanel";
import ReportsPanel from "./components/floating/ReportsPanel";
import EntitiesListPanel from "./components/floating/EntitiesListPanel";
import FlightDetailPanel from "./components/floating/FlightDetailPanel";
import KpiStrip from "./components/kpi/KpiStrip";
import KpiControls from "./components/kpi/KpiControls";
import SimulationControls from "./components/kpi/SimulationControls";
import DayToDayConfig from "./components/scenarios/DayToDayConfig";
import PeriodSimConfig from "./components/scenarios/PeriodSimConfig";
import CollapseSimConfig from "./components/scenarios/CollapseSimConfig";
import DraggableWindow from "./components/common/DraggableWindow";
import AirportConfigPanel from "./components/floating/AirportConfigPanel";
import BloqueoPanel from "./components/floating/BloqueoPanel";
import { AIRPORTS } from "./data/airportsData";
import { useControlTowerController } from "./hooks/useControlTowerController";
import "./App.css";

const App = () => {
  const navigate = useNavigate();
  const {
    activeAircraft,
    activeAirportRows,
    activeMetrics,
    activeTab,
    airportByCode,
    airportNodes,
    comparisonData,
    elapsedOperationTime,
    eventLog,
    currentEpochTime,
    totalBagsWaiting,
    activeShipments,
    handleTabChange,
    hideAirportDetail,
    isAirportDetailOpen,
    isCollapseScenario,
    isDockCollapsed,
    isKpiCollapsed,
    isScenarioConfigOpen,
    isSimScenario,
    kpiCards,
    liveStatus,
    panelVisibility,
    selectedAircraftId,
    selectedAirport,
    selectedAirportCode,
    selectedAirportLevel,
    selectedAirportMetrics,
    selectedAlgorithm,
    selectedFromAirport,
    selectedToAirport,
    sessionId,
    isFluidMode,
    setIsFluidMode,
    searchShipment,
    searchedShipment,
    isSearching,
    setSelectedAircraftId,
    setSelectedAlgorithm,
    setSimSpeed,
    setSimState,
    showAirportDetail,
    simSpeed,
    simState,
    startSimulation,
    startDayToDaySimulation,
    startCollapseSimulation,
    exportSimulationExcel,
    exportSimulationReportMd,
    exportDetailedSimulationReport,
    resetSimulation,
    summary,
    tabs,
    toggleDock,
    toggleKpiStrip,
    togglePanel,
    toggleScenarioConfig,
  } = useControlTowerController();

  // ── Lógica FIFO de Paneles (Draggable Windows) ──
  const [maxWindows, setMaxWindows] = useState(1);
  const [openWindowsQueue, setOpenWindowsQueue] = useState([]);

  const handleToggleWindow = (panelKey) => {
    setOpenWindowsQueue(prev => {
      if (prev.includes(panelKey)) {
        return prev.filter(p => p !== panelKey); // Cerrar
      }
      const next = [...prev, panelKey];
      while (next.length > maxWindows) {
        next.shift(); // FIFO: remover el más antiguo
      }
      return next;
    });
  };

  // Traer la ventana al frente
  const handleFocusWindow = (panelKey) => {
    setOpenWindowsQueue(prev => {
      if (!prev.includes(panelKey)) return prev;
      return [...prev.filter(p => p !== panelKey), panelKey];
    });
  };

  const isWindowOpen = (panelKey) => openWindowsQueue.includes(panelKey);

  // Estados para controlar el Zoom y Pan del mapa
  const [mapZoom, setMapZoom] = useState(1);
  const [mapCenter, setMapCenter] = useState([0, 20]);

  const handleZoomIn = () => setMapZoom((z) => Math.min(z * 1.5, 8));
  const handleZoomOut = () => setMapZoom((z) => Math.max(z / 1.5, 1));
  const handleResetMap = () => {
    setMapZoom(1);
    setMapCenter([0, 20]);
  };

  // Estados para los paneles de reporte ejecutivo y totales consolidados
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isTotalsOpen, setIsTotalsOpen] = useState(false);
  const [isSecondaryPanelsOpen, setIsSecondaryPanelsOpen] = useState(false);
  const [reportText, setReportText] = useState("");
  const [reportLoading, setReportLoading] = useState(false);

  const fetchReportText = async () => {
    if (!sessionId) return;
    setReportLoading(true);
    try {
      const res = await fetch(`/api/v1/simulation/export-details/${sessionId}`);
      if (res.ok) {
        const txt = await res.text();
        setReportText(txt);
      } else {
        setReportText("No se pudo obtener el reporte de la sesión activa.");
      }
    } catch (err) {
      setReportText("Error al conectarse con el servidor para obtener el reporte.");
    } finally {
      setReportLoading(false);
    }
  };

  return (
    <div
      className={`control-tower ${isCollapseScenario ? "control-tower--collapse" : ""}`}
    >
      {/* ── Botón de Experimentación Numérica ─────────────────────────────── */}
      <button
        id="btn-experiment-nav"
        onClick={() => navigate('/experiment')}
        title="Ir al módulo de Experimentación Numérica"
        style={{
          position: 'fixed', top: 12, right: 16, zIndex: 9999,
          background: 'linear-gradient(90deg, #7c3aed, #4f46e5)',
          color: 'white', border: 'none', borderRadius: 8,
          padding: '7px 14px', cursor: 'pointer',
          fontSize: 12, fontWeight: 700, letterSpacing: 0.5,
          boxShadow: '0 4px 15px rgba(124,58,237,0.4)',
        }}
      >
        🧪 Experimentación Numérica
      </button>

      {/* ── Toggle de Modo Fluido ─────────────────────────────── */}
      <button
        onClick={() => setIsFluidMode(!isFluidMode)}
        title="Alternar entre modo rápido (original) y modo fluido (60 FPS - detallado)"
        style={{
          position: 'fixed', top: 12, right: 260, zIndex: 9999,
          background: isFluidMode ? 'linear-gradient(90deg, #10b981, #059669)' : 'linear-gradient(90deg, #6b7280, #4b5563)',
          color: 'white', border: 'none', borderRadius: 8,
          padding: '7px 14px', cursor: 'pointer',
          fontSize: 12, fontWeight: 700, letterSpacing: 0.5,
          boxShadow: isFluidMode ? '0 4px 15px rgba(16, 185, 129, 0.4)' : '0 4px 15px rgba(107, 114, 128, 0.4)',
        }}
      >
        {isFluidMode ? "✨ Modo Fluido (60 FPS) ON" : "⚡ Modo Rápido (Pruebas) ON"}
      </button>

      {/* ── Botón Global de Exportación (solo cuando termina la simulación) ── */}
      {(simState === "completed" || liveStatus?.status === "DONE") && (
        <button
          onClick={() => {
            const name = activeTab === 'vivo' ? 'Operacion_Dia_a_Dia' :
                         activeTab === 'periodo' ? 'Simulacion_Periodo' :
                                                   'Simulacion_Colapso';
            exportSimulationReportMd(sessionId, name);
          }}
          title="Exportar los resultados finales a Markdown (.md)"
          style={{
            position: 'fixed', top: 12, right: 460, zIndex: 9999,
            background: 'linear-gradient(90deg, #db2777, #be185d)',
            color: 'white', border: 'none', borderRadius: 8,
            padding: '7px 14px', cursor: 'pointer',
            fontSize: 12, fontWeight: 700, letterSpacing: 0.5,
            boxShadow: '0 4px 15px rgba(219, 39, 119, 0.4)',
          }}
        >
          📝 Descargar Reporte (.md)
        </button>
      )}

      <ScenarioHeader
        tabs={tabs}
        activeTab={activeTab}
        isCollapseScenario={isCollapseScenario}
        onTabChange={handleTabChange}
        systemClock={summary.systemClock}
        selectedAlgorithm={selectedAlgorithm}
        onAlgorithmChange={setSelectedAlgorithm}
        onSearch={searchShipment}
        isSearching={isSearching}
      />

      <div className="ct-kpi-region">
        <KpiStrip isCollapsed={isKpiCollapsed} kpiCards={kpiCards.map(kpi => {
          if (kpi.key === "progress" && activeTab === "vivo") {
            return {
              ...kpi,
              title: "Estado Operativo",
              value: "TRANSMISIÓN EN VIVO",
              subtitle: "Monitoreo continuo",
              progress: undefined
            };
          }
          return kpi;
        })} />
        <SimulationControls
          isVisible={isSimScenario || (activeTab === "vivo" && simState !== "idle")}
          simState={isCollapseScenario ? "collapsed" : simState}
          simulatedClock={summary.systemClock}
          elapsedReal={elapsedOperationTime}
          speed={simSpeed}
          onStart={() => setSimState("running")}
          onPause={() => setSimState("paused")}
          onStop={() => setSimState("idle")}
          onSpeedChange={setSimSpeed}
        />
        <KpiControls isCollapsed={isKpiCollapsed} onToggle={toggleKpiStrip} />
      </div>

      {/* ── Ventanas Flotantes Draggable ── */}
      {isWindowOpen("telemetry") && (
        <DraggableWindow title="Telemetría en Tiempo Real" onClose={() => handleToggleWindow("telemetry")} initialPosition={{x: 20, y: 150}} isActive={openWindowsQueue[openWindowsQueue.length-1] === "telemetry"} onFocus={() => handleFocusWindow("telemetry")}>
          <TelemetryPanel isVisible={true} summary={summary} elapsedOperationTime={elapsedOperationTime} onHide={() => handleToggleWindow("telemetry")} />
        </DraggableWindow>
      )}
      {isWindowOpen("occupancy") && (
        <DraggableWindow title="Top Aeropuertos" onClose={() => handleToggleWindow("occupancy")} initialPosition={{x: 50, y: 180}} isActive={openWindowsQueue[openWindowsQueue.length-1] === "occupancy"} onFocus={() => handleFocusWindow("occupancy")}>
          <TopAirportsPanel isVisible={true} airportRows={activeAirportRows} onHide={() => handleToggleWindow("occupancy")} />
        </DraggableWindow>
      )}
      {isWindowOpen("transitInventory") && (
        <DraggableWindow title="Inventario en Tránsito" onClose={() => handleToggleWindow("transitInventory")} initialPosition={{x: 80, y: 210}} isActive={openWindowsQueue[openWindowsQueue.length-1] === "transitInventory"} onFocus={() => handleFocusWindow("transitInventory")}>
          <TransitInventoryPanel isVisible={true} transitByContinent={summary.transitByContinent} onHide={() => handleToggleWindow("transitInventory")} />
        </DraggableWindow>
      )}
      {isWindowOpen("comparison") && (
        <DraggableWindow title="Comparativa de Envíos" onClose={() => handleToggleWindow("comparison")} initialPosition={{x: 110, y: 240}} isActive={openWindowsQueue[openWindowsQueue.length-1] === "comparison"} onFocus={() => handleFocusWindow("comparison")}>
          <AlgorithmComparisonPanel isVisible={true} onHide={() => handleToggleWindow("comparison")} sessionId={sessionId} comparisonData={comparisonData} />
        </DraggableWindow>
      )}
      {isWindowOpen("shipmentDetail") && (
        <DraggableWindow title="Envío y Despacho" onClose={() => handleToggleWindow("shipmentDetail")} initialPosition={{x: 140, y: 270}} isActive={openWindowsQueue[openWindowsQueue.length-1] === "shipmentDetail"} onFocus={() => handleFocusWindow("shipmentDetail")}>
          <ShipmentDetailPanel isVisible={true} onHide={() => handleToggleWindow("shipmentDetail")} searchedShipment={searchedShipment} />
        </DraggableWindow>
      )}
      {isWindowOpen("reports") && (
        <DraggableWindow title="Reportes y Exportación" onClose={() => handleToggleWindow("reports")} initialPosition={{x: window.innerWidth / 2 - 200, y: window.innerHeight / 2 - 150}} isActive={openWindowsQueue[openWindowsQueue.length-1] === "reports"} onFocus={() => handleFocusWindow("reports")}>
          <ReportsPanel />
        </DraggableWindow>
      )}

      {isWindowOpen("airportConfig") && (
        <DraggableWindow title="Configuración de Almacenes" onClose={() => handleToggleWindow("airportConfig")} initialPosition={{x: 200, y: 150}} isActive={openWindowsQueue[openWindowsQueue.length-1] === "airportConfig"} onFocus={() => handleFocusWindow("airportConfig")}>
          <AirportConfigPanel />
        </DraggableWindow>
      )}

      {isWindowOpen("bloqueos") && (
        <DraggableWindow title="Gestión de Bloqueos y Averías" onClose={() => handleToggleWindow("bloqueos")} initialPosition={{x: 240, y: 180}} isActive={openWindowsQueue[openWindowsQueue.length-1] === "bloqueos"} onFocus={() => handleFocusWindow("bloqueos")}>
          <BloqueoPanel />
        </DraggableWindow>
      )}

      {selectedAircraftId && (
        <DraggableWindow 
          title="Información del Vuelo" 
          onClose={() => setSelectedAircraftId(null)} 
          initialPosition={{x: window.innerWidth - 300, y: window.innerHeight - 300}} 
          isActive={true}
        >
          <FlightDetailPanel flightId={selectedAircraftId} activeAircraft={activeAircraft} />
        </DraggableWindow>
      )}

      <main className="ct-main">
        <section className="ct-map-area" aria-label="Mapa de operaciones">
          {liveStatus?.isCollapseMode && (
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, background: '#ef4444', color: 'white', textAlign: 'center', padding: '6px', fontWeight: 'bold', zIndex: 100, letterSpacing: '2px', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              ⚠️ MODO CRISIS: RESILIENCIA ALNS ACTIVA ⚠️
            </div>
          )}
          <WorldMap
            airports={airportNodes}
            activeMetrics={activeMetrics}
            activeAircraft={activeAircraft}
            airportByIcao={airportByCode}
            isCollapseScenario={isCollapseScenario}
            selectedAirportCode={selectedAirportCode}
            selectedFromAirport={selectedFromAirport}
            selectedToAirport={selectedToAirport}
            onAirportSelect={showAirportDetail}
            selectedAircraftId={selectedAircraftId}
            onAircraftSelect={setSelectedAircraftId}
            zoom={mapZoom}
            center={mapCenter}
            onMoveEnd={(position) => {
              setMapZoom(position.zoom);
              setMapCenter(position.coordinates);
            }}
            systemClock={summary.systemClock}
          />

          <DayToDayConfig
            isOpen={isScenarioConfigOpen && activeTab === "vivo"}
            onClose={toggleScenarioConfig}
            selectedAlgorithm={selectedAlgorithm}
            onAlgorithmChange={setSelectedAlgorithm}
            activeShipments={activeShipments}
            totalBagsWaiting={totalBagsWaiting}
            currentEpochTime={currentEpochTime}
            simState={simState}
            liveStatus={liveStatus}
            onStartDayToDay={startDayToDaySimulation}
            onReset={resetSimulation}
            sessionId={sessionId}
          />
          <PeriodSimConfig
            isOpen={isScenarioConfigOpen && activeTab === "periodo"}
            onClose={toggleScenarioConfig}
            selectedAlgorithm={selectedAlgorithm}
            onAlgorithmChange={setSelectedAlgorithm}
            onStart={(dias, startDate, preCancelledIds, startTime) => startDayToDaySimulation(startDate, dias, preCancelledIds, startTime)}
            liveStatus={liveStatus}
            simState={simState}
            sessionId={sessionId}
            onExportExcel={exportSimulationExcel}
            onExportMd={exportSimulationReportMd}
            onExportDetails={exportDetailedSimulationReport}
            onReset={resetSimulation}
          />
          <CollapseSimConfig
            isOpen={isScenarioConfigOpen && activeTab === "colapso"}
            onClose={toggleScenarioConfig}
            selectedAlgorithm={selectedAlgorithm}
            onAlgorithmChange={setSelectedAlgorithm}
            onStart={startCollapseSimulation}
            liveStatus={liveStatus}
            sessionId={sessionId}
            simState={simState}
          />

          <div className="ct-panel-stack ct-panel-stack--right">
            <AirportDetailPanel
              isOpen={isAirportDetailOpen}
              selectedAirport={selectedAirport}
              selectedAirportMetrics={selectedAirportMetrics}
              selectedAirportLevel={selectedAirportLevel}
              isCollapseScenario={isCollapseScenario}
              onClose={hideAirportDetail}
            />
          </div>

          <div className="ct-side-controls" aria-label="Controles del mapa">
            <button type="button" onClick={handleZoomIn} title="Acercar">+</button>
            <button type="button" onClick={handleZoomOut} title="Alejar">-</button>
            <button type="button" onClick={handleResetMap} title="Restablecer vista">◎</button>
            <button type="button" title="Mover mapa (Arrastrar)">✋</button>
          </div>
        </section>
      </main>

      <ControlDock
        isCollapsed={isDockCollapsed}
        isScenarioConfigOpen={isScenarioConfigOpen}
        panelVisibility={{
          telemetry: isWindowOpen("telemetry"),
          occupancy: isWindowOpen("occupancy"),
          transitInventory: isWindowOpen("transitInventory"),
          comparison: isWindowOpen("comparison"),
          shipmentDetail: isWindowOpen("shipmentDetail"),
          airportConfig: isWindowOpen("airportConfig"),
          bloqueos: isWindowOpen("bloqueos")
        }}
        onToggleScenarioConfig={toggleScenarioConfig}
        onTogglePanel={handleToggleWindow}
        onToggleDock={toggleDock}
        maxWindows={maxWindows}
        setMaxWindows={setMaxWindows}
      />

      {/* Sección de Paneles Desplegables en la parte inferior */}
      {sessionId && (
        <div className="ct-bottom-accordions" style={{
          padding: "10px 14px",
          background: "rgba(10, 25, 47, 0.95)",
          borderTop: "1px solid rgba(56, 189, 248, 0.2)",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          zIndex: 10
        }}>
          {/* Accordion 1: Reporte Ejecutivo */}
          <div style={{
            border: "1px solid rgba(96, 165, 250, 0.3)",
            borderRadius: "8px",
            background: "rgba(15, 23, 42, 0.6)",
            overflow: "hidden"
          }}>
            <button
              onClick={() => {
                const nextState = !isReportOpen;
                setIsReportOpen(nextState);
                if (nextState && !reportText) {
                  fetchReportText();
                }
              }}
              style={{
                width: "100%",
                padding: "12px 16px",
                background: "rgba(30, 41, 59, 0.5)",
                border: "none",
                color: "#93c5fd",
                fontWeight: "bold",
                textAlign: "left",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center"
              }}
            >
              <span>📋 PANEL DE REPORTE EJECUTIVO (.MD)</span>
              <span style={{ fontSize: "10px" }}>{isReportOpen ? "▲ OCULTAR" : "▼ EXTENDER"}</span>
            </button>
            {isReportOpen && (
              <div style={{ padding: "16px", background: "rgba(15, 23, 42, 0.8)" }}>
                {reportLoading ? (
                  <div style={{ color: "#94a3b8", fontSize: "12px" }}>Generando reporte ejecutivo...</div>
                ) : (
                  <pre style={{
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontFamily: "monospace",
                    fontSize: "12px",
                    color: "#e2e8f0",
                    background: "#0f172a",
                    padding: "16px",
                    borderRadius: "6px",
                    border: "1px solid rgba(255,255,255,0.05)",
                    maxHeight: "300px",
                    overflowY: "auto",
                    margin: 0
                  }}>
                    {reportText || "Ejecute y complete la simulación para visualizar el reporte."}
                  </pre>
                )}
              </div>
            )}
          </div>

          {/* Accordion 2: Consolidado de Métricas */}
          <div style={{
            border: "1px solid rgba(16, 185, 129, 0.3)",
            borderRadius: "8px",
            background: "rgba(15, 23, 42, 0.6)",
            overflow: "hidden"
          }}>
            <button
              onClick={() => setIsTotalsOpen(!isTotalsOpen)}
              style={{
                width: "100%",
                padding: "12px 16px",
                background: "rgba(30, 41, 59, 0.5)",
                border: "none",
                color: "#6ee7b7",
                fontWeight: "bold",
                textAlign: "left",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center"
              }}
            >
              <span>📈 CONSOLIDADO GENERAL Y MÉTRICAS TOTALES</span>
              <span style={{ fontSize: "10px" }}>{isTotalsOpen ? "▲ OCULTAR" : "▼ EXTENDER"}</span>
            </button>
            {isTotalsOpen && (
              <div style={{ padding: "16px", background: "rgba(15, 23, 42, 0.8)" }}>
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                  gap: "12px"
                }}>
                  <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: "6px", padding: "10px", textAlign: "center" }}>
                    <div style={{ fontSize: "10px", color: "#64748b", textTransform: "uppercase" }}>SLA Final</div>
                    <div style={{ fontSize: "20px", fontWeight: "bold", color: "#10b981", marginTop: "4px" }}>
                      {liveStatus?.slaPercent != null ? `${liveStatus.slaPercent.toFixed(2)}%` : "0.00%"}
                    </div>
                  </div>
                  <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: "6px", padding: "10px", textAlign: "center" }}>
                    <div style={{ fontSize: "10px", color: "#64748b", textTransform: "uppercase" }}>Total Envíos</div>
                    <div style={{ fontSize: "20px", fontWeight: "bold", color: "#60a5fa", marginTop: "4px" }}>
                      {((liveStatus?.totalAttended ?? 0) + (liveStatus?.totalMissed ?? 0)).toLocaleString("es-PE")}
                    </div>
                  </div>
                  <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: "6px", padding: "10px", textAlign: "center" }}>
                    <div style={{ fontSize: "10px", color: "#64748b", textTransform: "uppercase" }}>Atendidas</div>
                    <div style={{ fontSize: "20px", fontWeight: "bold", color: "#34d399", marginTop: "4px" }}>
                      {(liveStatus?.totalAttended ?? 0).toLocaleString("es-PE")}
                    </div>
                  </div>
                  <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: "6px", padding: "10px", textAlign: "center" }}>
                    <div style={{ fontSize: "10px", color: "#64748b", textTransform: "uppercase" }}>Perdidas (ECAP)</div>
                    <div style={{ fontSize: "20px", fontWeight: "bold", color: "#f43f5e", marginTop: "4px" }}>
                      {(liveStatus?.totalMissed ?? 0).toLocaleString("es-PE")}
                    </div>
                  </div>
                  <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: "6px", padding: "10px", textAlign: "center" }}>
                    <div style={{ fontSize: "10px", color: "#64748b", textTransform: "uppercase" }}>Vuelos Rescatados</div>
                    <div style={{ fontSize: "20px", fontWeight: "bold", color: "#3b82f6", marginTop: "4px" }}>
                      {liveStatus?.rescuedFlights ?? 0}
                    </div>
                  </div>
                  <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: "6px", padding: "10px", textAlign: "center" }}>
                    <div style={{ fontSize: "10px", color: "#64748b", textTransform: "uppercase" }}>Nodos Críticos</div>
                    <div style={{ fontSize: "20px", fontWeight: "bold", color: "#fbbf24", marginTop: "4px" }}>
                      {liveStatus?.criticalNodes ?? 0}
                    </div>
                  </div>
                  <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: "6px", padding: "10px", textAlign: "center" }}>
                    <div style={{ fontSize: "10px", color: "#64748b", textTransform: "uppercase" }}>Algoritmo</div>
                    <div style={{ fontSize: "18px", fontWeight: "bold", color: "#a78bfa", marginTop: "6px" }}>
                      {selectedAlgorithm?.toUpperCase() || "ALNS"}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Accordion 3: Paneles Secundarios de Análisis */}
          <div style={{
            border: "1px solid rgba(96, 165, 250, 0.3)",
            borderRadius: "8px",
            background: "rgba(15, 23, 42, 0.6)",
            overflow: "hidden"
          }}>
            <button
              onClick={() => setIsSecondaryPanelsOpen(!isSecondaryPanelsOpen)}
              style={{
                width: "100%",
                padding: "12px 16px",
                background: "rgba(30, 41, 59, 0.5)",
                border: "none",
                color: "#93c5fd",
                fontWeight: "bold",
                textAlign: "left",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center"
              }}
            >
              <span>📊 PANELES SECUNDARIOS DE ANÁLISIS (TELEMETRÍA, TOP AEROPUERTOS, LOGS)</span>
              <span style={{ fontSize: "10px" }}>{isSecondaryPanelsOpen ? "▲ OCULTAR" : "▼ EXTENDER"}</span>
            </button>
            {isSecondaryPanelsOpen && (
              <div style={{ padding: "16px", background: "rgba(15, 23, 42, 0.8)", display: "flex", flexWrap: "wrap", gap: "16px" }}>
                {eventLog && eventLog.length > 0 && (
                  <aside className="ct-panel ct-panel--event-log" style={{ maxHeight: '250px', overflowY: 'auto', background: 'rgba(15, 23, 42, 0.85)', minWidth: "300px", flex: "1 1 300px" }}>
                    <div className="ct-panel-header"><p>LOG DE EVENTOS</p></div>
                    <div style={{ padding: '0.75rem', fontSize: '11px', fontFamily: 'monospace', color: '#9ca3af', display: 'flex', flexDirection: 'column-reverse' }}>
                      {eventLog.map((log, i) => (
                        <div key={i} style={{ marginBottom: '6px', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '4px' }}>
                          {log.toString().replace(/vuelo-(\d+)(-\d+)?/gi, (match, id) => `Vuelo ${id}`)}
                        </div>
                      ))}
                    </div>
                  </aside>
                )}
                <EntitiesListPanel 
                  activeAircraft={activeAircraft} 
                  airports={AIRPORTS} 
                  airportMetrics={activeMetrics} 
                />
              </div>
            )}
          </div>
        </div>
      )}

      <footer
        className={`ct-footer ${isCollapseScenario ? "ct-footer--collapse" : ""}`}
      >
        <p>HORA DEL SISTEMA: {summary.systemClock}</p>
        <p>CAPACIDAD GLOBAL: {summary.globalCapacity}</p>
        <p>LATENCIA DE RED: {summary.networkLatency}</p>
        {isCollapseScenario ? (
          <p className="ct-footer-collapse-badge">
            ⚠ SISTEMA EN COLAPSO — 14/17 almacenes saturados
          </p>
        ) : (
          <p className="ct-footer-active">
            {summary.flightsInCourse.value} VUELOS EN CURSO
          </p>
        )}
      </footer>
    </div>
  );
};

export default App;
