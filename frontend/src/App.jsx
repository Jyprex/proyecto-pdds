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
import FlightCancellationPanel from "./components/floating/FlightCancellationPanel";
import KpiStrip from "./components/kpi/KpiStrip";
import KpiControls from "./components/kpi/KpiControls";
import SimulationControls from "./components/kpi/SimulationControls";
import DayToDayConfig from "./components/scenarios/DayToDayConfig";
import PeriodSimConfig from "./components/scenarios/PeriodSimConfig";
import CollapseSimConfig from "./components/scenarios/CollapseSimConfig";
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
    handleSelectAircraft,
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
    selectedAircraft,
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
    setSelectedAircraftId,
    setSelectedAlgorithm,
    setSimSpeed,
    setSimState,
    showAirportDetail,
    simSpeed,
    simState,
    startDayToDaySimulation,
    startCollapseSimulation,
    exportSimulationExcel,
    exportSimulationReportMd,
    resetSimulation,
    summary,
    tabs,
    toggleDock,
    toggleKpiStrip,
    togglePanel,
    toggleScenarioConfig,
    cancelFlight,
  } = useControlTowerController();

  const [mapZoom, setMapZoom] = useState(1);
  const [mapCenter, setMapCenter] = useState([0, 20]);

  const handleZoomIn = () => setMapZoom((z) => Math.min(z * 1.5, 8));
  const handleZoomOut = () => setMapZoom((z) => Math.max(z / 1.5, 1));
  const handleResetMap = () => {
    setMapZoom(1);
    setMapCenter([0, 20]);
  };

  return (
    <div
      className={`control-tower ${isCollapseScenario ? "control-tower--collapse" : ""}`}
    >
      {/* EXPERIMENTAL MODE - DISABLED FOR BUSINESS UI
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
      */}

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
      />

      <div className="ct-kpi-region">
        <KpiStrip isCollapsed={isKpiCollapsed} kpiCards={kpiCards} />
        <SimulationControls
          isVisible={isSimScenario}
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
            onAircraftSelect={handleSelectAircraft}
            showCityLabels={activeAircraft.length < 80}
            zoom={mapZoom}
            center={mapCenter}
            onMoveEnd={(position) => {
              setMapZoom(position.zoom);
              setMapCenter(position.coordinates);
            }}
            currentEpochTime={currentEpochTime}
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
          />
          <PeriodSimConfig
            isOpen={isScenarioConfigOpen && activeTab === "periodo"}
            onClose={toggleScenarioConfig}
            selectedAlgorithm={selectedAlgorithm}
            onAlgorithmChange={setSelectedAlgorithm}
            onStart={(dias, startDate) => startDayToDaySimulation(startDate, dias)}
            liveStatus={liveStatus}
            simState={simState}
            sessionId={sessionId}
            onExportExcel={exportSimulationExcel}
            onExportMd={exportSimulationReportMd}
            onReset={resetSimulation}
          />
          <CollapseSimConfig
            isOpen={isScenarioConfigOpen && activeTab === "colapso"}
            onClose={toggleScenarioConfig}
            selectedAlgorithm={selectedAlgorithm}
            onAlgorithmChange={setSelectedAlgorithm}
            onStart={startCollapseSimulation}
            liveStatus={liveStatus}
            onReset={resetSimulation}
          />

          <div className="ct-floating-rail ct-floating-rail--left">
            <TelemetryPanel
              isVisible={panelVisibility.telemetry}
              summary={summary}
              elapsedOperationTime={elapsedOperationTime}
              onHide={() => togglePanel("telemetry")}
            />
            <TransitInventoryPanel
              isVisible={panelVisibility.transitInventory}
              transitByContinent={summary.transitByContinent}
              onHide={() => togglePanel("transitInventory")}
            />
            <FlightCancellationPanel
              isVisible={panelVisibility.cancellation}
              onHide={() => togglePanel("cancellation")}
              onCancelFlight={cancelFlight}
            />
            {eventLog && eventLog.length > 0 && (
              <aside className="ct-panel ct-panel--event-log" style={{ maxHeight: '200px', overflowY: 'auto', background: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(8px)', marginTop: '8px' }}>
                <div className="ct-panel-header"><p>LOG DE EVENTOS</p></div>
                <div style={{ padding: '0.75rem', fontSize: '11px', fontFamily: 'monospace', color: '#9ca3af', display: 'flex', flexDirection: 'column-reverse' }}>
                  {eventLog.map((log, i) => (
                    <div key={i} style={{ marginBottom: '6px', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '4px' }}>{log}</div>
                  ))}
                </div>
              </aside>
            )}
          </div>

          <div className="ct-panel-stack ct-panel-stack--right">
            <AirportDetailPanel
              isOpen={isAirportDetailOpen}
              selectedAirport={selectedAirport}
              selectedAirportMetrics={selectedAirportMetrics}
              selectedAirportLevel={selectedAirportLevel}
              isCollapseScenario={isCollapseScenario}
              onClose={hideAirportDetail}
            />

            <div className="ct-floating-rail ct-floating-rail--right">
              <CapacityLegendPanel
                isVisible={panelVisibility.legend}
                onHide={() => togglePanel("legend")}
              />
              <TopAirportsPanel
                isVisible={panelVisibility.occupancy}
                airportRows={activeAirportRows}
                onHide={() => togglePanel("occupancy")}
              />
              {/* EXPERIMENTAL MODE - DISABLED FOR BUSINESS UI
              <AlgorithmComparisonPanel
                isVisible={panelVisibility.comparison}
                onHide={() => togglePanel("comparison")}
                sessionId={sessionId}
                comparisonData={comparisonData}
              />
              */}
              <ShipmentDetailPanel
                isVisible={panelVisibility.shipmentDetail}
                onHide={() => togglePanel("shipmentDetail")}
                selectedAircraft={selectedAircraft}
                airportByCode={airportByCode}
              />
            </div>
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
        panelVisibility={panelVisibility}
        onToggleScenarioConfig={toggleScenarioConfig}
        onTogglePanel={togglePanel}
        onToggleDock={toggleDock}
      />

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