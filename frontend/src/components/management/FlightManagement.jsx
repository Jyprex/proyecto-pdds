import React, { useState, useEffect, useMemo } from 'react';
import { useAirports } from '../../hooks/useAirports';
import { apiFetch } from '../../hooks/api';

const FlightManagement = ({ flights, setFlights }) => {
    const [globalOrigenIcao, setGlobalOrigenIcao] = useState(() => {
        return localStorage.getItem('profileAirport') || '';
    });
    const [status, setStatus] = useState({ type: '', message: '' });
    const [deleteId, setDeleteId] = useState('');
    const [sessionLogs, setSessionLogs] = useState(() => {
        try {
            const saved = localStorage.getItem('flightSessionLogs');
            return saved ? JSON.parse(saved) : [];
        } catch (e) {
            return [];
        }
    });
    const [recentlySavedLogs, setRecentlySavedLogs] = useState(() => {
        try {
            const saved = localStorage.getItem('flightRecentlySavedLogs');
            return saved ? JSON.parse(saved) : [];
        } catch (e) {
            return [];
        }
    });
    const [activeTab, setActiveTab] = useState(() => {
        return localStorage.getItem('flightActiveTab') || 'pending';
    });

    useEffect(() => {
        localStorage.setItem('flightSessionLogs', JSON.stringify(sessionLogs));
    }, [sessionLogs]);

    useEffect(() => {
        localStorage.setItem('flightRecentlySavedLogs', JSON.stringify(recentlySavedLogs));
    }, [recentlySavedLogs]);

    useEffect(() => {
        localStorage.setItem('flightActiveTab', activeTab);
    }, [activeTab]);

    const handleRemoveLog = (indexToRemove) => {
        setSessionLogs(prev => prev.filter((_, index) => index !== indexToRemove));
    };

    const { airports } = useAirports();

    const [entryMode, setEntryMode] = useState('manual');
    const [loading, setLoading] = useState(false);

    const [flightData, setFlightData] = useState({
        destinoIcao: '',
        capacity: '',
        departureTime: '',
        arrivalTime: ''
    });

    const [searchTerm, setSearchTerm] = useState('');
    const [showFilters, setShowFilters] = useState(false);
    const [advancedFilters, setAdvancedFilters] = useState({
        origen: '',
        destino: '',
        minCapacity: '',
        maxCapacity: '',
        minTime: '',
        maxTime: ''
    });
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 15;

    const formatTime = (minutes) => {
        const validMinutes = minutes || 0;
        return `${Math.floor(validMinutes / 60).toString().padStart(2, '0')}:${(validMinutes % 60).toString().padStart(2, '0')}`;
    };

    const filteredFlights = useMemo(() => {
        if (!flights) return [];
        return flights.filter(f => {
            const matchesSearch = !searchTerm || (f.id && f.id.toString().includes(searchTerm));

            if (!matchesSearch) return false;

            if (advancedFilters.origen && !f.origenIcao?.toLowerCase().includes(advancedFilters.origen.toLowerCase())) return false;
            if (advancedFilters.destino && !f.destinoIcao?.toLowerCase().includes(advancedFilters.destino.toLowerCase())) return false;
            
            if (advancedFilters.minCapacity && f.capacity < Number(advancedFilters.minCapacity)) return false;
            if (advancedFilters.maxCapacity && f.capacity > Number(advancedFilters.maxCapacity)) return false;

            if (advancedFilters.minTime) {
                const [h, m] = advancedFilters.minTime.split(':').map(Number);
                if (f.departureMinute < (h * 60 + m)) return false;
            }
            if (advancedFilters.maxTime) {
                const [h, m] = advancedFilters.maxTime.split(':').map(Number);
                if (f.departureMinute > (h * 60 + m)) return false;
            }

            return true;
        });
    }, [flights, searchTerm, advancedFilters]);

    const totalPages = Math.ceil(filteredFlights.length / itemsPerPage) || 1;

    const currentFlights = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        return filteredFlights.slice(start, start + itemsPerPage);
    }, [filteredFlights, currentPage]);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, advancedFilters, entryMode]);

    const fetchFlights = async () => {
        try {
            const res = await apiFetch('/api/v1/vuelos/search');

            if (!res.ok) {
                setStatus({
                    type: 'error',
                    message: 'Error cargando vuelos'
                });
                return;
            }

            const data = await res.json();
            setFlights(data);

        } catch (err) {
            setStatus({
                type: 'error',
                message: 'Error de conexión al obtener vuelos'
            });
        }
    };

    const deleteFlight = async (id) => {
        if (!window.confirm(`¿Estás seguro de que deseas eliminar el vuelo ID ${id} de la base de datos permanentemente?`)) return;
        try {
            const res = await apiFetch(`/api/v1/vuelos/${id}`, { method: 'DELETE' });
            if (res.ok) {
                setStatus({ type: 'success', message: `Vuelo ${id} eliminado correctamente.` });
                fetchFlights();
            } else {
                const text = await res.text();
                setStatus({ type: 'error', message: `Error al eliminar: ${text}` });
            }
        } catch (err) {
            setStatus({ type: 'error', message: `Error de conexión: ${err.message}` });
        }
    };

    const deleteAllFlights = async () => {
        if (!window.confirm(`⚠️ ADVERTENCIA CRÍTICA ⚠️\n\n¿ESTÁS COMPLETAMENTE SEGURO de eliminar TODOS los vuelos de la base de datos?\nEsta acción vaciará por completo la tabla de vuelos y no se puede deshacer.`)) return;

        try {
            const res = await apiFetch('/api/v1/vuelos/delete-all', { method: 'DELETE' });
            if (res.ok) {
                setStatus({ type: 'success', message: '¡Todos los vuelos han sido eliminados correctamente!' });
                fetchFlights();
            } else {
                const text = await res.text();
                setStatus({ type: 'error', message: `Error al eliminar todos: ${text}` });
            }
        } catch (err) {
            setStatus({ type: 'error', message: `Error de conexión: ${err.message}` });
        }
    };

    useEffect(() => {
        if (entryMode === 'list') {
            fetchFlights();
        }
    }, [entryMode]);

    const handleUploadTxt = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!globalOrigenIcao) {
            setStatus({ type: 'error', message: 'No hay perfil seleccionado. Por favor, vuelva a ingresar como Registrador.' });
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target.result;
            const lines = content.split('\n');
            const newFlights = [];

            const lineRegex = /^([A-Z]{4})-(\d{2}:\d{2})-(\d{2}:\d{2})[\s-]+(\d+)/;

            for (const line of lines) {
                const match = line.match(lineRegex);
                if (match) {
                    const [_, destinoIcao, departureTime, arrivalTime, cap] = match;
                    
                    newFlights.push({
                        idTemp: Date.now() + Math.random().toString(36).substr(2, 9),
                        origenIcao: globalOrigenIcao,
                        destinoIcao: destinoIcao.trim(),
                        departureMinute: timeToMinutes(departureTime),
                        arrivalMinute: timeToMinutes(arrivalTime),
                        capacity: parseInt(cap, 10),
                        source: 'TXT'
                    });
                }
            }

            if (newFlights.length > 0) {
                setSessionLogs(prev => [...newFlights, ...prev]);
                setActiveTab('pending');
                setStatus({ type: 'success', message: `Se cargaron ${newFlights.length} vuelos desde el archivo TXT.` });
            } else {
                setStatus({ type: 'error', message: 'No se encontraron vuelos con el formato esperado en el archivo TXT.' });
            }
        };
        reader.readAsText(file);
        e.target.value = ''; // Reset input
    };
    const timeToMinutes = (time) => {
        const [h, m] = time.split(':').map(Number);
        return h * 60 + m;
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;

        setFlightData(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const handleCreateFlight = () => {
        if (!globalOrigenIcao) {
            setStatus({ type: 'error', message: 'No hay perfil seleccionado. Por favor, vuelva a ingresar como Registrador.' });
            return;
        }

        if (
            !flightData.destinoIcao ||
            !flightData.capacity ||
            !flightData.departureTime ||
            !flightData.arrivalTime
        ) {
            setStatus({ type: 'error', message: 'Complete todos los campos.' });
            return;
        }

        const newFlight = {
            idTemp: Date.now() + Math.random().toString(36).substr(2, 9),
            origenIcao: globalOrigenIcao,
            destinoIcao: flightData.destinoIcao,
            capacity: Number(flightData.capacity),
            departureMinute: timeToMinutes(flightData.departureTime),
            arrivalMinute: timeToMinutes(flightData.arrivalTime)
        };

        setSessionLogs(prev => [{...newFlight, source: 'Manual'}, ...prev]);
        setActiveTab('pending');
        setStatus({ type: 'success', message: 'Vuelo añadido a la bandeja.' });

        setFlightData({
            destinoIcao: '',
            capacity: '',
            departureTime: '',
            arrivalTime: ''
        });
    };

    const handleUploadToLiveSystem = async () => {
        if (sessionLogs.length === 0) return;
        setLoading(true);
        setStatus({ type: 'info', message: 'Enviando a la red base de datos...' });

        let successCount = 0;
        let failCount = 0;
        let newlySaved = [];
        let lastErrorMessage = '';

        await Promise.all(sessionLogs.map(async (flight) => {
            try {
                const payload = {
                    origenIcao: flight.origenIcao,
                    destinoIcao: flight.destinoIcao,
                    capacity: flight.capacity,
                    departureMinute: flight.departureMinute,
                    arrivalMinute: flight.arrivalMinute
                };

                const res = await apiFetch('/api/v1/vuelos/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (res.ok) {
                    successCount++;
                    const savedData = await res.json();
                    newlySaved.push({ ...flight, id: savedData.id });
                } else {
                    failCount++;
                    try {
                        const errData = await res.json();
                        if (errData.message) lastErrorMessage = errData.message;
                    } catch(e) {}
                }
            } catch (err) {
                failCount++;
                if (err.message) lastErrorMessage = err.message;
            }
        }));

        setLoading(false);

        if (failCount === 0) {
            setStatus({ type: 'success', message: `¡Los ${successCount} vuelos se registraron exitosamente!` });
            setRecentlySavedLogs(prev => [...newlySaved, ...prev]);
            setSessionLogs([]);
            setActiveTab('saved');
            await fetchFlights();
        } else {
            let errorText = `Hubo ${failCount} errores. Solo se registraron ${successCount} vuelos.`;
            if (lastErrorMessage) errorText += ` Detalle: ${lastErrorMessage}`;
            setStatus({ type: 'error', message: errorText });
            if (newlySaved.length > 0) {
                setRecentlySavedLogs(prev => [...newlySaved, ...prev]);
                setSessionLogs(prev => prev.filter(p => !newlySaved.some(s => s.idTemp === p.idTemp)));
                setActiveTab('saved');
            }
            await fetchFlights();
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', color: '#dbe6f2' }}>
            
            {/* TOGGLE MANUAL / TXT / LIST */}
            <div style={toggleContainerStyle}>
                <button type="button" onClick={() => setEntryMode('manual')} style={toggleBtnStyle(entryMode === 'manual', 'manual')}>Ingreso Manual</button>
                <button type="button" onClick={() => setEntryMode('txt')} style={toggleBtnStyle(entryMode === 'txt', 'txt')}>Masivo por TXT</button>
                <button type="button" onClick={() => setEntryMode('list')} style={toggleBtnStyle(entryMode === 'list', 'list')}>Listado General</button>
            </div>
            
            {entryMode !== 'list' && (
                <div style={{ padding: '1rem', background: 'rgba(56, 189, 248, 0.1)', border: '1px solid rgba(56,189,248,0.4)', borderRadius: '8px', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <span style={{ fontSize: '11px', color: '#38bdf8', fontWeight: 'bold', textTransform: 'uppercase' }}>Aeropuerto de Origen (Por Perfil)</span>
                        <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#f8fafc', marginTop: '0.2rem' }}>
                            {globalOrigenIcao || 'No definido'}
                        </div>
                    </div>
                    {!globalOrigenIcao && (
                        <span style={{ color: '#ef4444', fontSize: '12px' }}>
                            ⚠ Debe ingresar desde la pantalla de selección de rol.
                        </span>
                    )}
                </div>
            )}

            <div style={{ display: 'flex', gap: '1.5rem', flex: 1, minHeight: 0 }}>
                {/* Lado Izquierdo: Formularios */}
                <div style={{ flex: 1, overflowY: 'auto', paddingRight: '0.5rem' }}>

            {entryMode === 'manual' && globalOrigenIcao && (
                <div style={{ background: 'rgba(15, 23, 42, 0.8)', border: '1px solid rgba(56,189,248,0.2)', padding: '1.5rem', borderRadius: '12px', marginBottom: '1.5rem' }}>
                    <h3 style={{ margin: '0 0 1rem 0', color: '#38bdf8', fontSize: '16px' }}>Registro Manual de Vuelo Excepcional</h3>
                    <form style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div>
                            <label style={labelStyle}>ORIGEN (AUTOMÁTICO)</label>
                            <input
                                type="text"
                                value={globalOrigenIcao}
                                disabled
                                style={{ ...inputStyle, opacity: 0.7, cursor: 'not-allowed' }}
                            />
                        </div>
                        <div>
                            <label style={labelStyle}>DESTINO (ICAO)</label>
                            <select
                                name="destinoIcao"
                                value={flightData.destinoIcao}
                                onChange={handleInputChange}
                                style={inputStyle}
                            >
                                <option value="">Seleccione destino...</option>

                                {[...airports]
                                    .sort((a, b) => a.city.localeCompare(b.city))
                                    .map(a => (
                                        <option key={a.icao} value={a.icao}>
                                            {a.city} ({a.icao})
                                        </option>
                                    ))
                                }
                            </select>
                        </div>
                        <div>
                            <label style={labelStyle}>HORA SALIDA (HO:MO)</label>
                            <input
                                type="time"
                                name="departureTime"
                                value={flightData.departureTime}
                                onChange={handleInputChange}
                                style={inputStyle}
                            />
                        </div>
                        <div>
                            <label style={labelStyle}>HORA LLEGADA (HD:MD)</label>
                            <input
                                type="time"
                                name="arrivalTime"
                                value={flightData.arrivalTime}
                                onChange={handleInputChange}
                                style={inputStyle}
                            />
                        </div>
                        <div style={{ gridColumn: 'span 2' }}>
                            <label style={labelStyle}>CAPACIDAD (####)</label>
                            <input
                                type="number"
                                name="capacity"
                                value={flightData.capacity}
                                onChange={handleInputChange}
                                placeholder="Ej: 250"
                                style={inputStyle}
                            />
                        </div>
                        <div style={{ gridColumn: 'span 2' }}>
                            <button
                                type="button"
                                onClick={handleCreateFlight}
                                style={{
                                    ...btnStylePrimary,
                                    background: 'rgba(255,255,255,0.05)',
                                    color: '#dbe6f2',
                                    border: '1px solid rgba(255,255,255,0.2)'
                                }}
                            >
                                Registrar Vuelo
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {entryMode === 'txt' && globalOrigenIcao && (
                <div style={{ background: 'rgba(15, 23, 42, 0.8)', border: '1px dashed rgba(148, 163, 184, 0.3)', padding: '1.5rem', borderRadius: '12px', marginBottom: '1.5rem' }}>
                    <h3 style={{ margin: '0 0 0.5rem 0', color: '#e2e8f0', fontSize: '14px' }}>Carga Masiva de Planes de Vuelo (.TXT)</h3>
                    <p style={{ margin: '0 0 1rem 0', fontSize: '11px', color: '#64748b' }}>Formato esperado: DEST-HO:MO-HD:MD ####</p>
                    <input 
                        type="file" 
                        accept=".txt" 
                        onChange={handleUploadTxt}
                        style={{ width: '100%', color: '#94a3b8', fontSize: '12px' }} 
                    />
                </div>
            )}

            {status.message && (
                <div style={getStatusStyle(status.type)}>
                    {status.message}
                </div>
            )}
            </div> {/* Cierra columna izquierda */}

            {/* Columna Derecha: LOG DE SESIÓN / RECIENTES */}
            {entryMode !== 'list' && (
                <div style={{ width: '300px', background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: '0', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex' }}>
                        <button 
                            onClick={() => setActiveTab('pending')}
                            style={{ flex: 1, padding: '1rem 0.5rem', background: activeTab === 'pending' ? 'rgba(56, 189, 248, 0.1)' : 'transparent', border: 'none', borderBottom: activeTab === 'pending' ? '2px solid #38bdf8' : '2px solid transparent', color: activeTab === 'pending' ? '#38bdf8' : '#94a3b8', cursor: 'pointer', fontWeight: 'bold', transition: 'all 0.2s', fontSize: '13px' }}
                        >
                            Pendientes ({sessionLogs.length})
                        </button>
                        <button 
                            onClick={() => setActiveTab('saved')}
                            style={{ flex: 1, padding: '1rem 0.5rem', background: activeTab === 'saved' ? 'rgba(16, 185, 129, 0.1)' : 'transparent', border: 'none', borderBottom: activeTab === 'saved' ? '2px solid #10b981' : '2px solid transparent', color: activeTab === 'saved' ? '#10b981' : '#94a3b8', cursor: 'pointer', fontWeight: 'bold', transition: 'all 0.2s', fontSize: '13px' }}
                        >
                            Guardados ({recentlySavedLogs.length})
                        </button>
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {activeTab === 'pending' ? (
                            sessionLogs.length === 0 ? (
                                <p style={{ color: '#64748b', fontSize: '12px', textAlign: 'center', marginTop: '2rem' }}>No hay vuelos pendientes de guardar.</p>
                            ) : (
                                sessionLogs.map((log, idx) => {
                                    const origen = airports.find(a => a.icao === log.origenIcao);
                                    const gmt = origen ? origen.gmtOffset : 0;
                                    let localMin = (log.departureMinute + (gmt * 60)) % 1440;
                                    if (localMin < 0) localMin += 1440;
                                    
                                    return (
                                        <div key={idx} style={{ position: 'relative', background: 'rgba(30, 41, 59, 0.8)', padding: '0.75rem', borderRadius: '8px', borderLeft: `3px solid ${log.source === 'TXT' ? '#10b981' : '#38bdf8'}`, fontSize: '12px' }}>
                                            <button 
                                                onClick={() => handleRemoveLog(idx)}
                                                style={{ position: 'absolute', top: '5px', right: '5px', background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '16px', lineHeight: 1, padding: '2px 5px' }}
                                                title="Quitar log"
                                            >
                                                ×
                                            </button>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', paddingRight: '15px' }}>
                                                <span style={{ fontWeight: 'bold', color: '#e2e8f0' }}>ID: {log.idTemp ? 'N/A' : log.id}</span>
                                                <span style={{ color: '#94a3b8' }}>{log.origenIcao} ✈️ {log.destinoIcao}</span>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginTop: '0.5rem' }}>
                                                <div style={{ color: '#94a3b8' }}>Local: <strong style={{ color: '#fff' }}>{formatTime(localMin)}</strong></div>
                                                <div style={{ color: '#94a3b8' }}>UTC: <strong style={{ color: '#fff' }}>{formatTime(log.departureMinute)}</strong></div>
                                            </div>
                                        </div>
                                    );
                                })
                            )
                        ) : (
                            recentlySavedLogs.length === 0 ? (
                                <p style={{ color: '#64748b', fontSize: '12px', textAlign: 'center', marginTop: '2rem' }}>No hay guardados recientes en esta sesión.</p>
                            ) : (
                                recentlySavedLogs.map((log, idx) => {
                                    const origen = airports.find(a => a.icao === log.origenIcao);
                                    const gmt = origen ? origen.gmtOffset : 0;
                                    let localMin = (log.departureMinute + (gmt * 60)) % 1440;
                                    if (localMin < 0) localMin += 1440;
                                    
                                    return (
                                        <div key={idx} style={{ position: 'relative', background: 'rgba(30, 41, 59, 0.8)', padding: '0.75rem', borderRadius: '8px', borderLeft: `3px solid #10b981`, fontSize: '12px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                                                <span style={{ fontWeight: 'bold', color: '#e2e8f0' }}>ID: {log.id}</span>
                                                <span style={{ color: '#94a3b8' }}>{log.origenIcao} ✈️ {log.destinoIcao}</span>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginTop: '0.5rem' }}>
                                                <div style={{ color: '#34d399', fontWeight: 'bold' }}>Cap: {log.capacity}</div>
                                                <div style={{ color: '#10b981' }}>✓ Guardado</div>
                                            </div>
                                        </div>
                                    );
                                })
                            )
                        )}
                    </div>
                    
                    {activeTab === 'pending' && (
                        <div style={{ padding: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                            <button 
                                onClick={handleUploadToLiveSystem} 
                                disabled={sessionLogs.length === 0 || loading}
                                style={{
                                    ...btnStylePrimary,
                                    background: sessionLogs.length === 0 ? '#1e293b' : 'rgba(56, 189, 248, 0.15)',
                                    color: sessionLogs.length === 0 ? '#475569' : '#38bdf8',
                                    cursor: sessionLogs.length === 0 || loading ? 'not-allowed' : 'pointer'
                                }}
                            >
                                {loading ? 'GUARDANDO...' : 'GUARDAR TODO AL SISTEMA'}
                            </button>
                        </div>
                    )}

                    {activeTab === 'saved' && recentlySavedLogs.length > 0 && (
                        <div style={{ padding: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                            <button 
                                onClick={() => setRecentlySavedLogs([])} 
                                style={{
                                    ...btnStyleSecondary,
                                    width: '100%',
                                    color: '#94a3b8',
                                    borderColor: 'rgba(148, 163, 184, 0.3)',
                                    background: 'rgba(255, 255, 255, 0.05)'
                                }}
                            >
                                Limpiar Recientes
                            </button>
                        </div>
                    )}
                </div>
            )}
            
            </div> {/* Cierra layout flex principal */}

            {entryMode === 'list' && (
                <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.1)', padding: '1.5rem', borderRadius: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
                        <h3 style={{ margin: 0, color: '#e2e8f0', fontSize: '16px' }}>Listado General de Vuelos</h3>
                        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            <input 
                                type="text"
                                placeholder="Búsqueda por ID..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                style={{ ...inputStyle, padding: '6px 12px', width: '200px' }}
                            />
                            <button 
                                onClick={() => setShowFilters(!showFilters)} 
                                style={{
                                    ...btnStyleSecondary, 
                                    background: showFilters ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255,255,255,0.05)',
                                    borderColor: showFilters ? 'rgba(56, 189, 248, 0.4)' : 'rgba(255,255,255,0.1)',
                                    color: showFilters ? '#38bdf8' : '#dbe6f2'
                                }}
                            >
                                ⚙ Filtros
                            </button>
                            <button onClick={fetchFlights} style={btnStyleSecondary}>↻ Actualizar</button>
                            <div style={{ display: 'flex', marginLeft: 'auto', gap: '0.5rem' }}>
                                <input
                                    type="text"
                                    placeholder="ID a eliminar"
                                    value={deleteId}
                                    onChange={(e) => setDeleteId(e.target.value)}
                                    style={{ ...inputStyle, padding: '6px 10px', width: '120px' }}
                                />
                                <button
                                    onClick={() => { if(deleteId) { deleteFlight(deleteId); setDeleteId(''); } }}
                                    style={{ ...btnStyleSecondary, color: '#f87171', borderColor: 'rgba(248, 113, 113, 0.3)', background: 'transparent' }}
                                >
                                    Eliminar Vuelo
                                </button>
                                <button
                                    onClick={deleteAllFlights}
                                    style={{ ...btnStyleSecondary, color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.5)', background: 'rgba(239, 68, 68, 0.1)' }}
                                >
                                    ⚠️ Limpiar Todos
                                </button>
                            </div>
                        </div>
                    </div>

                    {showFilters && (
                        <div style={{ background: 'rgba(30, 41, 59, 0.6)', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem', border: '1px solid rgba(255,255,255,0.05)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '10px' }}>ORIGEN</label>
                                <input 
                                    type="text" 
                                    placeholder="Ej: SKBO" 
                                    value={advancedFilters.origen} 
                                    onChange={(e) => setAdvancedFilters(p => ({ ...p, origen: e.target.value }))}
                                    style={{ ...inputStyle, padding: '6px 10px', fontSize: '12px' }} 
                                />
                            </div>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '10px' }}>DESTINO</label>
                                <input 
                                    type="text" 
                                    placeholder="Ej: SEQM" 
                                    value={advancedFilters.destino} 
                                    onChange={(e) => setAdvancedFilters(p => ({ ...p, destino: e.target.value }))}
                                    style={{ ...inputStyle, padding: '6px 10px', fontSize: '12px' }} 
                                />
                            </div>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '10px' }}>CAPACIDAD MIN</label>
                                <input 
                                    type="number" 
                                    placeholder="Min" 
                                    value={advancedFilters.minCapacity} 
                                    onChange={(e) => setAdvancedFilters(p => ({ ...p, minCapacity: e.target.value }))}
                                    style={{ ...inputStyle, padding: '6px 10px', fontSize: '12px' }} 
                                />
                            </div>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '10px' }}>CAPACIDAD MAX</label>
                                <input 
                                    type="number" 
                                    placeholder="Max" 
                                    value={advancedFilters.maxCapacity} 
                                    onChange={(e) => setAdvancedFilters(p => ({ ...p, maxCapacity: e.target.value }))}
                                    style={{ ...inputStyle, padding: '6px 10px', fontSize: '12px' }} 
                                />
                            </div>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '10px' }}>SALIDA DESDE</label>
                                <input 
                                    type="time" 
                                    value={advancedFilters.minTime} 
                                    onChange={(e) => setAdvancedFilters(p => ({ ...p, minTime: e.target.value }))}
                                    style={{ ...inputStyle, padding: '6px 10px', fontSize: '12px' }} 
                                />
                            </div>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '10px' }}>SALIDA HASTA</label>
                                <input 
                                    type="time" 
                                    value={advancedFilters.maxTime} 
                                    onChange={(e) => setAdvancedFilters(p => ({ ...p, maxTime: e.target.value }))}
                                    style={{ ...inputStyle, padding: '6px 10px', fontSize: '12px' }} 
                                />
                            </div>
                            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
                                <button 
                                    onClick={() => setAdvancedFilters({ origen: '', destino: '', minCapacity: '', maxCapacity: '', minTime: '', maxTime: '' })} 
                                    style={{ ...btnStyleSecondary, color: '#f87171', borderColor: 'rgba(248, 113, 113, 0.3)', background: 'transparent' }}
                                >
                                    Limpiar Filtros
                                </button>
                            </div>
                        </div>
                    )}

                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                            <thead>
                                <tr style={{ background: 'rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'left' }}>
                                    <th style={{ padding: '12px' }}>ID Vuelo</th>
                                    <th style={{ padding: '12px' }}>Origen</th>
                                    <th style={{ padding: '12px' }}>Destino</th>
                                    <th style={{ padding: '12px' }}>Salida</th>
                                    <th style={{ padding: '12px' }}>Llegada</th>
                                    <th style={{ padding: '12px' }}>Capacidad</th>
                                    <th style={{ padding: '12px', textAlign: 'center' }}>Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {currentFlights.length === 0 ? (
                                    <tr><td colSpan="6" style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>No hay vuelos que coincidan con la búsqueda.</td></tr>
                                ) : (
                                    currentFlights.map((vuelo, idx) => (
                                        <tr key={vuelo.id || idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                                            <td style={{ padding: '12px', color: '#94a3b8' }}>{vuelo.id || 'N/A'}</td>
                                            <td style={{ padding: '12px', color: '#38bdf8', fontWeight: 'bold' }}>{vuelo.origenIcao}</td>
                                            <td style={{ padding: '12px', color: '#34d399', fontWeight: 'bold' }}>{vuelo.destinoIcao}</td>
                                            <td style={{ padding: '12px' }}>{formatTime(vuelo.departureMinute)}</td>
                                            <td style={{ padding: '12px' }}>{formatTime(vuelo.arrivalMinute)}</td>
                                            <td style={{ padding: '12px' }}>{vuelo.capacity}</td>
                                            <td style={{ padding: '12px', textAlign: 'center' }}>
                                                <button
                                                    onClick={() => deleteFlight(vuelo.id)}
                                                    style={{ background: 'transparent', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', transition: '0.2s' }}
                                                >
                                                    Eliminar
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {totalPages > 1 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.5rem' }}>
                            <span style={{ color: '#94a3b8', fontSize: '12px' }}>
                                Mostrando {((currentPage - 1) * itemsPerPage) + 1} a {Math.min(currentPage * itemsPerPage, filteredFlights.length)} de {filteredFlights.length} vuelos
                            </span>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button 
                                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                    disabled={currentPage === 1}
                                    style={{ ...btnStyleSecondary, opacity: currentPage === 1 ? 0.5 : 1, cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}
                                >
                                    Anterior
                                </button>
                                <span style={{ color: '#e2e8f0', fontSize: '13px', display: 'flex', alignItems: 'center', padding: '0 8px' }}>
                                    Página {currentPage} de {totalPages}
                                </span>
                                <button 
                                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                    disabled={currentPage === totalPages}
                                    style={{ ...btnStyleSecondary, opacity: currentPage === totalPages ? 0.5 : 1, cursor: currentPage === totalPages ? 'not-allowed' : 'pointer' }}
                                >
                                    Siguiente
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const labelStyle = { display: 'block', marginBottom: '0.4rem', fontSize: '11px', color: '#94a3b8' };
const inputStyle = {
    width: '100%', padding: '0.6rem 0.8rem', borderRadius: '6px',
    background: 'rgba(15, 23, 42, 0.9)', border: '1px solid rgba(255,255,255,0.1)',
    color: 'white', boxSizing: 'border-box', fontSize: '13px', outline: 'none'
};

const btnStylePrimary = {
    width: '100%', padding: '10px', background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8',
    border: '1px solid rgba(56,189,248,0.4)', borderRadius: '8px', cursor: 'pointer',
    fontWeight: 'bold', fontSize: '13px', transition: 'all 0.2s'
};

const btnStyleSecondary = {
    width: 'auto', padding: '6px 12px', background: 'rgba(255,255,255,0.05)', color: '#dbe6f2',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', cursor: 'pointer',
    fontWeight: 'bold', fontSize: '12px', transition: 'all 0.2s'
};

const getStatusStyle = (type) => ({
    padding: '12px 16px', borderRadius: '8px', fontSize: '13px',
    background: type === 'success' ? 'rgba(16,185,129,0.1)' : 'rgba(56,189,248,0.1)',
    border: `1px solid ${type === 'success' ? '#10b981' : '#38bdf8'}`,
    color: type === 'success' ? '#34d399' : '#7dd3fc'
});

const toggleContainerStyle = { display: 'flex', gap: '1rem', marginBottom: '1.5rem', background: 'rgba(15, 23, 42, 0.5)', padding: '10px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.2)' };
const toggleBtnStyle = (active, type = 'manual') => {
    let activeBg = '#38bdf8'; // Blue
    if (type === 'txt') activeBg = '#10b981'; // Green
    if (type === 'list') activeBg = '#f59e0b'; // Amber
    return {
        flex: 1, padding: '12px 16px', borderRadius: '8px', border: '1px solid', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold', transition: 'all 0.3s ease',
        background: active ? activeBg : 'rgba(30, 41, 59, 0.7)',
        color: active ? '#0f172a' : '#94a3b8',
        borderColor: active ? activeBg : 'rgba(255,255,255,0.1)',
        boxShadow: active ? `0 4px 15px ${activeBg}40` : 'none',
        textTransform: 'uppercase',
        letterSpacing: '0.5px'
    };
};

export default FlightManagement;
