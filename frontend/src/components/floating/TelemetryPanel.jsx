const STATUS_META = {
  danger:  { icon: '⛔', text: 'Crítico', color: '#f87171' },
  warning: { icon: '⚠️', text: 'Alerta', color: '#fbbf24' },
  idle:    { icon: '○', text: 'Inactivo', color: '#94a3b8' },
  default: { icon: '✓', text: 'Normal', color: '#4ade80' },
}

const VALUE_COLORS = { red: '#f87171', amber: '#fbbf24', green: '#4ade80', idle: '#94a3b8' }

function TelemetryPanel({ isVisible, kpis }) {
  if (!isVisible) return null

  return (
    <div style={{
      width: '100%', height: '100%', overflowX: 'hidden', overflowY: 'auto',
      background: 'rgba(15, 23, 42, 0.95)', padding: '8px'
    }}>
      {kpis && kpis.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }} aria-live="polite">
          {kpis.map((kpi, idx) => {
            const meta = STATUS_META[kpi.status] || STATUS_META.default
            const showBadge = kpi.status === 'danger' || kpi.status === 'warning'
            const isOcc = kpi.key === 'occupancy' || kpi.key === 'fleetOccupancy'
            return (
              <div key={kpi.key || idx} style={{
                background: 'rgba(40, 58, 78, 0.6)', padding: '4px 6px', borderRadius: '6px',
                border: '1px solid rgba(56, 189, 248, 0.2)', display: 'flex', flexDirection: 'column',
                gap: '2px', alignItems: 'center', minWidth: 0
              }}>
                <span style={{ fontSize: '9px', color: '#94a3b8', textTransform: 'uppercase', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }}>
                  {isOcc ? kpi.title.split('global ')[1] || kpi.title : kpi.title}
                </span>
                <strong style={{ fontSize: '12px', color: isOcc ? (VALUE_COLORS[kpi.status] || '#e2e8f0') : '#e2e8f0', display: 'flex', alignItems: 'center', gap: '3px' }}>
                  {showBadge && <span title={meta.text}>{meta.icon}</span>}
                  {kpi.value}
                </strong>
              </div>
            )
          })}

        </div>
      )}
    </div>
  )
}

export default TelemetryPanel
