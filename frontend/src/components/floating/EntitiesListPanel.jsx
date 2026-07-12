import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useSelectionBridge } from '../../hooks/useSelectionBridge';
import { FixedSizeList as List } from 'react-window';

// ── Tracking de maletas: estados y colores ──────────────────────────────
const TRACKING_STATUS_LABELS = {
  SIN_ASIGNAR: 'Sin asignar',
  PLANIFICADO: 'Planificado',
  EN_ALMACEN_ORIGEN: 'En almacén origen',
  EN_VUELO: 'En vuelo',
  EN_ALMACEN_DESTINO: 'En almacén destino',
  ENTREGADO: 'Entregado',
  REPLANIFICACION: 'Replanificación',
};

const TRACKING_STATUS_COLORS = {
  SIN_ASIGNAR: '#64748b',
  PLANIFICADO: '#3b82f6',
  EN_ALMACEN_ORIGEN: '#f59e0b',
  EN_VUELO: '#10b981',
  EN_ALMACEN_DESTINO: '#f59e0b',
  ENTREGADO: '#22c55e',
  REPLANIFICACION: '#ef4444',
};

function summarizeByStatus(bags) {
  const counts = {};
  for (const b of bags) {
    counts[b.estado] = (counts[b.estado] || 0) + 1;
  }
  return counts;
}

// ── Hook de fetch con abort automático al cambiar de selección ──────────
function useBagTracking(sessionId, kind, id) {
  const [bags, setBags] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!sessionId || !kind || !id) {
      setBags([]);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const url = kind === 'flight'
        ? `/api/shipments/${sessionId}/flight-instance/${id}`
        : `/api/shipments/${sessionId}/airport/${id}`;

    fetch(url, { signal: controller.signal })
        .then(res => {
          if (!res.ok) throw new Error('No se pudo cargar trazabilidad');
          return res.json();
        })
        .then(data => setBags(Array.isArray(data) ? data : []))
        .catch(err => {
          if (err.name !== 'AbortError') setError(err);
        })
        .finally(() => setLoading(false));

    return () => controller.abort();
  }, [sessionId, kind, id]);

  return { bags, loading, error };
}

// ── Resumen agregado (siempre liviano, sin importar cuántas maletas haya) ──
function BagTrackingSummary({ bags, loading, error, onShowDetail }) {
  if (loading) {
    return <div style={{ fontSize: '11px', color: '#64748b', padding: '8px 0' }}>Cargando trazabilidad...</div>;
  }
  if (error) {
    return <div style={{ fontSize: '11px', color: '#ef4444', padding: '8px 0' }}>Error cargando trazabilidad</div>;
  }
  if (!bags || bags.length === 0) {
    return <div style={{ fontSize: '10px', color: '#475569', fontStyle: 'italic', padding: '4px 0' }}>Sin maletas registradas</div>;
  }

  const counts = summarizeByStatus(bags);
  const shipmentCount = new Set(bags.map(b => b.shipmentCode)).size;

  return (
      <div style={{ marginTop: '8px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: '#cbd5e1', fontWeight: 'bold', marginBottom: '6px' }}>
          <span>🧳 Trazabilidad ({bags.length} maletas / {shipmentCount} envíos)</span>
          <span onClick={onShowDetail} style={{ color: '#60a5fa', cursor: 'pointer', fontWeight: 'normal', fontSize: '10px' }}>
          Ver detalle
        </span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {Object.entries(counts).map(([status, n]) => (
              <span key={status} style={{
                fontSize: '10px', padding: '2px 6px', borderRadius: '10px',
                background: `${TRACKING_STATUS_COLORS[status] || '#64748b'}20`,
                color: TRACKING_STATUS_COLORS[status] || '#64748b',
                border: `1px solid ${TRACKING_STATUS_COLORS[status] || '#64748b'}`,
              }}>
            {TRACKING_STATUS_LABELS[status] || status}: {n}
          </span>
          ))}
        </div>
      </div>
  );
}

// ── Detalle virtualizado: solo se monta si el usuario lo pide ───────────
const BagDetailRow = React.memo(function BagDetailRow({ index, style, data }) {
  const bag = data.bags[index];
  if (!bag) return null;
  return (
      <div style={{
        ...style, display: 'flex', justifyContent: 'space-between',
        fontSize: '10px', padding: '4px 6px', color: '#9ca3af',
        borderBottom: '1px dashed rgba(255,255,255,0.05)', boxSizing: 'border-box',
      }}>
        <span>{bag.bagId}</span>
        <span style={{ color: TRACKING_STATUS_COLORS[bag.estado] || '#64748b' }}>
        {TRACKING_STATUS_LABELS[bag.estado] || bag.estado}
      </span>
      </div>
  );
});

function BagDetailModal({ title, bags, onClose }) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search) return bags;
    const q = search.toLowerCase();
    return bags.filter(b =>
        b.bagId.toLowerCase().includes(q) || b.shipmentCode.toLowerCase().includes(q)
    );
  }, [bags, search]);

  return (
      <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={onClose}
      >
        <div
            style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '16px', width: '320px', maxHeight: '70vh', display: 'flex', flexDirection: 'column' }}
            onClick={e => e.stopPropagation()}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#e2e8f0' }}>
            {title} ({filtered.length})
          </span>
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 14 }}>
              ✕
            </button>
          </div>
          <input
              type="text"
              placeholder="Buscar maleta o código de envío..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ marginBottom: '8px', padding: '6px', fontSize: '11px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', borderRadius: '4px' }}
          />
          {filtered.length > 0 ? (
              <List height={300} width={288} itemCount={filtered.length} itemSize={24} itemData={{ bags: filtered }}>
                {BagDetailRow}
              </List>
          ) : (
              <div style={{ fontSize: '11px', color: '#64748b', padding: '8px 0' }}>Sin resultados</div>
          )}
        </div>
      </div>
  );
}

const getLevelColor = (percent) => {
  if (percent >= 90) return '#ef4444';
  if (percent >= 70) return '#f59e0b';
  return '#10b981';
};

const fmtTimeRange = (dep, arr) => {
  if (!dep || !arr) return '--:--';
  const t1 = new Date(dep).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  const t2 = new Date(arr).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  return `${t1} - ${t2} UTC`;
};

const FlightRow = React.memo(function FlightRow({ index, style, data }) {
  const { flights, expandedUt, handleSelectUT, setExpandedUt, focusedEntity } = data;
  const ut = flights[index];
  if (!ut) return null;

  const numericId = ut.id ? ut.id.toString().replace("vuelo-", "").split("-")[0] : null;
  const pct = ut.capacityPercent?.toFixed(1) || 0;
  const semaforo = getLevelColor(pct);
  const isExpanded = expandedUt === ut.id;
  const isFocused = focusedEntity?.type === 'flight' && focusedEntity?.id === ut.id;

  return (
      <div style={{ ...style, padding: '2px 4px', boxSizing: 'border-box' }}>
        <div
            style={{
              background: isFocused ? 'rgba(96,165,250,0.12)' : 'rgba(255,255,255,0.05)',
              borderRadius: '6px',
              borderLeft: `3px solid ${isFocused ? '#60a5fa' : semaforo}`,
              overflow: 'hidden',
              cursor: 'pointer',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 12px 10px 8px',
              boxSizing: 'border-box',
            }}
            onClick={() => { setExpandedUt(isExpanded ? null : ut.id); handleSelectUT(ut); }}
        >
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontWeight: 'bold', color: '#e2e8f0', fontSize: '14px', marginBottom: '2px', marginLeft: '0px' }}>Vuelo {numericId}</div>
            <div style={{ fontSize: '11px', color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>{ut.from} ➔ {ut.to}</span>
              {ut.departureTime && ut.arrivalTime && (
                <span style={{ color: '#64748b', fontSize: '10px', background: 'rgba(0,0,0,0.2)', padding: '2px 6px', borderRadius: '4px' }}>
                  {fmtTimeRange(ut.departureTime, ut.arrivalTime)}
                </span>
              )}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '14px', fontWeight: 'bold', color: semaforo }}>{pct}%</div>
            <div style={{ fontSize: '10px', color: '#94a3b8' }}>{ut.ocupacionReal || 0} / {ut.capacidadMax || 0} maletas</div>
          </div>
        </div>
      </div>
  );
}, (prev, next) => {
  const a = prev.data.flights[prev.index];
  const b = next.data.flights[next.index];
  return a?.id === b?.id
      && a?.status === b?.status
      && a?.capacityPercent === b?.capacityPercent
      && a?.ocupacionReal === b?.ocupacionReal
      && prev.data.expandedUt === next.data.expandedUt
      && prev.data.focusedEntity?.id === next.data.focusedEntity?.id;
});

function FlightDetailPanel({ flight, onClose, bagSummary }) {
  if (!flight) return null;

  const numericId = flight.id ? flight.id.toString().replace("vuelo-", "").split("-")[0] : null;

  return (
      <div style={{
        background: 'rgba(0,0,0,0.4)',
        borderRadius: '6px',
        padding: '12px',
        border: '1px solid rgba(96,165,250,0.3)',
        position: 'relative',
      }}>
        <button
            onClick={onClose}
            style={{ position: 'absolute', top: 8, right: 8, background: 'transparent', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 14 }}
        >
          ✕
        </button>

        <div style={{ fontSize: '12px', color: '#e2e8f0', marginBottom: '8px', fontWeight: 'bold' }}>
          ✈ Vuelo {numericId} — {flight.from} ➔ {flight.to}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', padding: '4px 0', color: '#9ca3af', borderBottom: '1px dashed rgba(255,255,255,0.1)' }}>
          <span>Ocupación Real</span>
          <span style={{ color: '#e2e8f0' }}>{flight.ocupacionReal || 0} maletas</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', padding: '4px 0', color: '#9ca3af', borderBottom: '1px dashed rgba(255,255,255,0.1)' }}>
          <span>Capacidad Máxima</span>
          <span style={{ color: '#e2e8f0' }}>{flight.capacidadMax || 0} maletas</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', padding: '4px 0', color: '#9ca3af' }}>
          <span>Progreso</span>
          <span style={{ color: '#e2e8f0' }}>{((flight.progress ?? 0) * 100).toFixed(0)}%</span>
        </div>
        {bagSummary}
      </div>
  );
}

const WarehouseRow = React.memo(function WarehouseRow({ index, style, data }) {
  const { warehouses, expandedWh, setExpandedWh, handleSelectWarehouse, focusedEntity, airportMetrics, warehouseNearestTimes } = data;
  const wh = warehouses[index];
  if (!wh) return null;

  const metrics = airportMetrics[wh.icao] || {};
  const pct = metrics.occupancy ?? 0;
  const semaforo = getLevelColor(pct);
  const isFocused = focusedEntity?.type === 'airport' && focusedEntity?.id === wh.icao;
  const nextDep = warehouseNearestTimes?.dep[wh.icao];
  const nextArr = warehouseNearestTimes?.arr[wh.icao];
  const fmtNext = (info) => {
    if (!info) return '--:--';
    const fid = info.id?.toString().replace('vuelo-', '').split('-')[0] ?? '?';
    const t = new Date(info.time).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
    return `V${fid} ${t}`;
  };

  return (
    <div style={{ ...style, padding: '2px 4px', boxSizing: 'border-box' }}>
      <div
        style={{
          background: isFocused ? 'rgba(96,165,250,0.12)' : 'rgba(255,255,255,0.05)',
          borderRadius: '6px',
          borderLeft: `3px solid ${isFocused ? '#60a5fa' : semaforo}`,
          overflow: 'hidden',
          cursor: 'pointer',
          height: '100%',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          padding: '8px 10px',
          boxSizing: 'border-box',
        }}
        onClick={() => {
          setExpandedWh(expandedWh === wh.icao ? null : wh.icao);
          handleSelectWarehouse(wh);
        }}
      >
        <div style={{ flexShrink: 0 }}>
          <div style={{ fontWeight: 'bold', color: '#e2e8f0', fontSize: '14px', marginBottom: '3px' }}>{wh.icao}</div>
          <div style={{ fontSize: '11px', color: '#cbd5e1' }}>{wh.city}</div>
        </div>
        <div style={{ fontSize: '10px', color: '#9ca3af', textAlign: 'center' }}>
          <div style={{ marginBottom: '2px' }}>
            <span>→{fmtNext(nextDep)}</span>
          </div>
          <div>
            <span>←{fmtNext(nextArr)}</span>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '14px', fontWeight: 'bold', color: semaforo }}>{Math.trunc(pct).toFixed(0)}%</div>
          <div style={{ fontSize: '10px', color: '#94a3b8' }}>{metrics.storedBags ?? 0} / {metrics.warehouseCapacity ?? 0}</div>
        </div>
      </div>
    </div>
  );
}, (prev, next) => {
  const a = prev.data.warehouses[prev.index];
  const b = next.data.warehouses[next.index];
  const ma = prev.data.airportMetrics[a?.icao] || {};
  const mb = next.data.airportMetrics[b?.icao] || {};
  const ta = prev.data.warehouseNearestTimes;
  const tb = next.data.warehouseNearestTimes;
  return a?.icao === b?.icao
      && ma.occupancy === mb.occupancy
      && ma.storedBags === mb.storedBags
      && ta?.dep[a?.icao] === tb?.dep[b?.icao]
      && ta?.arr[a?.icao] === tb?.arr[b?.icao]
      && prev.data.expandedWh === next.data.expandedWh
      && prev.data.focusedEntity?.id === next.data.focusedEntity?.id;
});

function WarehouseDetailPanel({ warehouse, incoming, outgoing, onClose, onSelectFlight, bagSummary }) {
  if (!warehouse) return null;

  return (
    <div style={{
      background: 'rgba(0,0,0,0.4)',
      borderRadius: '6px',
      padding: '12px',
      border: '1px solid rgba(96,165,250,0.3)',
      position: 'relative',
    }}>
      <button
        onClick={onClose}
        style={{ position: 'absolute', top: 8, right: 8, background: 'transparent', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 14 }}
      >
        ✕
      </button>

      <div style={{ fontSize: '12px', color: '#e2e8f0', marginBottom: '8px', fontWeight: 'bold' }}>
        🏭 {warehouse.icao} — {warehouse.city}
      </div>

      <div style={{ fontSize: '11px', color: '#cbd5e1', marginBottom: '8px', fontWeight: 'bold' }}>
        📥 VUELOS ENTRANTES ({incoming?.length || 0})
      </div>
      {incoming?.length > 0 ? incoming.map(f => {
        const fId = f.id?.toString().replace("vuelo-", "").split("-")[0];
        return (
          <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', padding: '2px 0', color: '#9ca3af', cursor: 'pointer' }}
            onClick={(e) => { e.stopPropagation(); onSelectFlight(f); }}
          >
            <span>✈ Vuelo {fId} ({f.from})</span>
            <span style={{ color: f.ocupacionReal > 0 ? '#10b981' : '#64748b' }}>
              {f.ocupacionReal > 0 ? `+${f.ocupacionReal} maletas` : 'En tránsito vacío'}
            </span>
          </div>
        );
      }) : (
        <div style={{ fontSize: '10px', color: '#475569', fontStyle: 'italic' }}>Sin vuelos entrantes activos</div>
      )}

      <div style={{ fontSize: '11px', color: '#cbd5e1', margin: '12px 0 8px 0', fontWeight: 'bold' }}>
        📤 VUELOS SALIENTES ({outgoing?.length || 0})
      </div>
      {outgoing?.length > 0 ? outgoing.map(f => {
        const fId = f.id?.toString().replace("vuelo-", "").split("-")[0];
        return (
          <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', padding: '2px 0', color: '#9ca3af', cursor: 'pointer' }}
            onClick={(e) => { e.stopPropagation(); onSelectFlight(f); }}
          >
            <span>✈ Vuelo {fId} (→{f.to})</span>
            <span style={{ color: f.ocupacionReal > 0 ? '#f59e0b' : '#64748b' }}>
              {f.ocupacionReal > 0 ? `-${f.ocupacionReal} maletas` : 'En tránsito vacío'}
            </span>
          </div>
        );
      }) : (
        <div style={{ fontSize: '10px', color: '#475569', fontStyle: 'italic' }}>Sin vuelos salientes activos</div>
      )}

      {bagSummary}
    </div>
  );
}

const getLevelName = (percent) => {
  if (percent >= 90) return 'red';
  if (percent >= 70) return 'amber';
  return 'green';
};

const SEMAPHORE_OPTIONS = [
  { value: null,    label: '⬜ Todos',   color: '#94a3b8' },
  { value: 'green', label: '🟢 Estable', color: '#10b981' },
  { value: 'amber', label: '🟡 Media',   color: '#f59e0b' },
  { value: 'red',   label: '🔴 Crítico', color: '#ef4444' },
];

const OCCUPANCY_FILTER_OPTIONS = [
  { value: null,     label: '⬜ Todos',           color: '#94a3b8' },
  { value: 'low',    label: '🟢 Baja (<70%)',     color: '#10b981' },
  { value: 'medium', label: '🟡 Media (70-90%)',  color: '#f59e0b' },
  { value: 'high',   label: '🔴 Alta (>90%)',     color: '#ef4444' },
];

// ── sessionId: nuevo prop, necesario para resolver el tracker correcto ──
export default function EntitiesListPanel({ activeAircraft, airports, airportMetrics, onSelectFlight, onAirportSelect, sessionId }) {
  const [activeTab, setActiveTab] = useState('ut');
  const [utSearch, setUtSearch] = useState('');
  const [utSearchOrigin, setUtSearchOrigin] = useState('');
  const [utSearchDest, setUtSearchDest] = useState('');
  const [utSort, setUtSort] = useState('occupancy_desc');
  const [expandedUt, setExpandedUt] = useState(null);

  const [whSearch, setWhSearch] = useState('');
  const [whSort, setWhSort] = useState('occupancy_desc');
  const [expandedWh, setExpandedWh] = useState(null);

  // ── Modal de detalle de maletas (compartido entre vuelo/almacén) ──────
  const [bagDetailTarget, setBagDetailTarget] = useState(null); // { title, bags } | null

  const {
    focusedEntity,
    setFocusedEntity,
    clearFocusedEntity,
    dispatchMapCommand,
    activeFilters,
    setActiveFilters,
  } = useSelectionBridge();

  const utRefsMap = useRef({});
  const whListRef = useRef(null);
  const lastMapSelectionRef = useRef(null);

  useEffect(() => {
    if (!focusedEntity || focusedEntity.source !== 'map') return;

    if (focusedEntity.type === 'flight') {
      setActiveTab('ut');
      setExpandedUt(focusedEntity.id);
      lastMapSelectionRef.current = { type: 'flight', id: focusedEntity.id };
    }

    if (focusedEntity.type === 'airport') {
      setActiveTab('wh');
      setExpandedWh(focusedEntity.id);
      lastMapSelectionRef.current = { type: 'airport', id: focusedEntity.id };
    }
  }, [focusedEntity]);

  const handleSelectUT = useCallback((ut) => {
    setFocusedEntity('flight', ut.id, 'panel');
    if (onSelectFlight) onSelectFlight(ut.id);
  }, [setFocusedEntity, onSelectFlight]);

  const handleSelectWarehouse = useCallback((wh) => {
    setFocusedEntity('airport', wh.icao, 'panel');
    if (onAirportSelect) onAirportSelect(wh.icao);
    dispatchMapCommand('flyTo', {
      coordinates: wh.coordinates,
      zoom: 5,
      targetId: wh.icao,
    });
  }, [setFocusedEntity, dispatchMapCommand, onAirportSelect]);

  const handleSemaphoreFilter = useCallback((level) => {
    setActiveFilters(prev => ({ ...prev, semaphoreLevel: level }));
  }, [setActiveFilters]);

  const handleOccupancyFilter = useCallback((level) => {
    setActiveFilters(prev => ({ ...prev, flightStatus: level }));
  }, [setActiveFilters]);

  const getContinentCenter = useCallback((continent) => {
    if (!continent || !airports) return null
    const filtered = airports.filter(ap => ap.continent === continent)
    if (filtered.length === 0) return null
    const lngs = filtered.map(ap => ap.coordinates[0])
    const lats = filtered.map(ap => ap.coordinates[1])
    return {
      coordinates: [
        (Math.min(...lngs) + Math.max(...lngs)) / 2,
        (Math.min(...lats) + Math.max(...lats)) / 2,
      ],
      zoom: 3,
    }
  }, [airports])

  const handleContinentFilter = useCallback((continent) => {
    setActiveFilters(prev => ({ ...prev, continent }));
    if (continent) {
      const center = getContinentCenter(continent)
      if (center) {
        dispatchMapCommand('flyTo', center)
      }
    }
  }, [setActiveFilters, dispatchMapCommand, getContinentCenter]);

  const filteredUTs = useMemo(() => {
    if (activeTab !== 'ut') return [];
    let result = [...(activeAircraft || [])];

    if (utSearch) {
      const q = utSearch.toLowerCase();
      result = result.filter(ut => ut.id?.toLowerCase().includes(q));
    }
    if (utSearchOrigin) {
      const q = utSearchOrigin.toLowerCase();
      result = result.filter(ut => ut.from?.toLowerCase().startsWith(q));
    }
    if (utSearchDest) {
      const q = utSearchDest.toLowerCase();
      result = result.filter(ut => ut.to?.toLowerCase().startsWith(q));
    }
    if (activeFilters.flightStatus) {
      result = result.filter(ut => {
        const pct = ut.capacityPercent ?? 0;
        if (activeFilters.flightStatus === 'low') return pct < 70;
        if (activeFilters.flightStatus === 'medium') return pct >= 70 && pct <= 90;
        if (activeFilters.flightStatus === 'high') return pct > 90;
        return true;
      });
    }

    if (activeFilters.continent) {
      result = result.filter(ut => {
        const fromAirport = airports.find(a => a.icao === ut.from);
        const toAirport = airports.find(a => a.icao === ut.to);
        return fromAirport?.continent === activeFilters.continent && 
               toAirport?.continent === activeFilters.continent;
      });
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
  }, [activeTab, activeAircraft, utSearch, utSearchOrigin, utSearchDest, utSort, activeFilters.flightStatus, activeFilters.continent, airports]);

  const selectedFlightDetail = useMemo(() => {
    if (!expandedUt) return null;
    return (activeAircraft || []).find(ut => ut.id === expandedUt) || null;
  }, [expandedUt, activeAircraft]);

  const selectedFlightInstanceKey = useMemo(() => {
    if (!selectedFlightDetail?.id) return null;
    const key = selectedFlightDetail.id.toString().replace("vuelo-", "");
    console.log("[CLICK] ut.id=", selectedFlightDetail.id, "→ key enviada al backend:", key);
    return key;
  }, [selectedFlightDetail]);

  // ── ID numérico real del vuelo (lo que espera el backend) ──────────────
  const selectedFlightNumericId = useMemo(() => {
    if (!selectedFlightDetail?.id) return null;
    return selectedFlightDetail.id.toString().replace("vuelo-", "").split("-")[0];
  }, [selectedFlightDetail]);

  const selectedWarehouseDetail = useMemo(() => {
    if (!expandedWh) return null;
    return (airports || []).find(wh => wh.icao === expandedWh) || null;
  }, [expandedWh, airports]);

  const { bags: flightBags, loading: flightBagsLoading, error: flightBagsError } =
      useBagTracking(sessionId, expandedUt ? 'flight' : null, selectedFlightInstanceKey);

  const { bags: warehouseBags, loading: warehouseBagsLoading, error: warehouseBagsError } =
      useBagTracking(sessionId, expandedWh ? 'airport' : null, expandedWh);

  const connectedIcaoSet = useMemo(() => {
    if (!focusedEntity || focusedEntity.type !== 'airport') return null;
    const icao = focusedEntity.id;
    const connected = new Set([icao]);
    (activeAircraft || []).forEach(f => {
        if (f.from === icao) connected.add(f.to);
        if (f.to === icao) connected.add(f.from);
    });
    return connected.size > 1 ? connected : null;
  }, [focusedEntity, activeAircraft]);

  const warehouseNearestTimes = useMemo(() => {
    const dep = {};
    const arr = {};
    (activeAircraft || []).forEach(f => {
      if (f.from && f.departureTime) {
        if (!dep[f.from] || f.departureTime < dep[f.from].time)
          dep[f.from] = { time: f.departureTime, id: f.id };
      }
      if (f.to && f.arrivalTime) {
        if (!arr[f.to] || f.arrivalTime < arr[f.to].time)
          arr[f.to] = { time: f.arrivalTime, id: f.id };
      }
    });
    return { dep, arr };
  }, [activeAircraft]);

  const filteredWarehouses = useMemo(() => {
    if (activeTab !== 'wh') return [];
    let result = [...(airports || [])];

    if (whSearch) {
      const q = whSearch.toLowerCase();
      result = result.filter(wh =>
          wh.icao?.toLowerCase().startsWith(q) ||
          wh.city?.toLowerCase().includes(q)
      );
    }

    if (activeFilters.semaphoreLevel) {
      result = result.filter(wh => {
        const m = airportMetrics[wh.icao] || {};
        const pct = m.occupancy ?? 0;
        return getLevelName(pct) === activeFilters.semaphoreLevel;
      });
    }

    if (activeFilters.continent) {
      result = result.filter(wh => wh.continent === activeFilters.continent);
    }

    if (connectedIcaoSet) {
      result = result.filter(wh => connectedIcaoSet.has(wh.icao));
    }

    const nearestDep = {}
    const nearestArr = {}
    ;(activeAircraft || []).forEach(f => {
      if (f.from) nearestDep[f.from] = Math.min(nearestDep[f.from] ?? Infinity, f.departureTime ?? Infinity)
      if (f.to) nearestArr[f.to] = Math.min(nearestArr[f.to] ?? Infinity, f.arrivalTime ?? Infinity)
    })

    result.sort((a, b) => {
      const mA = airportMetrics[a.icao] || {};
      const mB = airportMetrics[b.icao] || {};
      const pctA = mA.occupancy ?? 0;
      const pctB = mB.occupancy ?? 0;

      if (whSort === 'occupancy_desc') return pctB - pctA;
      if (whSort === 'occupancy_asc') return pctA - pctB;
      if (whSort === 'next_departure') return (nearestDep[a.icao] ?? Infinity) - (nearestDep[b.icao] ?? Infinity);
      if (whSort === 'next_arrival') return (nearestArr[a.icao] ?? Infinity) - (nearestArr[b.icao] ?? Infinity);
      if (whSort === 'name_asc') return a.icao.localeCompare(b.icao);
      return 0;
    });

    return result;
  }, [activeTab, airports, airportMetrics, activeAircraft, whSearch, activeFilters.continent, whSort, activeFilters.semaphoreLevel, connectedIcaoSet]);

  useEffect(() => {
    const last = lastMapSelectionRef.current;
    if (!last) return;

    if (last.type === 'flight') {
      const ref = utRefsMap.current[last.id];
      if (ref) {
        ref.scrollIntoView({ behavior: 'smooth', block: 'center' });
        ref.classList.add('ct-entity-highlighted');
        setTimeout(() => ref.classList.remove('ct-entity-highlighted'), 2500);
        lastMapSelectionRef.current = null;
      }
    } else if (last.type === 'airport' && whListRef.current) {
      const idx = filteredWarehouses.findIndex(wh => wh.icao === last.id);
      if (idx >= 0) {
        whListRef.current.scrollToItem(idx, 'center');
        lastMapSelectionRef.current = null;
      }
    }
  }, [activeTab, expandedWh, expandedUt, filteredWarehouses]);

  const getWarehouseFlights = useCallback((icao) => {
    if (!activeAircraft || activeAircraft.length === 0) return { incoming: [], outgoing: [] };
    const incoming = activeAircraft.filter(f => f.to === icao && f.status !== 'cancelled').slice(0, 5);
    const outgoing = activeAircraft.filter(f => f.from === icao && f.status !== 'cancelled').slice(0, 5);
    return { incoming, outgoing };
  }, [activeAircraft]);

  return (
      <aside className="ct-panel ct-panel--entities-list" style={{ display: 'flex', flexDirection: 'column', maxHeight: '1000px', background: 'rgba(15, 23, 42, 0.9)', minWidth: "350px", flex: "1 1 350px", borderRadius: "8px", overflow: "hidden" }}>

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

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>

          {activeTab === 'ut' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                {expandedUt && selectedFlightDetail ? (
                    <>
                      <button onClick={() => { setExpandedUt(null); clearFocusedEntity(); if (onSelectFlight) onSelectFlight(null); dispatchMapCommand('resetView'); }}
                              style={{
                                alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '4px',
                                padding: '6px 12px', borderRadius: '6px',
                                border: '1px solid rgba(255,255,255,0.1)',
                                background: 'transparent', color: '#60a5fa',
                                fontSize: '11px', fontWeight: 'bold', cursor: 'pointer',
                              }}
                      >
                        ← Volver a vuelos
                      </button>
                      <FlightDetailPanel
                          flight={selectedFlightDetail}
                          onClose={() => { setExpandedUt(null); clearFocusedEntity(); if (onSelectFlight) onSelectFlight(null); dispatchMapCommand('resetView'); }}
                          bagSummary={
                            <BagTrackingSummary
                                bags={flightBags}
                                loading={flightBagsLoading}
                                error={flightBagsError}
                                onShowDetail={() => setBagDetailTarget({
                                  title: `Vuelo ${selectedFlightNumericId}`,
                                  bags: flightBags,
                                })}
                            />
                          }
                      />
                    </>
                ) : (
                    <>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {OCCUPANCY_FILTER_OPTIONS.map(opt => (
                            <button key={opt.value ?? 'all'} onClick={() => handleOccupancyFilter(opt.value)}
                                    style={{
                                      padding: '4px 10px', borderRadius: '8px', fontSize: '10px', fontWeight: 'bold',height: '24px',
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

                       <div style={{ display: 'flex', gap: '4px' }}>
                         <input type="text" placeholder="ID..." value={utSearch} onChange={(e) => setUtSearch(e.target.value)}
                                style={{ width: '60px', fontSize: '11px', padding: '8px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', borderRadius: '4px', boxSizing: 'border-box' }} />
                         <input type="text" placeholder="Origen..." value={utSearchOrigin} onChange={(e) => setUtSearchOrigin(e.target.value)}
                                style={{ flex: 1, fontSize: '11px', padding: '8px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', borderRadius: '4px', boxSizing: 'border-box' }} />
                         <input type="text" placeholder="Destino..." value={utSearchDest} onChange={(e) => setUtSearchDest(e.target.value)}
                                style={{ flex: 1, fontSize: '11px', padding: '8px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', borderRadius: '4px', boxSizing: 'border-box' }} />
                       </div>
                       <div style={{ display: 'flex', gap: '4px' }}>
                         <select value={utSort} onChange={(e) => setUtSort(e.target.value)}
                                 style={{ flex: 1,  height: '30px', padding: '8px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', borderRadius: '4px', fontSize: '11px' }}
                         >
                           <option value="occupancy_desc">Ocupación (Mayor a Menor)</option>
                           <option value="occupancy_asc">Ocupación (Menor a Mayor)</option>
                           <option value="dep_asc">Hora de Salida</option>
                           <option value="arr_asc">Hora de Llegada</option>
                           <option value="origin">Origen (A-Z)</option>
                           <option value="dest">Destino (A-Z)</option>
                         </select>
                       </div>

                      {filteredUTs.length > 0 && (
                          <List
                              height={420}
                              width="100%"
                              itemCount={filteredUTs.length}
                              itemSize={72}
                               itemData={{ flights: filteredUTs, expandedUt, setExpandedUt, handleSelectUT, focusedEntity }}
                          >
                            {FlightRow}
                          </List>
                      )}
                      {filteredUTs.length === 0 && (
                          <div style={{ textAlign: 'center', color: '#64748b', fontSize: '12px', padding: '10px' }}>
                            No hay unidades de transporte activas.
                          </div>
                      )}
                    </>
                )}
              </div>
          )}

          {activeTab === 'wh' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                {expandedWh && selectedWarehouseDetail ? (
                    <>
                      <button onClick={() => { setExpandedWh(null); clearFocusedEntity(); dispatchMapCommand('resetView'); }}
                              style={{
                                alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '4px',
                                padding: '6px 12px', borderRadius: '6px',
                                border: '1px solid rgba(255,255,255,0.1)',
                                background: 'transparent', color: '#60a5fa',
                                fontSize: '11px', fontWeight: 'bold', cursor: 'pointer',
                              }}
                      >
                        ← Volver a almacenes
                      </button>
                      <WarehouseDetailPanel
                          warehouse={selectedWarehouseDetail}
                          incoming={getWarehouseFlights(expandedWh).incoming}
                          outgoing={getWarehouseFlights(expandedWh).outgoing}
                          onClose={() => { setExpandedWh(null); clearFocusedEntity(); dispatchMapCommand('resetView'); }}
                          onSelectFlight={handleSelectUT}
                          bagSummary={
                            <BagTrackingSummary
                                bags={warehouseBags}
                                loading={warehouseBagsLoading}
                                error={warehouseBagsError}
                                onShowDetail={() => setBagDetailTarget({
                                  title: `Almacén ${selectedWarehouseDetail.icao}`,
                                  bags: warehouseBags,
                                })}
                            />
                          }
                      />
                    </>
                ) : (
                    <>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {SEMAPHORE_OPTIONS.map(opt => (
                            <button
                                key={opt.value ?? 'all'}
                                onClick={() => handleSemaphoreFilter(opt.value)}
                                style={{
                                  padding: '3px 10px', borderRadius: '12px', fontSize: '10px', fontWeight: 'bold',
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

                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {[{ value: null, label: '🌎 Todos', color: '#94a3b8' },
                          { value: 'america', label: '🌎 América', color: '#10b981' },
                          { value: 'europe', label: '🌎 Europa', color: '#3b82f6' },
                          { value: 'asia', label: '🌎 Asia', color: '#f59e0b' },
                        ].map(opt => (
                            <button key={opt.value ?? 'all'} onClick={() => handleContinentFilter(opt.value)}
                                    style={{
                                      padding: '3px 10px', borderRadius: '12px', fontSize: '10px', fontWeight: 'bold',
                                      cursor: 'pointer', transition: 'all 0.15s',
                                      border: activeFilters.continent === opt.value ? `1px solid ${opt.color}` : '1px solid rgba(255,255,255,0.1)',
                                      background: activeFilters.continent === opt.value ? `${opt.color}20` : 'transparent',
                                      color: activeFilters.continent === opt.value ? opt.color : '#64748b',
                                    }}
                            >
                              {opt.label}
                            </button>
                        ))}
                      </div>

                      {connectedIcaoSet && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#60a5fa', padding: '4px 0' }}>
                          <span>🔗 Conectados a <strong>{focusedEntity.id}</strong></span>
                          <button onClick={clearFocusedEntity}
                                  style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#94a3b8', cursor: 'pointer', borderRadius: '50%', width: '18px', height: '18px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            ✕
                          </button>
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input type="text" placeholder="Buscar por código o ciudad..."
                               value={whSearch} onChange={(e) => setWhSearch(e.target.value)}
                               style={{ flex: 1, padding: '8px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', borderRadius: '4px', fontSize: '12px' }}
                        />
                        <select value={whSort} onChange={(e) => setWhSort(e.target.value)}
                                style={{ padding: '8px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', borderRadius: '4px', fontSize: '12px' }}
                        >
                          <option value="occupancy_desc">Ocupación (Mayor a Menor)</option>
                          <option value="occupancy_asc">Ocupación (Menor a Mayor)</option>
                          <option value="next_departure">Próxima salida de UT</option>
                          <option value="next_arrival">Próxima llegada de UT</option>
                          <option value="name_asc">Código (A-Z)</option>
                        </select>
                      </div>

                      {filteredWarehouses.length > 0 ? (
                          <List
                              ref={whListRef}
                              height={420}
                              width="100%"
                              itemCount={filteredWarehouses.length}
              itemSize={62}
              itemData={{
                                warehouses: filteredWarehouses,
                                expandedWh,
                                setExpandedWh,
                                handleSelectWarehouse,
                                focusedEntity,
                                airportMetrics,
                                warehouseNearestTimes,
                              }}
                          >
                            {WarehouseRow}
                          </List>
                      ) : (
                          <div style={{ textAlign: 'center', color: '#64748b', fontSize: '12px', padding: '10px' }}>
                            No hay almacenes que coincidan con los filtros.
                          </div>
                      )}
                    </>
                )}
              </div>
          )}

        </div>

        {bagDetailTarget && (
            <BagDetailModal
                title={bagDetailTarget.title}
                bags={bagDetailTarget.bags}
                onClose={() => setBagDetailTarget(null)}
            />
        )}
      </aside>
  );
}