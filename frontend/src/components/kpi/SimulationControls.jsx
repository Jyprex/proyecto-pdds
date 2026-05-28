function SimulationControls({
  isVisible,
  simState,
  simulatedClock,
  elapsedReal,
  speed,
  onStart,
  onPause,
  onStop,
  onSpeedChange,
}) {
  if (!isVisible) {
    return null
  }

  const speedOptions = [1, 10, 60]

  return (
    <div className="ct-sim-controls" aria-label="Controles de simulación">
      <div className="ct-sim-controls__actions">
        <button
          type="button"
          className={`ct-sim-btn ${simState === 'running' ? 'ct-sim-btn--active' : ''}`}
          onClick={onStart}
          disabled={simState === 'running'}
          aria-label="Iniciar simulación"
        >
          ▶
        </button>
        <button
          type="button"
          className={`ct-sim-btn ${simState === 'paused' ? 'ct-sim-btn--active' : ''}`}
          onClick={onPause}
          disabled={simState !== 'running'}
          aria-label="Pausar simulación"
        >
          ⏸
        </button>
        <button
          type="button"
          className="ct-sim-btn ct-sim-btn--stop"
          onClick={onStop}
          disabled={simState === 'idle'}
          aria-label="Detener simulación"
        >
          ⏹
        </button>
      </div>

      <div className="ct-sim-controls__speed">
        <span className="ct-sim-label">Velocidad</span>
        <div className="ct-sim-speed-chips">
          {speedOptions.map((s) => (
            <button
              key={s}
              type="button"
              className={`ct-sim-speed-chip ${speed === s ? 'ct-sim-speed-chip--active' : ''}`}
              onClick={() => onSpeedChange(s)}
            >
              ×{s}
            </button>
          ))}
        </div>
      </div>

      <div className="ct-sim-controls__clocks">
        <div className="ct-sim-clock-item">
          <span className="ct-sim-label">Reloj simulado</span>
          <strong>{simulatedClock}</strong>
        </div>
        <div className="ct-sim-clock-item">
          <span className="ct-sim-label">Tiempo real</span>
          <strong>{elapsedReal}</strong>
        </div>
      </div>

      <div className="ct-sim-controls__status">
        <span className={`ct-sim-status-badge ct-sim-status-badge--${simState}`}>
          {{
            idle: 'Listo',
            running: 'En ejecución',
            paused: 'Pausado',
            completed: 'Completado',
            collapsed: '⚠ Colapsado'
          }[simState] || 'Desconocido'}
        </span>
      </div>
    </div>
  )
}

export default SimulationControls
