import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { apiFetch } from '../../hooks/api';
import { useSelectionBridge } from '../../hooks/useSelectionBridge';
import { useAirports } from '../../hooks/useAirports';
import { AIRPORT_BY_ICAO } from '../../data/airportsData';
// ── Constantes ────────────────────────────────────────────────────────────────
const PAGE_SIZE = 15;
const STATUS_META = {
    SIN_ASIGNAR:           { label: 'Sin asignar',       color: '#64748b', icon: '○' },
    PLANIFICADO:           { label: 'Planificado',       color: '#64748b', icon: '○' },
    EN_ALMACEN_ORIGEN:     { label: 'Almacén origen',    color: '#f59e0b', icon: '🏭' },
    EN_ALMACEN_INTERMEDIO: { label: 'Escala',            color: '#fb923c', icon: '🔄' },
    EN_VUELO:              { label: 'En vuelo',          color: '#10b981', icon: '✈' },
    EN_ALMACEN_DESTINO:    { label: 'Almacén destino',   color: '#3b82f6', icon: '📦' },
    ENTREGADO:             { label: 'Entregado',         color: '#22c55e', icon: '✓' },
    REPLANIFICACION:       { label: 'Replanificación',   color: '#ef4444', icon: '⚠' },
};
function buildGlobalCode(origenIcao, codigoPedido) {
    return `${origenIcao}_${codigoPedido}`;
}
function StatusBadge({ estado, small = false }) {
    const meta = STATUS_META[estado] || STATUS_META.SIN_ASIGNAR;
    return (
        <span style={{
            fontSize: small ? '9px' : '10px',
            padding: small ? '1px 5px' : '1px 7px',
            borderRadius: '8px', whiteSpace: 'nowrap',
            background: `${meta.color}20`, color: meta.color,
            border: `1px solid ${meta.color}`,
        }}>
      {meta.icon} {meta.label}
    </span>
    );
}
function formatTime(ms) {
    if (!ms) return '—';
    // timeZone: 'UTC' obligatorio — el backend, ALNS, tracking y el reloj
    // del mapa operan enteramente en UTC. hour12: false para formato 24h.
    return new Date(ms).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
}
// ── Sección: Rastreo ──────────────────────────────────────────────────────────
function TrackingSection({ sessionId, airports }) {
    const { setTrackedRoute, clearTrackedRoute, dispatchMapCommand } = useSelectionBridge();
    const [term, setTerm]           = useState('');
    const [result, setResult]       = useState(null); // { type: 'bag'|'shipment', data }
    const [loading, setLoading]     = useState(false);
    const [error, setError]         = useState(null);
    const isBagSearch = useMemo(() => /[A-Z]{4}_.*-\d+$/i.test(term.trim()), [term]);
    const doSearch = useCallback(async () => {
        const q = term.trim();
        if (!q || !sessionId) return;
        setLoading(true); setError(null); setResult(null);
        try {
            if (isBagSearch) {
                const [stRes, hRes] = await Promise.all([
                    apiFetch(`/api/shipments/${sessionId}/bag/${encodeURIComponent(q)}`),
                    apiFetch(`/api/shipments/${sessionId}/bag/${encodeURIComponent(q)}/hops`),
                ]);
                const state = stRes.ok ? await stRes.json() : null;
                const hops  = hRes.ok  ? await hRes.json()  : [];
                setResult({ type: 'bag', bagId: q, state, hops });
                if (hops.length > 0) activateMapRoute(q, hops);
            } else {
                const [stRes, hRes] = await Promise.all([
                    apiFetch(`/api/shipments/${sessionId}/shipment/${encodeURIComponent(q)}`),
                    apiFetch(`/api/shipments/${sessionId}/shipment/${encodeURIComponent(q)}/hops`),
                ]);
                const states  = stRes.ok ? await stRes.json() : [];
                const hopsMap = hRes.ok  ? await hRes.json()  : {};
                setResult({ type: 'shipment', code: q, states, hopsMap });
                // Activar ruta en mapa con primera maleta que tenga hops
                const firstHops = Object.values(hopsMap)[0] || [];
                if (firstHops.length > 0) activateMapRoute(q, firstHops);
            }
        } catch (e) {
            setError('Error de conexión');
        } finally {
            setLoading(false);
        }
    }, [term, sessionId, isBagSearch]);
    const activateMapRoute = (id, hops) => {
        setTrackedRoute({
            shipmentId: id,
            hops: hops.map(h => ({ from: h.origenIcao, to: h.destinoIcao, flightId: String(h.vueloId || ''), status: 'normal' })),
        });
        const coords = hops.flatMap(h => {
            const a = AIRPORT_BY_ICAO?.[h.origenIcao], b = AIRPORT_BY_ICAO?.[h.destinoIcao];
            return [a, b].filter(Boolean).map(x => x.coordinates);
        });
        if (coords.length > 0) {
            const sum = coords.reduce(([ax, ay], [bx, by]) => [ax + bx, ay + by], [0, 0]);
            dispatchMapCommand('flyTo', { coordinates: [sum[0]/coords.length, sum[1]/coords.length], zoom: 3 });
        }
    };
    const renderHops = (hops) => hops.map((h, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#9ca3af', padding: '2px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <span><span style={{ color: '#64748b', marginRight: 4 }}>{i+1}.</span>✈ #{h.vueloId}: {h.origenIcao} → {h.destinoIcao}</span>
            <span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatTime(h.departureTime)} → {formatTime(h.arrivalTime)}</span>
        </div>
    ));
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '4px' }}>
            <div style={{ fontSize: '10px', color: '#94a3b8', padding: '4px 6px', background: 'rgba(96,165,250,0.06)', borderRadius: '4px' }}>
                Código sin guion final = envío completo · Con guion + número = maleta individual
                (ej: <code style={{ fontSize: '10px', color: '#60a5fa' }}>UBBB_000002860</code> o <code style={{ fontSize: '10px', color: '#60a5fa' }}>UBBB_000002860-1</code>)
            </div>
            <div style={{ display: 'flex', gap: '4px' }}>
                <input
                    value={term}
                    onChange={e => setTerm(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && doSearch()}
                    placeholder={isBagSearch ? 'Maleta individual detectada...' : 'Código de envío o maleta...'}
                    style={{ flex: 1, padding: '6px 8px', fontSize: '11px', background: 'rgba(15,23,42,0.9)', border: isBagSearch ? '1px solid rgba(96,165,250,0.4)' : '1px solid rgba(255,255,255,0.1)', color: 'white', borderRadius: '4px', outline: 'none' }}
                />
                <button
                    onClick={doSearch} disabled={loading || !term.trim() || !sessionId}
                    style={{ padding: '6px 12px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold', border: 'none', cursor: (loading || !sessionId) ? 'not-allowed' : 'pointer', background: '#0ea5e9', color: 'white' }}
                >
                    {loading ? '...' : 'Buscar'}
                </button>
            </div>
            {!sessionId && (
                <div style={{ fontSize: '10px', color: '#f59e0b', textAlign: 'center', padding: '8px' }}>
                    ⚠ Inicia una simulación para ver trazabilidad en tiempo real
                </div>
            )}
            {error && <div style={{ fontSize: '10px', color: '#fca5a5' }}>{error}</div>}
            {result?.type === 'bag' && (
                <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '6px', padding: '8px', border: '1px solid rgba(96,165,250,0.2)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <span style={{ fontFamily: 'monospace', fontSize: '11px', fontWeight: 'bold', color: '#38bdf8' }}>{result.bagId}</span>
                        {result.state ? <StatusBadge estado={result.state.estado} /> : <span style={{ fontSize: '10px', color: '#64748b' }}>Sin estado</span>}
                    </div>
                    {result.state?.aeropuertoActual && <div style={{ fontSize: '10px', color: '#94a3b8', marginBottom: '4px' }}>📍 {result.state.aeropuertoActual}</div>}
                    {result.state?.registeredAt && (
                        <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '4px' }}>
                            🕐 Registrado en origen: <span style={{ color: '#cbd5e1' }}>{formatTime(result.state.registeredAt)}</span>
                        </div>
                    )}
                    <div style={{ fontSize: '9px', color: '#64748b', marginBottom: '4px' }}>Ruta ({result.hops.length} tramos):</div>
                    {result.hops.length > 0 ? renderHops(result.hops) : <div style={{ fontSize: '9px', color: '#64748b', fontStyle: 'italic' }}>Sin ruta comprometida.</div>}
                    <button onClick={() => { clearTrackedRoute(); setResult(null); }} style={{ marginTop: '6px', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', cursor: 'pointer', width: '100%' }}>
                        Limpiar
                    </button>
                </div>
            )}
            {result?.type === 'shipment' && (
                <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '6px', padding: '8px', border: '1px solid rgba(16,185,129,0.2)', maxHeight: '300px', overflowY: 'auto' }}>
                    <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#10b981', marginBottom: '8px' }}>
                        Envío: {result.code} ({Object.keys(result.hopsMap).length} maletas)
                    </div>
                    {result.states.length === 0 && <div style={{ fontSize: '10px', color: '#64748b', fontStyle: 'italic' }}>Sin estados registrados aún.</div>}
                    {Object.entries(result.hopsMap).map(([bagId, hops]) => {
                        const bagState = result.states.find(s => s.bagId === bagId);
                        return (
                            <div key={bagId} style={{ marginBottom: '8px', paddingBottom: '6px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                                    <span style={{ fontSize: '10px', fontFamily: 'monospace', color: '#94a3b8' }}>{bagId}</span>
                                    {bagState ? <StatusBadge estado={bagState.estado} small /> : <span style={{ fontSize: '9px', color: '#475569' }}>pendiente</span>}
                                </div>
                                {hops.length > 0 ? renderHops(hops) : <div style={{ fontSize: '9px', color: '#64748b', fontStyle: 'italic', paddingLeft: '8px' }}>Sin ruta.</div>}
                            </div>
                        );
                    })}
                    <button onClick={() => { clearTrackedRoute(); setResult(null); }} style={{ marginTop: '4px', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', cursor: 'pointer', width: '100%' }}>
                        Limpiar
                    </button>
                </div>
            )}
        </div>
    );
}
// ── Sección: Listado con estados ──────────────────────────────────────────────
const ESTADO_FILTERS = [
    { value: null,                   label: '⬜ Todos',      color: '#94a3b8' },
    { value: 'EN_ALMACEN_ORIGEN',    label: '🏭 Origen',    color: '#f59e0b' },
    { value: 'EN_ALMACEN_INTERMEDIO',label: '🔄 Escala',    color: '#fb923c' },
    { value: 'EN_VUELO',             label: '✈ Vuelo',     color: '#10b981' },
    { value: 'EN_ALMACEN_DESTINO',   label: '📦 Destino',   color: '#3b82f6' },
    { value: 'ENTREGADO',            label: '✓ Recogido',   color: '#22c55e' },
    { value: 'REPLANIFICACION',      label: '⚠ Replaneando',color: '#ef4444' },
];
function ListSection({ sessionId }) {
    const [shipments, setShipments]     = useState([]);
    const [currentPage, setCurrentPage] = useState(0);
    const [totalPages, setTotalPages]   = useState(0);
    const [loading, setLoading]         = useState(false);
    const [statusByCode, setStatusByCode] = useState({});
    const [expandedCode, setExpandedCode] = useState(null);
    const [hopsForCode, setHopsForCode]   = useState({});
    const [search, setSearch]             = useState('');
    const [statusFilter, setStatusFilter] = useState(null);
    const [filteredByStatus, setFilteredByStatus] = useState(null); // List<globalCode> | null
    const [filteredStatusData, setFilteredStatusData] = useState({});
    const fetchPage = useCallback(async (page = 0) => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ page, size: PAGE_SIZE });
            if (search) params.append('codigo', search);
            const res = await fetch(`/api/v1/envios?${params}`);
            if (res.ok) {
                const data = await res.json();
                setShipments(data.content || []);
                setTotalPages(data.page?.totalPages || data.totalPages || 0);
                setCurrentPage(data.page?.number ?? data.number ?? 0);
            }
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    }, [search]);
    useEffect(() => { fetchPage(0); }, [search]);
    const fetchStatus = useCallback(async (items) => {
        if (!sessionId || items.length === 0) return;
        const codes = items.map(s => buildGlobalCode(s.origenIcao, s.codigoPedido));
        try {
            const r = await apiFetch(`/api/shipments/${sessionId}/status-batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(codes),
            });
            if (r.ok) { const d = await r.json(); setStatusByCode(prev => ({ ...prev, ...d })); }
        } catch (e) { console.error(e); }
    }, [sessionId]);
    useEffect(() => { if (shipments.length > 0) fetchStatus(shipments); }, [sessionId, shipments]);
    useEffect(() => {
        if (!sessionId || shipments.length === 0) return;
        const id = setInterval(() => fetchStatus(shipments), 5000);
        return () => clearInterval(id);
    }, [sessionId, shipments, fetchStatus]);
    useEffect(() => {
        if (!statusFilter || !sessionId) { setFilteredByStatus(null); return; }
        const fetch_ = async () => {
            try {
                const r = await apiFetch(`/api/shipments/${sessionId}/codes-by-status/${statusFilter}`);
                if (!r.ok) return;
                const codes = await r.json();
                setFilteredByStatus(codes);
                if (codes.length > 0) {
                    const r2 = await apiFetch(`/api/shipments/${sessionId}/status-batch`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(codes),
                    });
                    if (r2.ok) setFilteredStatusData(await r2.json());
                }
            } catch (e) { console.error(e); }
        };
        fetch_();
    }, [statusFilter, sessionId]);
    // ── Shipments con estado van primero ────────────────────────────────────
    const sortedShipments = useMemo(() => {
        return [...shipments].sort((a, b) => {
            const gcA = buildGlobalCode(a.origenIcao, a.codigoPedido);
            const gcB = buildGlobalCode(b.origenIcao, b.codigoPedido);
            const hasA = (statusByCode[gcA] || []).length > 0;
            const hasB = (statusByCode[gcB] || []).length > 0;
            if (hasA && !hasB) return -1;
            if (!hasA && hasB) return 1;
            return 0;
        });
    }, [shipments, statusByCode]);
    // ── Filtro por estado ────────────────────────────────────────────────────
    const displayShipments = useMemo(() => {
        if (statusFilter && filteredByStatus !== null) {
            // Modo filtrado: construir objetos mínimos desde los globalCodes del tracker
            return filteredByStatus.map(gc => {
                const [origenIcao, ...rest] = gc.split('_');
                const codigoPedido = rest.join('_');
                // Intentar encontrar el envío real en la página actual
                const found = shipments.find(s => buildGlobalCode(s.origenIcao, s.codigoPedido) === gc);
                return found || { id: gc, codigoPedido, origenIcao, destinoIcao: '—', cantidadMaletas: (filteredStatusData[gc] || []).length,  _fromTracker: true };
            });
        }
        return sortedShipments;
    }, [statusFilter, filteredByStatus, sortedShipments, shipments]);
    const toggleExpand = useCallback(async (shipment) => {
        const gc = buildGlobalCode(shipment.origenIcao, shipment.codigoPedido);
        if (expandedCode === gc) { setExpandedCode(null); return; }
        setExpandedCode(gc);
        if (!hopsForCode[gc] && sessionId) {
            try {
                const res = await apiFetch(`/api/shipments/${sessionId}/shipment/${encodeURIComponent(gc)}/hops`);
                if (res.ok) {
                    const data = await res.json();
                    setHopsForCode(prev => ({ ...prev, [gc]: data }));
                }
            } catch (e) { console.error(e); }
        }
    }, [expandedCode, hopsForCode, sessionId]);
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* Búsqueda */}
            <div style={{ display: 'flex', gap: '4px' }}>
                <input
                    placeholder="Filtrar por código..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{ flex: 1, padding: '5px 8px', fontSize: '11px', background: 'rgba(15,23,42,0.9)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', borderRadius: '4px', outline: 'none' }}
                />
                <button
                    onClick={() => fetchPage(currentPage)}
                    style={{ padding: '5px 10px', fontSize: '11px', background: 'rgba(255,255,255,0.05)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', cursor: 'pointer' }}
                >↻</button>
            </div>
            {/* Filtros de estado — mismo diseño que EntitiesListPanel */}
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {ESTADO_FILTERS.map(opt => (
                    <button
                        key={opt.value ?? 'all'}
                        onClick={() => setStatusFilter(statusFilter === opt.value ? null : opt.value)}
                        style={{
                            padding: '3px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: 'bold',
                            cursor: 'pointer', transition: 'all 0.15s',
                            border: statusFilter === opt.value
                                ? `1px solid ${opt.color}`
                                : '1px solid rgba(255,255,255,0.1)',
                            background: statusFilter === opt.value ? `${opt.color}20` : 'transparent',
                            color:  statusFilter === opt.value ? opt.color : '#64748b',
                        }}
                    >
                        {opt.label}
                    </button>
                ))}
            </div>
            {!sessionId && (
                <div style={{ fontSize: '10px', color: '#64748b', textAlign: 'center' }}>
                    Los estados aparecen durante una simulación activa
                </div>
            )}
            {/* Lista */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '360px', overflowY: 'auto' }}>
                {loading && (
                    <div style={{ fontSize: '11px', color: '#64748b', padding: '12px', textAlign: 'center' }}>
                        Cargando...
                    </div>
                )}
                {displayShipments.map(s => {
                    const gc        = buildGlobalCode(s.origenIcao, s.codigoPedido);
                    const stateList = statusByCode[gc] || filteredStatusData[gc] || [];
                    const isExp     = expandedCode === gc;
                    const counts = {};
                    stateList.forEach(b => { counts[b.estado] = (counts[b.estado] || 0) + 1; });
                    const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
                    const hops     = hopsForCode[gc] || {};
                    const totalBags = s.cantidadMaletas || 0;
                    const bagIds   = Array.from({ length: totalBags }, (_, i) => `${gc}-${i + 1}`);
                    return (
                        <div key={s.id} style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.04)' }}>
                            <div
                                onClick={() => toggleExpand(s)}
                                style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 8px', cursor: 'pointer' }}
                            >
                                {/* ← código global en vez de solo codigoPedido */}
                                <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#38bdf8', fontFamily: 'monospace', minWidth: '140px' }}>
                  {gc}
                </span>
                                <span style={{ fontSize: '10px', color: '#94a3b8' }}>→{s.destinoIcao}</span>
                                {dominant && <StatusBadge estado={dominant} small />}
                                <span style={{ marginLeft: 'auto', fontSize: '10px', color: '#64748b', whiteSpace: 'nowrap' }}>
                  {s.cantidadMaletas} mals ›
                </span>
                            </div>
                            {isExp && (
                                <div style={{ padding: '6px 8px', borderTop: '1px solid rgba(255,255,255,0.04)', background: 'rgba(0,0,0,0.15)' }}>
                                    {bagIds.map(bagId => {
                                        const bagState = stateList.find(b => b.bagId === bagId);
                                        const bagHops  = hops[bagId] || [];
                                        return (
                                            <div key={bagId} style={{ fontSize: '10px', padding: '2px 0' }}>
                                                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          <span style={{ fontFamily: 'monospace', color: '#94a3b8', minWidth: '120px' }}>
                            {bagId.split('_')[1] || bagId}
                          </span>
                                                    {bagState
                                                        ? <StatusBadge estado={bagState.estado} small />
                                                        : <span style={{ color: '#475569', fontSize: '9px' }}>sin datos</span>}
                                                    {bagState?.aeropuertoActual && (
                                                        <span style={{ color: '#64748b', fontSize: '9px' }}>{bagState.aeropuertoActual}</span>
                                                    )}
                                                </div>
                                                {bagHops.length > 0 && (
                                                    <div style={{ paddingLeft: '12px', marginTop: '2px' }}>
                                                        {bagHops.map((h, i) => (
                                                            <div key={i} style={{ fontSize: '9px', color: '#64748b' }}>
                                                                ✈ #{h.vueloId}: {h.origenIcao}→{h.destinoIcao} {formatTime(h.departureTime)}→{formatTime(h.arrivalTime)}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            {/* Paginación */}
            {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', fontSize: '11px' }}>
                    <button
                        onClick={() => fetchPage(currentPage - 1)}
                        disabled={currentPage === 0}
                        style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', padding: '3px 8px', borderRadius: '4px', cursor: currentPage === 0 ? 'not-allowed' : 'pointer' }}
                    >←</button>
                    <span style={{ color: '#64748b' }}>{currentPage + 1} / {totalPages}</span>
                    <button
                        onClick={() => fetchPage(currentPage + 1)}
                        disabled={currentPage === totalPages - 1}
                        style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', padding: '3px 8px', borderRadius: '4px', cursor: currentPage === totalPages - 1 ? 'not-allowed' : 'pointer' }}
                    >→</button>
                </div>
            )}
        </div>
    );
}
// ── Sección: Gestión (Manual + TXT + Bandeja) ─────────────────────────────────
function GestionSection() {
    const { airports } = useAirports();
    const [globalOrigenIcao] = useState(() => localStorage.getItem('profileAirport') || '');
    const [subTab, setSubTab] = useState('manual');
    const [tray, setTray] = useState(() => {
        try { return JSON.parse(localStorage.getItem('shipmentTray') || '[]'); } catch { return []; }
    });
    useEffect(() => { localStorage.setItem('shipmentTray', JSON.stringify(tray)); }, [tray]);
    const [form, setForm] = useState({
        idPedido: '', fecha: new Date().toLocaleDateString('en-CA'),
        hora: new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' }),
        destinoIcao: '', cantidadMaletas: '001', clienteId: '',
    });
    const [selectedFile, setSelectedFile] = useState(null);
    const fileRef = useRef(null);
    const [status, setStatus] = useState({ type: '', msg: '' });
    const [uploading, setUploading] = useState(false);
    const addToTray = (e) => {
        e.preventDefault();
        if (!globalOrigenIcao || !form.destinoIcao) { setStatus({ type:'error', msg:'Selecciona origen y destino.' }); return; }
        if (globalOrigenIcao === form.destinoIcao) { setStatus({ type:'error', msg:'Origen y destino no pueden ser iguales.' }); return; }
        if (!/^\d{7}$/.test(form.clienteId)) { setStatus({ type:'error', msg:'ID Cliente: 7 dígitos.' }); return; }
        if (!/^\d{3}$/.test(form.cantidadMaletas)) { setStatus({ type:'error', msg:'Cantidad: 3 dígitos.' }); return; }
        setTray(prev => [...prev, { idTemp: Date.now() + Math.random().toString(36).slice(2,9), ...form, origenIcao: globalOrigenIcao, idPedido: form.idPedido || `PED-${Date.now().toString().slice(-6)}` }]);
        setStatus({ type:'', msg:'' });
        setForm(prev => ({ ...prev, idPedido:'', cantidadMaletas:'001', destinoIcao:'' }));
    };
    const uploadTray = async () => {
        if (!tray.length) return;
        setUploading(true);
        let ok = 0, fail = 0;
        await Promise.all(tray.map(async s => {
            try {
                const res = await apiFetch('/api/v1/envios/manual', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ fecha:s.fecha, hora:s.hora, origenIcao:s.origenIcao, destinoIcao:s.destinoIcao, cantidadMaletas:parseInt(s.cantidadMaletas), clienteId:s.clienteId }) });
                res.ok ? ok++ : fail++;
            } catch { fail++; }
        }));
        setUploading(false);
        if (fail === 0) { setStatus({ type:'success', msg:`${ok} envíos registrados.` }); setTray([]); }
        else setStatus({ type:'error', msg:`${fail} errores. ${ok} subidos.` });
    };
    const uploadFile = async () => {
        if (!selectedFile || !globalOrigenIcao) return;
        setUploading(true);
        const fd = new FormData();
        fd.append('file', new File([selectedFile], `_envios_${globalOrigenIcao}_.txt`, { type: selectedFile.type }));
        const res = await apiFetch('/api/v1/envios/carga', { method:'POST', body:fd });
        setUploading(false);
        setStatus({ type: res.ok ? 'success' : 'error', msg: res.ok ? 'Archivo cargado correctamente.' : 'Error al procesar el archivo.' });
        if (res.ok) { setSelectedFile(null); if (fileRef.current) fileRef.current.value = ''; }
    };
    const inp = { flex:1, padding:'5px 8px', borderRadius:'4px', fontSize:'11px', background:'rgba(15,23,42,0.9)', border:'1px solid rgba(255,255,255,0.1)', color:'white', outline:'none', boxSizing:'border-box' };
    const statusColor = status.type === 'success' ? '#10b981' : status.type === 'error' ? '#ef4444' : '#38bdf8';
    return (
        <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
            {/* Origen */}
            <div style={{ padding:'6px 10px', background:'rgba(56,189,248,0.08)', border:'1px solid rgba(56,189,248,0.3)', borderRadius:'6px', fontSize:'11px' }}>
                <span style={{ color:'#38bdf8', fontWeight:'bold' }}>Aeropuerto origen: </span>
                <span style={{ color: globalOrigenIcao ? '#f8fafc' : '#ef4444', fontWeight:'bold' }}>{globalOrigenIcao || '⚠ No definido (configure su perfil)'}</span>
            </div>
            {/* Sub-tabs */}
            <div style={{ display:'flex', gap:'4px' }}>
                {[['manual','✏ Manual'],['txt','📁 TXT'],['bandeja','🗂 Bandeja']].map(([k,l]) => (
                    <button key={k} onClick={() => setSubTab(k)} style={{ flex:1, padding:'4px', fontSize:'10px', fontWeight:'bold', borderRadius:'4px', border:'none', cursor:'pointer', background: subTab===k ? '#0ea5e9' : 'rgba(255,255,255,0.05)', color: subTab===k ? '#0f172a' : '#94a3b8' }}>{l}{k==='bandeja' && tray.length>0 ? ` (${tray.length})` : ''}</button>
                ))}
            </div>
            {subTab === 'manual' && globalOrigenIcao && (
                <form onSubmit={addToTray} style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
                    <input placeholder="ID Pedido (opcional)" value={form.idPedido} onChange={e=>setForm(p=>({...p,idPedido:e.target.value}))} style={inp} />
                    <div style={{ display:'flex', gap:'4px' }}>
                        <input type="date" value={form.fecha} onChange={e=>setForm(p=>({...p,fecha:e.target.value}))} required style={{...inp,flex:1}} />
                        <input type="time" value={form.hora} onChange={e=>setForm(p=>({...p,hora:e.target.value}))} required style={{...inp,flex:1}} />
                    </div>
                    <select value={form.destinoIcao} onChange={e=>setForm(p=>({...p,destinoIcao:e.target.value}))} required style={inp}>
                        <option value="">Seleccione destino...</option>
                        {airports.filter(a=>a.icao!==globalOrigenIcao).sort((a,b)=>a.city.localeCompare(b.city)).map(a=>(<option key={a.icao} value={a.icao}>{a.city} ({a.icao})</option>))}
                    </select>
                    <div style={{ display:'flex', gap:'4px' }}>
                        <input placeholder="###" value={form.cantidadMaletas} onChange={e=>setForm(p=>({...p,cantidadMaletas:e.target.value}))} pattern="\d{3}" maxLength="3" required style={{...inp,flex:1}} />
                        <input placeholder="0000001" value={form.clienteId} onChange={e=>setForm(p=>({...p,clienteId:e.target.value}))} maxLength="7" pattern="\d{7}" required style={{...inp,flex:1}} />
                    </div>
                    <button type="submit" style={{ padding:'6px', background:'rgba(16,185,129,0.15)', color:'#34d399', border:'1px solid rgba(16,185,129,0.4)', borderRadius:'6px', cursor:'pointer', fontWeight:'bold', fontSize:'11px' }}>
                        + Agregar a bandeja
                    </button>
                </form>
            )}
            {subTab === 'txt' && globalOrigenIcao && (
                <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
                    <div style={{ fontSize:'10px', color:'#94a3b8' }}>Formato: <code>id_pedido-aaaammdd-hh-mm-dest-###-IdCliente</code></div>
                    <input type="file" accept=".txt,.csv" onChange={e=>setSelectedFile(e.target.files[0])} ref={fileRef} style={{ fontSize:'11px', color:'#94a3b8' }} />
                    {selectedFile && (
                        <button onClick={uploadFile} disabled={uploading} style={{ padding:'6px', background:'rgba(16,185,129,0.15)', color:'#34d399', border:'1px solid rgba(16,185,129,0.4)', borderRadius:'6px', cursor:'pointer', fontWeight:'bold', fontSize:'11px' }}>
                            {uploading ? 'Procesando...' : `Subir: ${selectedFile.name}`}
                        </button>
                    )}
                </div>
            )}
            {subTab === 'bandeja' && (
                <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
                    {tray.length === 0 ? (
                        <div style={{ textAlign:'center', color:'#475569', fontSize:'12px', padding:'16px' }}>Bandeja vacía. Agrega envíos en la pestaña Manual.</div>
                    ) : (
                        <>
                            <div style={{ maxHeight:'240px', overflowY:'auto', display:'flex', flexDirection:'column', gap:'3px' }}>
                                {tray.map(s => (
                                    <div key={s.idTemp} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'5px 8px', background:'rgba(255,255,255,0.02)', borderRadius:'4px', border:'1px solid rgba(255,255,255,0.04)' }}>
                                        <div style={{ fontSize:'11px' }}>
                                            <span style={{ color:'#38bdf8', fontWeight:'bold' }}>{s.origenIcao}→{s.destinoIcao}</span>
                                            <span style={{ color:'#64748b', marginLeft:'8px' }}>{s.cantidadMaletas} uds · {s.idPedido}</span>
                                        </div>
                                        <button onClick={()=>setTray(prev=>prev.filter(x=>x.idTemp!==s.idTemp))} style={{ background:'transparent', border:'none', color:'#ef4444', cursor:'pointer', fontSize:'13px' }}>✕</button>
                                    </div>
                                ))}
                            </div>
                            <button onClick={uploadTray} disabled={uploading} style={{ padding:'6px', background:'rgba(56,189,248,0.15)', color:'#38bdf8', border:'1px solid rgba(56,189,248,0.4)', borderRadius:'6px', cursor:'pointer', fontWeight:'bold', fontSize:'11px' }}>
                                {uploading ? 'Guardando...' : `Guardar ${tray.length} envíos al sistema`}
                            </button>
                            <button onClick={()=>setTray([])} style={{ padding:'4px', background:'transparent', color:'#64748b', border:'none', cursor:'pointer', fontSize:'10px' }}>Limpiar bandeja</button>
                        </>
                    )}
                </div>
            )}
            {status.msg && (
                <div style={{ padding:'6px 10px', borderRadius:'4px', fontSize:'11px', background:`${statusColor}15`, color:statusColor, border:`1px solid ${statusColor}40` }}>
                    {status.msg}
                </div>
            )}
        </div>
    );
}
// ── Componente principal ──────────────────────────────────────────────────────
const TABS = [
    { key: 'tracking', label: '🔍 Rastreo' },
    { key: 'list',     label: '📋 Listado' },
];
export default function MergedShipmentPanel({ sessionId, airports, onSelectFlight, onAirportSelect }) {
    const [activeTab, setActiveTab] = useState('tracking');
    const [auditCount, setAuditCount] = useState(0);
    useEffect(() => {
        if (!sessionId) return;
        const check = async () => {
            try {
                const res = await apiFetch(`/api/shipments/${sessionId}/audit`);
                if (res.ok) { const v = await res.json(); setAuditCount(v.length); }
            } catch {}
        };
        check();
        const id = setInterval(check, 8000);
        return () => clearInterval(id);
    }, [sessionId]);
    return (
        <div style={{ display:'flex', flexDirection:'column', height:'100%', color:'#e2e8f0' }}>
            {/* Tabs */}
            <div style={{ display:'flex', borderBottom:'1px solid rgba(255,255,255,0.08)', flexShrink:0 }}>
                {TABS.map(t => (
                    <button key={t.key} onClick={()=>setActiveTab(t.key)} style={{ flex:1, padding:'8px 4px', fontSize:'10px', fontWeight:'bold', border:'none', cursor:'pointer', background: activeTab===t.key ? 'rgba(96,165,250,0.15)' : 'transparent', color: activeTab===t.key ? '#60a5fa' : '#64748b', borderBottom: activeTab===t.key ? '2px solid #60a5fa' : '2px solid transparent' }}>
                        {t.label}
                    </button>
                ))}
                {/* Badge auditoría */}
                {sessionId && (
                    <div style={{ display:'flex', alignItems:'center', padding:'0 8px', fontSize:'9px', color: auditCount>0 ? '#ef4444' : '#10b981' }}>
                        {auditCount>0 ? `⚠${auditCount}` : '✓'}
                    </div>
                )}
            </div>
            {/* Contenido */}
            <div style={{ flex:1, overflowY:'auto', padding:'8px', minHeight:0 }}>
                {activeTab === 'tracking' && <TrackingSection sessionId={sessionId} airports={airports} />}
                {activeTab === 'list'     && <ListSection sessionId={sessionId} />}
                {activeTab === 'gestion'  && <GestionSection />}
            </div>
        </div>
    );
}