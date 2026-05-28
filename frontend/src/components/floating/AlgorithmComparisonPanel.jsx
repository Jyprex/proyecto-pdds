import { apiFetch } from '../../hooks/api'

/**
 * Panel de comparativa de algoritmos.
 *
 * @param {boolean} isVisible     - si el panel está visible
 * @param {Function} onHide       - callback para ocultar el panel
 * @param {string|null} sessionId - UUID de sesión activa (null → usa datos estáticos)
 * @param {Object|null} comparisonData - datos reales de comparativa
 */
function AlgorithmComparisonPanel({ isVisible, onHide, sessionId = null, comparisonData = null }) {
  if (!isVisible) {
    return null
  }

  const hasData = !!comparisonData && (!!comparisonData.hga || !!comparisonData.alns)

  /**
   * Exporta el CSV de la sesión activa desde el backend.
   */
  const handleExport = async () => {
    if (!sessionId) {
      alert('La simulación aún no se ha ejecutado. No hay datos para exportar.')
      return
    }

    try {
      const res = await apiFetch(`/api/v1/simulation/export/${sessionId}`)

      if (res.status === 409) {
        alert('La simulación aún está en curso. Espere a que finalice.')
        return
      }
      if (!res.ok) {
        alert('No se encontró la sesión. Inicia una simulación primero.')
        return
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `tasf_simulation_${sessionId.substring(0, 8)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('[Tasf.B2B] Error al descargar CSV:', err)
    }
  }

  const isLiveData = !!sessionId

  return (
    <aside className="ct-panel ct-panel--comparison" aria-label="Comparativa de algoritmos">
      <div className="ct-panel-header">
        <p>
          COMPARATIVA DE ALGORITMOS
          {isLiveData && (
            <span style={{ fontSize: '10px', color: '#4ade80', marginLeft: '6px' }}>
              ● DATOS REALES
            </span>
          )}
        </p>
        <button type="button" className="ct-panel-close" onClick={onHide}>
          Ocultar
        </button>
      </div>

      <div className="ct-comparison-table-wrap">
        {!hasData ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>
            Sin datos de ejecución
          </div>
        ) : (
          <table className="ct-comparison-table">
            <thead>
              <tr>
                <th>Métrica</th>
                <th>HGA</th>
                <th>ALNS</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Tiempo de ejecución</td>
                <td>{comparisonData.hga?.execTime ?? '-'}</td>
                <td className="ct-cell-best">{comparisonData.alns?.execTime ?? '-'}</td>
              </tr>
              <tr>
                <td>Entregas a tiempo</td>
                <td>{comparisonData.hga?.deliveredOnTime ?? '-'}</td>
                <td className="ct-cell-best">{comparisonData.alns?.deliveredOnTime ?? '-'}</td>
              </tr>
              <tr>
                <td>Total entregas</td>
                <td>{comparisonData.hga?.totalDeliveries ?? '-'}</td>
                <td className="ct-cell-best">{comparisonData.alns?.totalDeliveries ?? '-'}</td>
              </tr>
              <tr>
                <td>SLA cumplido</td>
                <td>{comparisonData.hga?.slaPercent ? `${comparisonData.hga.slaPercent}%` : '-'}</td>
                <td className="ct-cell-best">{comparisonData.alns?.slaPercent ? `${comparisonData.alns.slaPercent}%` : '-'}</td>
              </tr>
              <tr>
                <td>Long. promedio ruta</td>
                <td>{comparisonData.hga?.avgRouteLength ? `${comparisonData.hga.avgRouteLength} escalas` : '-'}</td>
                <td className="ct-cell-best">{comparisonData.alns?.avgRouteLength ? `${comparisonData.alns.avgRouteLength} escalas` : '-'}</td>
              </tr>
              <tr>
                <td>Replanificaciones</td>
                <td>{comparisonData.hga?.replanifications ?? '-'}</td>
                <td className="ct-cell-best">{comparisonData.alns?.replanifications ?? '-'}</td>
              </tr>
              {((comparisonData.hga?.rescuedFlights > 0) || (comparisonData.alns?.rescuedFlights > 0)) && (
                <tr>
                  <td>Vuelos Rescatados</td>
                  <td>{comparisonData.hga?.rescuedFlights ?? '-'}</td>
                  <td className="ct-cell-best">{comparisonData.alns?.rescuedFlights ?? '-'}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <div className="ct-comparison-footer">
        {hasData && (
          <span className="ct-comparison-verdict">
            ✓ ALNS superior en este escenario
          </span>
        )}
        <button
          type="button"
          className="ct-comparison-export"
          onClick={handleExport}
          style={{ opacity: sessionId ? 1 : 0.5, cursor: sessionId ? 'pointer' : 'not-allowed' }}
        >
          📥 {sessionId ? 'Exportar CSV real' : 'Exportar CSV'}
        </button>
      </div>
    </aside>
  )
}

export default AlgorithmComparisonPanel

