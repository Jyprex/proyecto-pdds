import React, { useState, useMemo } from 'react';

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

const mockShipments = (totalBags, from, to) => {
  if (!totalBags) return [];
  const shipments = [];
  let remaining = totalBags;
  let idCounter = 1;
  while (remaining > 0) {
    const qty = Math.min(remaining, Math.floor(Math.random() * 20) + 5);
    shipments.push({
      id: `ENV-${from}-${to}-${idCounter.toString().padStart(3, '0')}`,
      qty,
      type: Math.random() > 0.8 ? 'Priority' : 'Standard'
    });
    remaining -= qty;
    idCounter++;
  }
  return shipments;
};

export default function EntitiesListPanel({ activeAircraft, airports, airportMetrics }) {
  const [activeTab, setActiveTab] = useState('ut');
  
  // UT Filters & Sort
  const [utSearch, setUtSearch] = useState('');
  const [utSort, setUtSort] = useState('occupancy_desc');
  const [expandedUt, setExpandedUt] = useState(null);

  // Warehouse Filters & Sort
  const [whSearch, setWhSearch] = useState('');
  const [whSort, setWhSort] = useState('occupancy_desc');
  const [expandedWh, setExpandedWh] = useState(null);

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
  }, [activeAircraft, utSearch, utSort]);

  const filteredWarehouses = useMemo(() => {
    let result = [...(airports || [])];
    
    if (whSearch) {
      const q = whSearch.toLowerCase();
      result = result.filter(wh => 
        wh.icao?.toLowerCase().includes(q) ||
        wh.city?.toLowerCase().includes(q)
      );
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
  }, [airports, airportMetrics, whSearch, whSort]);

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

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        
        {/* TAB: UTs */}
        {activeTab === 'ut' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
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

                return (
                  <div key={ut.id} style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '6px', border: `1px solid ${statusColors[ut.status] || statusColors.default}`, overflow: 'hidden' }}>
                    <div 
                      style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                      onClick={() => setExpandedUt(isExpanded ? null : ut.id)}
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
                        <div style={{ fontSize: '11px', color: '#cbd5e1', marginBottom: '8px', fontWeight: 'bold' }}>📦 ENVÍOS EN ESTA UNIDAD</div>
                        {mockShipments(ut.ocupacionReal, ut.from, ut.to).map(ship => (
                          <div key={ship.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', padding: '4px 0', borderBottom: '1px dashed rgba(255,255,255,0.1)' }}>
                            <span style={{ color: '#94a3b8' }}>{ship.id}</span>
                            <span style={{ color: ship.type === 'Priority' ? '#f59e0b' : '#9ca3af' }}>{ship.qty} pzs ({ship.type})</span>
                          </div>
                        ))}
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

                return (
                  <div key={wh.icao} style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '6px', borderLeft: `3px solid ${semaforo}`, overflow: 'hidden' }}>
                    <div 
                      style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                      onClick={() => setExpandedWh(isExpanded ? null : wh.icao)}
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
                        <div style={{ fontSize: '11px', color: '#cbd5e1', marginBottom: '8px', fontWeight: 'bold' }}>📥 ENVÍOS PLANIFICADOS (ENTRADA)</div>
                        {mockShipments(Math.floor((metrics.load || 0) * 0.4), 'XXX', wh.icao).slice(0,3).map(ship => (
                          <div key={ship.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', padding: '2px 0', color: '#9ca3af' }}>
                            <span>{ship.id}</span><span>+{ship.qty} pzs</span>
                          </div>
                        ))}
                        <div style={{ fontSize: '11px', color: '#cbd5e1', margin: '12px 0 8px 0', fontWeight: 'bold' }}>📤 ENVÍOS PLANIFICADOS (SALIDA)</div>
                        {mockShipments(Math.floor((metrics.load || 0) * 0.6), wh.icao, 'YYY').slice(0,3).map(ship => (
                          <div key={ship.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', padding: '2px 0', color: '#9ca3af' }}>
                            <span>{ship.id}</span><span>-{ship.qty} pzs</span>
                          </div>
                        ))}
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
