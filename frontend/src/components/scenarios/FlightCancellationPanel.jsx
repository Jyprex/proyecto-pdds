import { useState, useCallback } from 'react'
import { apiFetch } from '../../hooks/api'

/**
 * Panel para cancelar vuelos manualmente durante una simulación en curso.
 * Útil para demos interactivas y testing de resiliencia ALNS.
 */
export default function FlightCancellationPanel({ sessionId, isRunning }) {
  const [vueloId, setVueloId] = useState('')
  const [resultado, setResultado] = useState(null)
  const [loading, setLoading] = useState(false)

  const handleCancel = useCallback(async () => {
    if (!vueloId || !sessionId) return
    setLoading(true)
    setResultado(null)

    try {
      const res = await apiFetch(
        `/api/v1/simulation/cancel-flight/${vueloId}?sessionId=${sessionId}`,
        { method: 'POST' }
      )
      const data = await res.json()
      setResultado({
        ok: res.ok,
        message: data.message || 'Sin respuesta',
      })
    } catch (err) {
      setResultado({ ok: false, message: err.message })
    } finally {
      setLoading(false)
      setVueloId('')
    }
  }, [vueloId, sessionId])

  if (!isRunning) return null

  return (
    <div style={{
      background: 'rgba(15, 23, 42, 0.85)',
      backdropFilter: 'blur(12px)',
      borderRadius: '12px',
      border: '1px solid rgba(239, 68, 68, 0.3)',
      padding: '14px 16px',
      marginTop: '10px',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        marginBottom: '10px',
        fontSize: '13px',
        fontWeight: 600,
        color: '#ef4444',
        letterSpacing: '0.5px',
      }}>
        ✈️ CANCELAR VUELO
      </div>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <input
          type="number"
          placeholder="ID del vuelo"
          value={vueloId}
          onChange={(e) => setVueloId(e.target.value)}
          style={{
            flex: 1,
            background: 'rgba(30, 41, 59, 0.8)',
            border: '1px solid rgba(100, 116, 139, 0.4)',
            borderRadius: '8px',
            padding: '8px 12px',
            color: '#e2e8f0',
            fontSize: '13px',
            outline: 'none',
          }}
        />
        <button
          onClick={handleCancel}
          disabled={loading || !vueloId}
          style={{
            background: loading
              ? 'rgba(100, 116, 139, 0.4)'
              : 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            padding: '8px 16px',
            fontSize: '12px',
            fontWeight: 600,
            cursor: loading || !vueloId ? 'not-allowed' : 'pointer',
            opacity: loading || !vueloId ? 0.5 : 1,
            transition: 'all 0.2s ease',
            whiteSpace: 'nowrap',
          }}
        >
          {loading ? '⏳' : '❌ Cancelar'}
        </button>
      </div>

      {resultado && (
        <div style={{
          marginTop: '8px',
          padding: '8px 12px',
          borderRadius: '8px',
          fontSize: '12px',
          background: resultado.ok
            ? 'rgba(16, 185, 129, 0.15)'
            : 'rgba(239, 68, 68, 0.15)',
          color: resultado.ok ? '#10b981' : '#ef4444',
          border: `1px solid ${resultado.ok ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
        }}>
          {resultado.ok ? '✅' : '⚠️'} {resultado.message}
        </div>
      )}
    </div>
  )
}
