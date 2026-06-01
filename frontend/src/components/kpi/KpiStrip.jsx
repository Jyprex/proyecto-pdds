import React from 'react';

const KpiStrip = React.memo(({ isCollapsed, kpiCards }) => {
  return (
    <section
      className={`ct-kpi-strip ${isCollapsed ? 'ct-kpi-strip--collapsed' : ''}`}
      aria-label="Resumen operativo"
    >
      {isCollapsed ? (
        <p className="ct-kpi-collapsed-hint">Resumen oculto: {kpiCards.length} KPI disponibles</p>
      ) : (
        kpiCards.map((card) => (
          <article key={card.key} className={`ct-kpi-card ct-kpi-card--${card.status}`}>
            <p className="ct-kpi-title">{card.title}</p>
            <strong className="ct-kpi-value">{card.value}</strong>
            <p className="ct-kpi-subtitle">{card.subtitle}</p>
            {card.progress && (
              <div className="ct-kpi-progress" role="presentation" aria-hidden="true">
                <span style={{ width: `${card.progress}%` }} />
              </div>
            )}
          </article>
        ))
      )}
    </section>
  )
});

export default KpiStrip
