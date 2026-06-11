import React, { useState } from 'react';

const NAV_ITEMS = [
  { key: 'scenario',       icon: '⚙',  label: 'Escenario',      isScenario: true },
  { key: 'telemetry',      icon: '📡', label: 'Telemetría' },
  { key: 'entities',       icon: '✈️', label: 'Vuelos y Almacenes' },
  { key: 'occupancy',      icon: '🏆', label: 'Top Aeropuertos' },
  { key: 'transitInventory', icon: '📦', label: 'Inventario' },
  { key: 'comparison',     icon: '⚖',  label: 'Comparativa' },
  { key: 'shipmentDetail', icon: '✉',  label: 'Envío' },
  { key: 'airportConfig',  icon: '🏢', label: 'Almacenes' },
  { key: 'bloqueos',       icon: '🚧', label: 'Bloqueos' },
  { key: 'reports',        icon: '📑', label: 'Reportes' },
];

const ControlDock = ({
  isCollapsed = false,
  isScenarioConfigOpen = false,
  onToggleDock = () => {},
  onTogglePanel = () => {},
  onToggleScenarioConfig = () => {},
  panelVisibility = {},
  maxWindows = 1,
  setMaxWindows = () => {},
}) => {
  const [hovered, setHovered] = useState(null);

  return (
    <aside
      aria-label="Panel de herramientas"
      style={{
        position: 'fixed',
        left: 0,
        top: '50%',
        transform: 'translateY(-50%)',
        zIndex: 400,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '4px',
        padding: '8px 6px',
        background: 'rgba(8, 14, 30, 0.88)',
        backdropFilter: 'blur(12px)',
        borderRight: '1px solid rgba(56, 189, 248, 0.18)',
        borderRadius: '0 12px 12px 0',
        boxShadow: '4px 0 20px rgba(0,0,0,0.4)',
        minWidth: isCollapsed ? 42 : 52,
        transition: 'min-width 0.2s ease',
      }}
    >
      {NAV_ITEMS.map((item) => {
        const isActive = item.isScenario
          ? isScenarioConfigOpen
          : !!panelVisibility[item.key];

        return (
          <div
            key={item.key}
            style={{ position: 'relative', width: '100%' }}
            onMouseEnter={() => setHovered(item.key)}
            onMouseLeave={() => setHovered(null)}
          >
            <button
              type="button"
              aria-pressed={isActive}
              onClick={() =>
                item.isScenario ? onToggleScenarioConfig() : onTogglePanel(item.key)
              }
              style={{
                width: '100%',
                aspectRatio: '1',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '18px',
                background: isActive
                  ? 'rgba(56, 189, 248, 0.18)'
                  : 'transparent',
                border: isActive
                  ? '1px solid rgba(56, 189, 248, 0.45)'
                  : '1px solid transparent',
                borderRadius: '8px',
                color: '#e2e8f0',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                outline: 'none',
              }}
              title={item.label}
            >
              {item.icon}
            </button>

            {/* Tooltip lateral (solo al hacer hover) */}
            {hovered === item.key && (
              <div style={{
                position: 'absolute',
                left: 'calc(100% + 10px)',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'rgba(8, 14, 30, 0.95)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                borderRadius: '6px',
                padding: '5px 10px',
                whiteSpace: 'nowrap',
                fontSize: '11px',
                fontWeight: 600,
                color: '#e2e8f0',
                letterSpacing: '0.5px',
                pointerEvents: 'none',
                zIndex: 9999,
                boxShadow: '2px 4px 12px rgba(0,0,0,0.5)',
              }}>
                {item.label}
                {/* Flecha */}
                <span style={{
                  position: 'absolute',
                  right: '100%',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  borderWidth: '5px',
                  borderStyle: 'solid',
                  borderColor: 'transparent rgba(56,189,248,0.3) transparent transparent',
                }} />
              </div>
            )}
          </div>
        );
      })}

      {/* Separador */}
      <div style={{ width: '70%', height: '1px', background: 'rgba(255,255,255,0.08)', margin: '4px 0' }} />

      {/* Control Max Paneles — compacto */}
      <div
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}
        title={`Máximo de paneles simultáneos: ${maxWindows}`}
      >
        <button
          type="button"
          onClick={() => setMaxWindows(Math.min(5, maxWindows + 1))}
          style={btnStyle}
        >+</button>
        <span style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 700 }}>{maxWindows}</span>
        <button
          type="button"
          onClick={() => setMaxWindows(Math.max(1, maxWindows - 1))}
          style={btnStyle}
        >–</button>
      </div>

      {/* Botón colapso */}
      <button
        type="button"
        onClick={onToggleDock}
        aria-label={isCollapsed ? 'Expandir sidebar' : 'Colapsar sidebar'}
        style={{
          ...btnStyle,
          marginTop: '4px',
          fontSize: '12px',
          color: '#64748b',
        }}
        title={isCollapsed ? 'Expandir' : 'Colapsar'}
      >
        {isCollapsed ? '▶' : '◀'}
      </button>
    </aside>
  );
};

const btnStyle = {
  background: 'transparent',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '6px',
  color: '#94a3b8',
  cursor: 'pointer',
  fontSize: '13px',
  width: '26px',
  height: '26px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  lineHeight: 1,
};

export default ControlDock;
