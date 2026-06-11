function TelemetryPanel({ isVisible, summary, elapsedOperationTime, onHide }) {
  if (!isVisible) {
    return null
  }

  return (
    <aside className="ct-panel ct-panel--telemetry">
      <div className="ct-panel-header">
        <p>TELEMETRÍA DEL SISTEMA</p>
        <button
          type="button"
          className="ct-panel-close"
          onClick={onHide}
        >
          Ocultar
        </button>
      </div>
      <div className="ct-metrics-grid">
        <div>
          <span>USO ALMACENES</span>
          <strong>{summary.storageOccupancy.value}%</strong>
        </div>
        <div>
          <span>VUELOS EN CURSO</span>
          <strong>{summary.flightsInCourse.value}</strong>
        </div>
        <div>
          <span>HORA INICIO</span>
          <strong>{summary.operationStart}</strong>
        </div>
        <div>
          <span>TRANSCURRIDO</span>
          <strong>{summary.realTimeElapsed}</strong>
        </div>
        <div>
          <span>FASE DE SIMULACIÓN</span>
          <strong>{summary.progress.label}</strong>
        </div>
        <div>
          <span>ESCENARIO ACTIVO</span>
          <strong>{summary.scenarioLabel}</strong>
        </div>
      </div>
      <div className="ct-average">OCUPACIÓN PROMEDIO <strong>{summary.storageOccupancy.value}%</strong></div>
    </aside>
  )
}

export default TelemetryPanel
