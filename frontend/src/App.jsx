import React, { useState } from "react";
import { useSelectionBridge } from "./hooks/useSelectionBridge";
import { useToast } from "./hooks/useToast";
import WorldMap from "./components/map/WorldMap";

import ControlDock from "./components/controlTower/ControlDock";
import ScenarioHeader from "./components/controlTower/ScenarioHeader";
import TelemetryPanel from "./components/floating/TelemetryPanel";
import TopAirportsPanel from "./components/floating/TopAirportsPanel";
import TransitInventoryPanel from "./components/floating/TransitInventoryPanel";
import AlgorithmComparisonPanel from "./components/floating/AlgorithmComparisonPanel";
import ShipmentDetailPanel from "./components/floating/ShipmentDetailPanel";
import AirportDetailPanel from "./components/floating/AirportDetailPanel";
import CancellationPanel from "./components/scenarios/CancellationPanel";
import ReportsPanel from "./components/floating/ReportsPanel";
import EntitiesListPanel from "./components/floating/EntitiesListPanel";
import TrackingPanel from "./components/floating/TrackingPanel";
import ShipmentsPanel from "./components/floating/ShipmentsPanel";
import UpcomingFlightsPanel from "./components/floating/UpcomingFlightsPanel";
import FinalPlanPanel from "./components/floating/FinalPlanPanel";
import MergedShipmentPanel from "./components/floating/MergedShipmentPanel";

import DayToDayConfig from "./components/scenarios/DayToDayConfig";
import PeriodSimConfig from "./components/scenarios/PeriodSimConfig";
import CollapseSimConfig from "./components/scenarios/CollapseSimConfig";
import DraggableWindow from "./components/common/DraggableWindow";
import AirportConfigPanel from "./components/floating/AirportConfigPanel";
import PendingShipmentsPanel from "./components/scenarios/PendingShipmentsPanel";
import { useAirports } from "./hooks/useAirports";
import { useControlTowerController } from "./hooks/useControlTowerController";
import "./App.css";

// Etiquetas legibles para notificar el cierre de paneles por límite FIFO.
const PANEL_LABELS = {
  tracking: "Seguimiento de Rutas",
  cancellation: "Cancelaciones",
  telemetry: "Telemetría en Tiempo Real",
  occupancy: "Top Aeropuertos",
  transitInventory: "Inventario en Tránsito",
  shipmentDetail: "Detalle de Envío",
  shipments: "Gestión de Envíos",
  upcoming: "Vuelos Próximos",
  airportConfig: "Configuración de Almacenes",
  entities: "Monitoreo de Vuelos y Almacenes",
  pendingShipments: "Envíos Pendientes",
  finalPlan: "Plan Final de la Simulación",
};

const App = () => {
  const toast = useToast();
  const {
    activeAircraft,
    activeAirportRows,
    activeMetrics,
    activeTab,
    airportByCode,
    airportNodes,
    comparisonData,
    elapsedOperationTime,
    currentEpochTime,
    totalBagsWaiting,
    activeShipments,
    handleTabChange,
    isCollapseScenario,
    isDockCollapsed,
    isKpiCollapsed,
    isScenarioConfigOpen,
    isSimScenario,
    kpiCards,
    liveStatus,
    selectedAircraftId,
    selectedAirportCode,
    setSelectedAirportCode,
    selectedFromAirport,
    selectedToAirport,
    selectedAlgorithm,
    sessionId,
    setSelectedAlgorithm,
    simState,
    targetPlaybackMinutes,
    setTargetPlaybackMinutes,
    searchShipment,
    searchedShipment,
    isSearching,
    setSelectedAircraftId,
    startDayToDaySimulation,
    startCollapseSimulation,
    exportSimulationExcel,
    exportSimulationReportMd,
    exportDetailedSimulationReport,
    resetSimulation,
    cancelledFlights,
    addCancelledFlight,
    summary,
    tabs,
    toggleDock,
    toggleKpiStrip,
    toggleScenarioConfig,
    trackedRouteData,
    masterPlan,
  } = useControlTowerController();
  
  const { airports: globalAirports } = useAirports();

  // ── Paso 4: Sincronizar Track & Trace con el SelectionBridge ──
  const { setTrackedRoute, clearFocusedEntity } = useSelectionBridge();
  React.useEffect(() => {
    if (trackedRouteData) {
      setTrackedRoute(trackedRouteData);
    }
  }, [trackedRouteData, setTrackedRoute]);

  const currentFlight = activeAircraft.find(p => p.id === selectedAircraftId) ?? null;

  const [dismissedInitOverlay, setDismissedInitOverlay] = useState(false)

  const [finalPlanShownSession, setFinalPlanShownSession] = useState(null);



  // ── Lógica FIFO de Paneles (Draggable Windows) ──
  const [maxWindows, setMaxWindows] = useState(3);
  const [openWindowsQueue, setOpenWindowsQueue] = useState([]);

  const handleToggleWindow = (panelKey) => {
    // Si ya está abierto, lo cerramos (toggle) sin notificar.
    if (openWindowsQueue.includes(panelKey)) {
      setOpenWindowsQueue(prev => prev.filter(p => p !== panelKey));
      return;
    }
    // Abrimos: aplicamos límite FIFO y avisamos qué paneles se cerraron.
    const next = [...openWindowsQueue, panelKey];
    const dropped = [];
    while (next.length > maxWindows) {
      dropped.push(next.shift());
    }
    dropped.forEach(key => {
      toast.info(`Se cerró "${PANEL_LABELS[key] || key}" por límite de ${maxWindows} paneles`);
    });
    setOpenWindowsQueue(next);
  };

  const handleFocusWindow = (panelKey) => {
    setOpenWindowsQueue(prev => {
      if (!prev.includes(panelKey)) return prev;
      return [...prev.filter(p => p !== panelKey), panelKey];
    });
  };

  const isWindowOpen = (panelKey) => openWindowsQueue.includes(panelKey);

  React.useEffect(() => {
    if (searchedShipment && !isWindowOpen("shipmentDetail")) {
      handleToggleWindow("shipmentDetail");
    }
    if (searchedShipment) {
      handleFocusWindow("shipmentDetail");
    }
  }, [searchedShipment]);

  React.useEffect(() => {
    if (
        liveStatus?.status === 'DONE' &&
        Array.isArray(liveStatus?.finalMasterPlan) &&
        liveStatus.finalMasterPlan.length > 0 &&
        sessionId &&
        finalPlanShownSession !== sessionId
    ) {
      setFinalPlanShownSession(sessionId);
      setOpenWindowsQueue(prev => {           // ← directo al estado, sin closures
        if (prev.includes('finalPlan')) {
          // ya estaba abierto: solo traerlo al frente
          return [...prev.filter(p => p !== 'finalPlan'), 'finalPlan'];
        }
        const next = [...prev, 'finalPlan'];
        while (next.length > maxWindows) next.shift();
        return next;
      });
    }
  }, [liveStatus?.status, liveStatus?.finalMasterPlan?.length, sessionId, finalPlanShownSession, maxWindows]);

  const [mapZoom, setMapZoom] = useState(2.0);
  const [mapCenter, setMapCenter] = useState([22, 15]);

  const formattedKpis = [
      ...kpiCards.map(kpi => {
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
      })
  ];

  return (
    <div
      className={`control-tower ${isCollapseScenario ? "control-tower--collapse" : ""}`}
    >


      <ScenarioHeader
        tabs={tabs}
        activeTab={activeTab}
        isCollapseScenario={isCollapseScenario}
        onTabChange={handleTabChange}
        systemClock={summary.systemClock}
        realClock={summary.realClock}
        simulatedElapsed={summary.simulatedElapsed}
        realTimeElapsed={summary.realTimeElapsed}
      />



      {isWindowOpen("cancellation") && (
        <DraggableWindow 
          title="Cancelaciones" 
          onClose={() => handleToggleWindow("cancellation")}
          initialPosition={{x: 20, y: window.innerHeight - 300}}
          isActive={openWindowsQueue[openWindowsQueue.length - 1] === "cancellation"}
          onFocus={() => handleFocusWindow("cancellation")}
        >
          <CancellationPanel
            sessionId={sessionId}
            isRunning={simState === "running"}
            startEpoch={liveStatus?.startEpoch}
            currentEpochTime={liveStatus?.interpolatedTime}
            activeAircraft={activeAircraft}
            cancelledFlights={cancelledFlights}
            onFlightCancelled={addCancelledFlight}
          />
        </DraggableWindow>
      )}

      {/* Renderizado de ventanas flotantes dinámicas desde DraggableWindow */}
      {isWindowOpen("telemetry") && (
          <DraggableWindow
              title="Telemetría en Tiempo Real"
              onClose={() => handleToggleWindow("telemetry")}
              initialPosition={{ x: 20, y: 100 }}
              defaultSize={{
                  width: 280,
                  height: 260
              }}
              isActive={openWindowsQueue[openWindowsQueue.length-1] === "telemetry"}
              onFocus={() => handleFocusWindow("telemetry")}
          >
          <TelemetryPanel isVisible={true} kpis={formattedKpis} onHide={() => handleToggleWindow("telemetry")} />
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
      {isWindowOpen("upcoming") && (
        <DraggableWindow title="Vuelos Próximos" onClose={() => handleToggleWindow("upcoming")} initialPosition={{x: 140, y: 150}} defaultSize={{width: 500, height: 400}} isActive={openWindowsQueue[openWindowsQueue.length-1] === "upcoming"} onFocus={() => handleFocusWindow("upcoming")}>
          <UpcomingFlightsPanel currentEpochTime={liveStatus?.interpolatedTime || currentEpochTime} />
        </DraggableWindow>
      )}
      <div className="ct-panel-corner-stack">
        <ShipmentDetailPanel 
          isVisible={!!currentFlight || !!searchedShipment} 
          selectedAircraft={currentFlight}
        />
        <AirportDetailPanel
          isVisible={!!selectedAirportCode}
          selectedAirport={airportNodes.find(a => a.icao === selectedAirportCode)}
          metrics={activeMetrics[selectedAirportCode]}
          currentEpochTime={liveStatus?.interpolatedTime || currentEpochTime}
        />
      </div>

        {isWindowOpen("tracking") && (
            <DraggableWindow
                title="Seguimiento de Rutas"
                onClose={() => handleToggleWindow("tracking")}
                initialPosition={{
                    x: 250,
                    y: 120,
                }}
                defaultSize={{
                    width: 360,
                    height: 420,
                }}
                isActive={
                    openWindowsQueue[
                    openWindowsQueue.length - 1
                        ] === "tracking"
                }
                onFocus={() => handleFocusWindow("tracking")}
            >
              <TrackingPanel
                  sessionId={sessionId}
              />
            </DraggableWindow>
        )}

        {/*{isWindowOpen("shipments") && (
            <DraggableWindow
                title="Gestión de Envíos"
                onClose={() => handleToggleWindow("shipments")}
                initialPosition={{
                    x: 250,
                    y: 120
                }}
                defaultSize={{
                    width: 400,
                    height: 280
                }}
                isActive={
                    openWindowsQueue[
                    openWindowsQueue.length - 1
                        ] === "shipments"
                }
                onFocus={() => handleFocusWindow("shipments")}
            >
              <ShipmentsPanel
                  sessionId={sessionId}
                  airports={globalAirports}
                  onSelectFlight={setSelectedAircraftId}
                  onAirportSelect={(code) => { setSelectedAirportCode(code); setSelectedAircraftId(null); }}
              />
            </DraggableWindow>
        )}*/}

        {isWindowOpen("shipments") && (
          <DraggableWindow title="📦 Envíos y Rastreo" onClose={() => handleToggleWindow("shipments")}
             initialPosition={{
               x: 250,
               y: 120
             }}
             defaultSize={{
               width: 400,
               height: 280
             }}
             isActive={
                 openWindowsQueue[
                 openWindowsQueue.length - 1
                     ] === "shipments"
             }
             onFocus={() => handleFocusWindow("shipments")}>
            <MergedShipmentPanel
            sessionId={sessionId}
            airports={globalAirports}
            onSelectFlight={setSelectedAircraftId}
            onAirportSelect={(code) => { setSelectedAirportCode(code); setSelectedAircraftId(null); }}
          />
        </DraggableWindow>
        )}

      {isWindowOpen("reports") && (
        <DraggableWindow title="Reportes y Exportación" onClose={() => handleToggleWindow("reports")} initialPosition={{x: window.innerWidth / 2 - 200, y: window.innerHeight / 2 - 150}} isActive={openWindowsQueue[openWindowsQueue.length-1] === "reports"} onFocus={() => handleFocusWindow("reports")}>
          <ReportsPanel 
            sessionId={sessionId}
            selectedAlgorithm={selectedAlgorithm}
            exportSimulationExcel={exportSimulationExcel}
            exportDetailedSimulationReport={exportDetailedSimulationReport}
          />
        </DraggableWindow>
      )}

      {isWindowOpen("airportConfig") && (
        <DraggableWindow title="Configuración de Almacenes" onClose={() => handleToggleWindow("airportConfig")} initialPosition={{x: 200, y: 150}} isActive={openWindowsQueue[openWindowsQueue.length-1] === "airportConfig"} onFocus={() => handleFocusWindow("airportConfig")}>
          <AirportConfigPanel />
        </DraggableWindow>
      )}

      {isWindowOpen("finalPlan") && (
          <DraggableWindow
              title="📋 Plan Final de la Simulación"
              onClose={() => handleToggleWindow("finalPlan")}
              initialPosition={{
                x: Math.max(0, window.innerWidth  / 2 - 500),
                y: Math.max(0, window.innerHeight / 2 - 300),
              }}
              defaultSize={{ width: 1000, height: 580 }}
              isActive={openWindowsQueue[openWindowsQueue.length - 1] === "finalPlan"}
              onFocus={() => handleFocusWindow("finalPlan")}
          >
            <FinalPlanPanel
                plan={liveStatus?.finalMasterPlan || []}
                sessionId={sessionId}
            />
          </DraggableWindow>
      )}

      {isWindowOpen("entities") && (
          <DraggableWindow
              title="Monitoreo de Vuelos y Almacenes"
              onClose={() => handleToggleWindow("entities")}
              initialPosition={{
                  x: window.innerWidth - 600,
                  y: 120
              }}
              defaultSize={{
                  width: 400,
                  height: 600
              }}
              isActive={openWindowsQueue[openWindowsQueue.length - 1] === "entities"}
              onFocus={() => handleFocusWindow("entities")}
          >
          <EntitiesListPanel 
            activeAircraft={activeAircraft} 
            airports={globalAirports} 
            airportMetrics={activeMetrics} 
            onSelectFlight={setSelectedAircraftId}
            onAirportSelect={(code) => {
              setSelectedAirportCode(code)
              setSelectedAircraftId(null)
            }}
            sessionId={sessionId}
          />
        </DraggableWindow>
      )}

      <main className="ct-main">
        <section className="ct-map-area" aria-label="Mapa de operaciones">
          {liveStatus?.isCollapseMode && (
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, background: '#ef4444', color: 'white', textAlign: 'center', padding: '6px', fontWeight: 'bold', zIndex: 100, letterSpacing: '2px', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              ⚠️ MODO CRISIS: RESILIENCIA ALNS ACTIVA ⚠️
            </div>
          )}

          {simState === "running" && !dismissedInitOverlay && (!liveStatus?.interpolatedTime || liveStatus.interpolatedTime === 0) && (
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'rgba(15, 23, 42, 0.90)', padding: '24px 36px', borderRadius: '16px', border: '1px solid rgba(56, 189, 248, 0.4)', color: 'white', textAlign: 'center', zIndex: 100, backdropFilter: 'blur(8px)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', boxShadow: '0 10px 40px rgba(0,0,0,0.5)' }}>
              <button onClick={() => setDismissedInitOverlay(true)} aria-label="Cerrar mensaje de inicialización" style={{ position: 'absolute', top: 8, right: 12, background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '16px' }}>✕</button>
              <div style={{ width: '40px', height: '40px', border: '4px solid rgba(56, 189, 248, 0.2)', borderTop: '4px solid #38bdf8', borderRadius: '50%', animation: 'ct-spin 1s linear infinite' }}></div>
              <div>
                <div style={{ fontWeight: 'bold', fontSize: '16px', color: activeTab === 'vivo' ? '#10b981' : '#38bdf8', letterSpacing: '1px', marginBottom: '6px' }}>{activeTab === 'vivo' ? 'INICIANDO OPERACIÓN' : 'INICIALIZANDO SIMULACIÓN'}</div>
                <div style={{ fontSize: '13px', color: '#94a3b8', maxWidth: '280px', lineHeight: '1.4' }}>{activeTab === 'vivo' ? 'Estableciendo conexión con el servidor y preparando datos de operación...' : 'Cargando datos de archivos y ejecutando primera planificación...'}</div>
              </div>
            </div>
          )}

          <WorldMap
            isDayToDay={activeTab === 'vivo'}
            airports={airportNodes}
            activeMetrics={activeMetrics}
            activeAircraft={activeAircraft}
            masterPlan={masterPlan}
            airportByIcao={airportByCode}
            isCollapseScenario={isCollapseScenario}
            selectedAirportCode={selectedAirportCode}
            selectedFromAirport={selectedFromAirport}
            selectedToAirport={selectedToAirport}
            onAirportSelect={(code) => {
                setSelectedAirportCode(code);
                setSelectedAircraftId(null);
            }}
            selectedAircraftId={selectedAircraftId}
            onAircraftSelect={(id) => {
                setSelectedAircraftId(id);
                setSelectedAirportCode(null);
            }}
            showCityLabels={activeAircraft.length < 80}
            zoom={mapZoom}
            center={mapCenter}
            onMoveEnd={(position) => {
              setMapZoom(position.zoom);
              setMapCenter(position.coordinates);
            }}
            currentEpochTime={liveStatus?.interpolatedTime || currentEpochTime}
            systemClock={summary.systemClock}
            simState={simState}
            isDayToDay={activeTab === "vivo"}
            onBackgroundClick={() => {
              setSelectedAircraftId(null);
              setSelectedAirportCode(null);
              clearFocusedEntity();
            }}
            onReset={resetSimulation}
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
            targetPlaybackMinutes={targetPlaybackMinutes}
            setTargetPlaybackMinutes={setTargetPlaybackMinutes}
            onExportExcel={exportSimulationExcel}
            onExportMd={exportSimulationReportMd}
            onExportDetails={exportDetailedSimulationReport}
            onReset={resetSimulation}
          />
          <CollapseSimConfig
            isOpen={isScenarioConfigOpen && activeTab === "colapso"}
            onClose={toggleScenarioConfig}
            onStart={startCollapseSimulation}
            liveStatus={liveStatus}
            onReset={resetSimulation}
            sessionId={sessionId}
            simState={simState}
          />


        </section>
      </main>

      <PendingShipmentsPanel
          isOpen={isWindowOpen("pendingShipments")}
          onClose={() => handleToggleWindow("pendingShipments")}
          sessionId={sessionId}
      />

      <ControlDock
        isCollapsed={isDockCollapsed}
        isScenarioConfigOpen={isScenarioConfigOpen}
        panelVisibility={{
          tracking: isWindowOpen("tracking"),
          telemetry: isWindowOpen("telemetry"),
          entities: isWindowOpen("entities"),
          pendingShipments: isWindowOpen("pendingShipments"),
          occupancy: isWindowOpen("occupancy"),
          transitInventory: isWindowOpen("transitInventory"),
          shipmentDetail: isWindowOpen("shipmentDetail"),
          airportConfig: isWindowOpen("airportConfig"),
          cancellation: isWindowOpen("cancellation")
        }}
        onToggleScenarioConfig={toggleScenarioConfig}
        onTogglePanel={handleToggleWindow}
        onToggleDock={toggleDock}
        maxWindows={maxWindows}
        setMaxWindows={setMaxWindows}
      />

      <footer className="ct-footer-minimal">
        <span style={{ opacity: 0.4 }}>TASFB2B Control Tower</span>
        <span style={{ marginLeft: 'auto', color: summary.networkLatency === 'OK' ? '#10b981' : '#f59e0b' }}>
          ● LATENCIA: {summary.networkLatency}
        </span>
        {isCollapseScenario && (
          <span className="ct-footer-collapse-badge" style={{ marginLeft: 16 }}>
            ⚠ MODO CRISIS ACTIVO
          </span>
        )}
      </footer>
    </div>
  );
};

export default App;
