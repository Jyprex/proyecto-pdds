import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useSelectionBridge } from '../../hooks/useSelectionBridge';

const statusColors = {
  critical: '#ef4444',
  blocked: '#f59e0b',
  rescued: '#3b82f6',
  cancelled: '#ef4444',
  high: '#f97316',
  normal: '#10b981',
  default: '#64748b'
};

const getLevelColor = (percent) => {
  if (percent >= 90) return '#ef4444';
  if (percent >= 70) return '#f59e0b';
  return '#10b981';
};

const getLevelName = (percent) => {
  if (percent >= 90) return 'red';
  if (percent >= 70) return 'amber';
  return 'green';
};

// ── Paso 6: Botones de filtro por semáforo ─────────────────────────────────
const SEMAPHORE_OPTIONS = [
  { value: null,    label: '⬜ Todos',   color: '#94a3b8' },
  { value: 'green', label: '🟢 Estable', color: '#10b981' },
  { value: 'amber', label: '🟡 Media',   color: '#f59e0b' },
  { value: 'red',   label: '🔴 Crítico', color: '#ef4444' },
];

const FLIGHT_STATUS_OPTIONS = [
  { value: null,        label: '⬜ Todos',     color: '#94a3b8' },
  { value: 'normal',    label: '🟢 Normal',    color: '#10b981' },
  { value: 'critical',  label: '🟡 Crítico',   color: '#f59e0b' },
  { value: 'rescued',   label: '🔵 Rescatado', color: '#3b82f6' },
  { value: 'cancelled', label: '🔴 Cancelado', color: '#ef4444' },
];

export default function EntitiesListPanel({ activeAircraft, airports, airportMetrics }) {
  const [activeTab, setActiveTab] = useState('ut');
  
  // ── Selection Bridge ─────────────────────────────────────────────────────
  const {
    focusedEntity,
    setFocusedEntity,
    dispatchMapCommand,
    activeFilters,
    setActiveFilters,
  } = useSelectionBridge();

  // UT Filters & Sort
  const [utSearch, setUtSearch] = useState('');
  const [utSort, setUtSort] = useState('occupancy_desc');
  const [expandedUt, setExpandedUt] = useState(null);

  // Warehouse Filters & Sort
  const [whSearch, setWhSearch] = useState('');
  const [whSort, setWhSort] = useState('occupancy_desc');
  const [expandedWh, setExpandedWh] = useState(null);

  // ── Refs para scroll automático (Paso 3: Mapa→Panel) ────────────────────
  const utRefsMap = useRef({});
  const whRefsMap = useRef({});
  const scrollContainerRef = useRef(null);

  // ── Paso 3: Responder a selección desde el mapa ─────────────────────────
  useEffect(() => {
    if (!focusedEntity || focusedEntity.source !== 'map') return;

    if (focusedEntity.type === 'flight') {
      setActiveTab('ut');
      // Scroll al vuelo después de un tick para que el tab se renderice
      requestAnimationFrame(() => {
        const ref = utRefsMap.current[focusedEntity.id];
        if (ref) {
          ref.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Aplicar efecto highlight temporal
          ref.classList.add('ct-entity-highlighted');
          setTimeout(() => ref.classList.remove('ct-entity-highlighted'), 2500);
        }
      });
    }

    if (focusedEntity.type === 'airport') {
      setActiveTab('wh');
      requestAnimationFrame(() => {
        const ref = whRefsMap.current[focusedEntity.id];
        if (ref) {
          ref.scrollIntoView({ behavior: 'smooth', block: 'center' });
          ref.classList.add('ct-entity-highlighted');
          setTimeout(() => ref.classList.remove('ct-entity-highlighted'), 2500);
        }
      });
    }
  }, [focusedEntity]);

  // ── Paso 2: Clic en panel → enfocar en mapa ────────────────────────────
  const handleSelectUT = useCallback((ut) => {
    const from = airports?.find(a => a.icao === ut.from);
    const to   = airports?.find(a => a.icao === ut.to);
    if (!from && !to) return;

    // Calcular posición del avión para centrar el mapa
    const progress = ut.progress ?? 0.5;
    const target = from && to
      ? [
          from.coordinates[0] + (to.coordinates[0] - from.coordinates[0]) * progress,
          from.coordinates[1] + (to.coordinates[1] - from.coordinates[1]) * progress,
        ]
      : (from?.coordinates || to?.coordinates);

    setFocusedEntity('flight', ut.id, 'panel');
    dispatchMapCommand('flyTo', {
      coordinates: target,
      zoom: 4,
      targetId: ut.id,
    });
  }, [airports, setFocusedEntity, dispatchMapCommand]);

  const handleSelectWarehouse = useCallback((wh) => {
    setFocusedEntity('airport', wh.icao, 'panel');
    dispatchMapCommand('flyTo', {
      coordinates: wh.coordinates,
      zoom: 5,
      targetId: wh.icao,
    });
  }, [setFocusedEntity, dispatchMapCommand]);

  // ── Paso 6: Handler de filtro por semáforo ──────────────────────────────
  const handleSemaphoreFilter = useCallback((level) => {
    setActiveFilters(prev => ({ ...prev, semaphoreLevel: level }));
  }, [setActiveFilters]);

  const handleFlightStatusFilter = useCallback((status) => {
    setActiveFilters(prev => ({ ...prev, flightStatus: status }));
  }, [setActiveFilters]);

  const filteredUTs = useMemo(() => {
    let result = [...(activeAircraft || [])];
    
    if (utSearch) {
      const q = utSearch.toLowerCase();
      result = result.filter(ut => 
        ut.id?.toLowerCase().includes(q) ||
        ut.from?.toLowerCase().includes(q) ||
        ut.to?.toLowerCase().includes(q)
      );
    }

    // Paso 6: Filtro por status de semáforo
    if (activeFilters.flightStatus) {
      result = result.filter(ut => ut.status === activeFilters.flightStatus);
    }

    result.sort((a, b) => {
      if (utSort === 'occupancy_desc') return (b.capacityPercent || 0) - (a.capacityPercent || 0);
      if (utSort === 'occupancy_asc') return (a.capacityPercent || 0) - (b.capacityPercent || 0);
      if (utSort === 'dep_asc') return (a.departureTime || 0) - (b.departureTime || 0);
      if (utSort === 'arr_asc') return (a.arrivalTime || 0) - (b.arrivalTime || 0);
      if (utSort === 'origin') return (a.from || '').localeCompare(b.from || '');
      if (utSort === 'dest') return (a.to || '').localeCompare(b.to || '');
      return 0;
    });

    return result;
  }, [activeAircraft, utSearch, utSort, activeFilters.flightStatus]);

  const filteredWarehouses = useMemo(() => {
    let result = [...(airports || [])];
    
    if (whSearch) {
      const q = whSearch.toLowerCase();
      result = result.filter(wh => 
        wh.icao?.toLowerCase().includes(q) ||
        wh.city?.toLowerCase().includes(q)
      );
    }

    // Paso 6: Filtro por semáforo de almacén
    if (activeFilters.semaphoreLevel) {
      result = result.filter(wh => {
        const m = airportMetrics[wh.icao] || {};
        const pct = m.capacity ? (m.load / m.capacity) * 100 : 0;
        return getLevelName(pct) === activeFilters.semaphoreLevel;
      });
    }

    result.sort((a, b) => {
      const mA = airportMetrics[a.icao] || {};
      const mB = airportMetrics[b.icao] || {};
      const pctA = mA.capacity ? (mA.load / mA.capacity) * 100 : 0;
      const pctB = mB.capacity ? (mB.load / mB.capacity) * 100 : 0;

      if (whSort === 'occupancy_desc') return pctB - pctA;
      if (whSort === 'occupancy_asc') return pctA - pctB;
      if (whSort === 'name_asc') return a.icao.localeCompare(b.icao);
      return 0;
    });

    return result;
  }, [airports, airportMetrics, whSearch, whSort, activeFilters.semaphoreLevel]);

  // ── Paso 10: Derivar envíos reales de activeAircraft por almacén ────────
  const getWarehouseFlights = useCallback((icao) => {
    if (!activeAircraft || activeAircraft.length === 0) return { incoming: [], outgoing: [] };
    const incoming = activeAircraft.filter(f => f.to === icao && f.status !== 'cancelled').slice(0, 5);
    const outgoing = activeAircraft.filter(f => f.from === icao && f.status !== 'cancelled').slice(0, 5);
    return { incoming, outgoing };
  }, [activeAircraft]);

  return (
    <aside className="ct-panel ct-panel--entities-list" style={{ display: 'flex', flexDirection: 'column', maxHeight: '500px', background: 'rgba(15, 23, 42, 0.9)', minWidth: "400px", flex: "1 1 400px", borderRadius: "8px", overflow: "hidden" }}>
      
      {/* HEADER TABS */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <button 
          style={{ flex: 1, padding: '12px', background: activeTab === 'ut' ? 'rgba(96,165,250,0.2)' : 'transparent', color: activeTab === 'ut' ? '#60a5fa' : '#9ca3af', border: 'none', borderBottom: activeTab === 'ut' ? '2px solid #60a5fa' : '2px solid transparent', fontWeight: 'bold', cursor: 'pointer' }}
          onClick={() => setActiveTab('ut')}
        >
          ✈️ UTs (Vuelos)
        </button>
        <button 
          style={{ flex: 1, padding: '12px', background: activeTab === 'wh' ? 'rgba(96,165,250,0.2)' : 'transparent', color: activeTab === 'wh' ? '#60a5fa' : '#9ca3af', border: 'none', borderBottom: activeTab === 'wh' ? '2px solid #60a5fa' : '2px solid transparent', fontWeight: 'bold', cursor: 'pointer' }}
          onClick={() => setActiveTab('wh')}
        >
          🏭 Almacenes
        </button>
      </div>

      <div ref={scrollContainerRef} style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        
        {/* TAB: UTs */}
        {activeTab === 'ut' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Paso 6: Filtros por semáforo de vuelo */}
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {FLIGHT_STATUS_OPTIONS.map(opt => (
                <button
                  key={opt.value ?? 'all'}
                  onClick={() => handleFlightStatusFilter(opt.value)}
                  style={{
                    padding: '4px 10px', borderRadius: '12px', fontSize: '10px', fontWeight: 'bold',
                    cursor: 'pointer', transition: 'all 0.15s',
                    border: activeFilters.flightStatus === opt.value ? `1px solid ${opt.color}` : '1px solid rgba(255,255,255,0.1)',
                    background: activeFilters.flightStatus === opt.value ? `${opt.color}20` : 'transparent',
                    color: activeFilters.flightStatus === opt.value ? opt.color : '#64748b',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <input 
                type="text" placeholder="Buscar por ID, Origen o Destino..." 
                value={utSearch} onChange={(e) => setUtSearch(e.target.value)}
                style={{ flex: 1, padding: '8px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', borderRadius: '4px', fontSize: '12px' }}
              />
              <select 
                value={utSort} onChange={(e) => setUtSort(e.target.value)}
                style={{ padding: '8px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', borderRadius: '4px', fontSize: '12px' }}
              >
                <option value="occupancy_desc">Ocupación (Mayor a Menor)</option>
                <option value="occupancy_asc">Ocupación (Menor a Mayor)</option>
                <option value="dep_asc">Hora de Salida</option>
                <option value="arr_asc">Hora de Llegada</option>
                <option value="origin">Origen (A-Z)</option>
                <option value="dest">Destino (A-Z)</option>
              </select>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filteredUTs.map(ut => {
                const numericId = ut.id?.toString().replace("vuelo-", "").split("-")[0];
                const pct = ut.capacityPercent?.toFixed(1) || 0;
                const semaforo = getLevelColor(pct);
                const isExpanded = expandedUt === ut.id;
                const isFocused = focusedEntity?.type === 'flight' && focusedEntity?.id === ut.id;

                return (
                  <div
                    key={ut.id}
                    ref={el => { utRefsMap.current[ut.id] = el; }}
                    style={{
                      background: isFocused ? 'rgba(96,165,250,0.12)' : 'rgba(255,255,255,0.05)',
                      borderRadius: '6px',
                      border: `1px solid ${isFocused ? '#60a5fa' : (statusColors[ut.status] || statusColors.default)}`,
                      overflow: 'hidden',
                      transition: 'background 0.3s ease, border-color 0.3s ease',
                    }}
                  >
                    <div 
                      style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                      onClick={() => {
                        setExpandedUt(isExpanded ? null : ut.id);
                        // Paso 2: Panel→Mapa — enfocar en mapa
                        handleSelectUT(ut);
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <span style={{ fontWeight: 'bold', color: '#e2e8f0', fontSize: '13px' }}>Vuelo {numericId}</span>
                          <span style={{ background: statusColors[ut.status] || statusColors.default, fontSize: '10px', padding: '2px 6px', borderRadius: '12px', color: '#fff', textTransform: 'uppercase' }}>{ut.status}</span>
                        </div>
                        <div style={{ fontSize: '11px', color: '#9ca3af' }}>{ut.from} ➔ {ut.to}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '14px', fontWeight: 'bold', color: semaforo }}>{pct}%</div>
                        <div style={{ fontSize: '10px', color: '#94a3b8' }}>{ut.ocupacionReal || 0} / {ut.capacidadMax || 0} maletas</div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div style={{ background: 'rgba(0,0,0,0.3)', padding: '12px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                        <div style={{ fontSize: '11px', color: '#cbd5e1', marginBottom: '8px', fontWeight: 'bold' }}>📦 DATOS DEL VUELO</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', padding: '4px 0', color: '#9ca3af', borderBottom: '1px dashed rgba(255,255,255,0.1)' }}>
                          <span>Ocupación Real</span>
                          <span style={{ color: '#e2e8f0' }}>{ut.ocupacionReal || 0} maletas</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', padding: '4px 0', color: '#9ca3af', borderBottom: '1px dashed rgba(255,255,255,0.1)' }}>
                          <span>Capacidad Máxima</span>
                          <span style={{ color: '#e2e8f0' }}>{ut.capacidadMax || 0} maletas</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', padding: '4px 0', color: '#9ca3af', borderBottom: '1px dashed rgba(255,255,255,0.1)' }}>
                          <span>Progreso</span>
                          <span style={{ color: '#e2e8f0' }}>{((ut.progress ?? 0) * 100).toFixed(0)}%</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', padding: '4px 0', color: '#9ca3af' }}>
                          <span>Estado</span>
                          <span style={{ color: statusColors[ut.status] || statusColors.default, fontWeight: 'bold', textTransform: 'uppercase' }}>{ut.status}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {filteredUTs.length === 0 && <div style={{ textAlign: 'center', color: '#64748b', fontSize: '12px', padding: '20px' }}>No hay unidades de transporte activas.</div>}
            </div>
          </div>
        )}

        {/* TAB: ALMACENES */}
        {activeTab === 'wh' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Paso 6: Filtros por semáforo de almacén */}
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {SEMAPHORE_OPTIONS.map(opt => (
                <button
                  key={opt.value ?? 'all'}
                  onClick={() => handleSemaphoreFilter(opt.value)}
                  style={{
                    padding: '4px 10px', borderRadius: '12px', fontSize: '10px', fontWeight: 'bold',
                    cursor: 'pointer', transition: 'all 0.15s',
                    border: activeFilters.semaphoreLevel === opt.value ? `1px solid ${opt.color}` : '1px solid rgba(255,255,255,0.1)',
                    background: activeFilters.semaphoreLevel === opt.value ? `${opt.color}20` : 'transparent',
                    color: activeFilters.semaphoreLevel === opt.value ? opt.color : '#64748b',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <input 
                type="text" placeholder="Buscar por código o ciudad..." 
                value={whSearch} onChange={(e) => setWhSearch(e.target.value)}
                style={{ flex: 1, padding: '8px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', borderRadius: '4px', fontSize: '12px' }}
              />
              <select 
                value={whSort} onChange={(e) => setWhSort(e.target.value)}
                style={{ padding: '8px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', borderRadius: '4px', fontSize: '12px' }}
              >
                <option value="occupancy_desc">Ocupación (Mayor a Menor)</option>
                <option value="occupancy_asc">Ocupación (Menor a Mayor)</option>
                <option value="name_asc">Código (A-Z)</option>
              </select>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filteredWarehouses.map(wh => {
                const metrics = airportMetrics[wh.icao] || {};
                const pct = metrics.capacity ? ((metrics.load / metrics.capacity) * 100).toFixed(1) : 0;
                const semaforo = getLevelColor(pct);
                const isExpanded = expandedWh === wh.icao;
                const isFocused = focusedEntity?.type === 'airport' && focusedEntity?.id === wh.icao;
                const flights = isExpanded ? getWarehouseFlights(wh.icao) : null;

                return (
                  <div
                    key={wh.icao}
                    ref={el => { whRefsMap.current[wh.icao] = el; }}
                    style={{
                      background: isFocused ? 'rgba(96,165,250,0.12)' : 'rgba(255,255,255,0.05)',
                      borderRadius: '6px',
                      borderLeft: `3px solid ${isFocused ? '#60a5fa' : semaforo}`,
                      overflow: 'hidden',
                      transition: 'background 0.3s ease, border-color 0.3s ease',
                    }}
                  >
                    <div 
                      style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                      onClick={() => {
                        setExpandedWh(isExpanded ? null : wh.icao);
                        // Paso 2: Panel→Mapa — enfocar en mapa
                        handleSelectWarehouse(wh);
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 'bold', color: '#e2e8f0', fontSize: '14px', marginBottom: '2px' }}>{wh.icao}</div>
                        <div style={{ fontSize: '11px', color: '#9ca3af' }}>{wh.city}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '14px', fontWeight: 'bold', color: semaforo }}>{pct}%</div>
                        <div style={{ fontSize: '10px', color: '#94a3b8' }}>{metrics.load || 0} / {metrics.capacity || 0} stock</div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div style={{ background: 'rgba(0,0,0,0.3)', padding: '12px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                        {/* Paso 10: Datos reales de vuelos, no mock */}
                        <div style={{ fontSize: '11px', color: '#cbd5e1', marginBottom: '8px', fontWeight: 'bold' }}>📥 VUELOS ENTRANTES ({flights?.incoming?.length || 0})</div>
                        {flights?.incoming?.length > 0 ? flights.incoming.map(f => {
                          const fId = f.id?.toString().replace("vuelo-", "").split("-")[0];
                          return (
                            <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', padding: '2px 0', color: '#9ca3af', cursor: 'pointer' }}
                              onClick={(e) => { e.stopPropagation(); handleSelectUT(f); }}
                            >
                              <span>✈ Vuelo {fId} ({f.from})</span>
                              <span style={{ color: '#10b981' }}>+{f.ocupacionReal || '?'} maletas</span>
                            </div>
                          );
                        }) : (
                          <div style={{ fontSize: '10px', color: '#475569', fontStyle: 'italic' }}>Sin vuelos entrantes activos</div>
                        )}

                        <div style={{ fontSize: '11px', color: '#cbd5e1', margin: '12px 0 8px 0', fontWeight: 'bold' }}>📤 VUELOS SALIENTES ({flights?.outgoing?.length || 0})</div>
                        {flights?.outgoing?.length > 0 ? flights.outgoing.map(f => {
                          const fId = f.id?.toString().replace("vuelo-", "").split("-")[0];
                          return (
                            <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', padding: '2px 0', color: '#9ca3af', cursor: 'pointer' }}
                              onClick={(e) => { e.stopPropagation(); handleSelectUT(f); }}
                            >
                              <span>✈ Vuelo {fId} (→{f.to})</span>
                              <span style={{ color: '#f59e0b' }}>-{f.ocupacionReal || '?'} maletas</span>
                            </div>
                          );
                        }) : (
                          <div style={{ fontSize: '10px', color: '#475569', fontStyle: 'italic' }}>Sin vuelos salientes activos</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </div>
    </aside>
  );
}
