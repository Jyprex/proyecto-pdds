import React, { useState, useEffect, useMemo } from 'react';
import { useAirports } from '../../hooks/useAirports';

const WarehouseManagement = () => {
    const [status, setStatus] = useState({ type: '', message: '' });
    const [entryMode, setEntryMode] = useState('manual');
    const [loading, setLoading] = useState(false);
    const [warehouses, setWarehouses] = useState([]);
    const [sessionLogs, setSessionLogs] = useState(() => {
        try {
            const saved = localStorage.getItem('warehouseSessionLogs');
            return saved ? JSON.parse(saved) : [];
        } catch (e) {
            return [];
        }
    });
    const [recentlySavedLogs, setRecentlySavedLogs] = useState(() => {
        try {
            const saved = localStorage.getItem('warehouseRecentlySavedLogs');
            return saved ? JSON.parse(saved) : [];
        } catch (e) {
            return [];
        }
    });
    const [activeTab, setActiveTab] = useState(() => {
        return localStorage.getItem('warehouseActiveTab') || 'pending';
    });

    useEffect(() => {
        localStorage.setItem('warehouseSessionLogs', JSON.stringify(sessionLogs));
    }, [sessionLogs]);

    useEffect(() => {
        localStorage.setItem('warehouseRecentlySavedLogs', JSON.stringify(recentlySavedLogs));
    }, [recentlySavedLogs]);

    useEffect(() => {
        localStorage.setItem('warehouseActiveTab', activeTab);
    }, [activeTab]);

    useEffect(() => {
        // Validate recently saved logs against the backend on mount
        // If the backend was restarted and lost data, this clears the ghost logs
        const savedStr = localStorage.getItem('warehouseRecentlySavedLogs');
        if (savedStr) {
            try {
                const saved = JSON.parse(savedStr);
                if (saved.length > 0) {
                    fetch('/api/v1/aeropuertos')
                        .then(res => {
                            if (res.ok) return res.json();
                            throw new Error('Network response was not ok.');
                        })
                        .then(data => {
                            // Create a signature for each backend record (ICAO + Capacity)
                            // This ensures that if the backend restarted and capacities reset, ghost logs are cleared.
                            const existingSignatures = new Set(data.map(a => `${a.icaoCode}-${a.storageCapacity}`));
                            setRecentlySavedLogs(prev => prev.filter(log => existingSignatures.has(`${log.icaoCode}-${log.storageCapacity}`)));
                        })
                        .catch(() => {});
                }
            } catch (e) {}
        }
    }, []);

    const handleRemoveLog = (indexToRemove) => {
        setSessionLogs(prev => prev.filter((_, index) => index !== indexToRemove));
    };

    const { refreshAirports } = useAirports();

    const [searchTerm, setSearchTerm] = useState('');
    const [showFilters, setShowFilters] = useState(false);
    const [advancedFilters, setAdvancedFilters] = useState({
        icao: '',
        ciudad: '',
        pais: '',
        continente: '',
        minCapacity: '',
        maxCapacity: '',
        gmt: ''
    });
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 15;

    const filteredWarehouses = useMemo(() => {
        if (!warehouses) return [];
        return warehouses.filter(w => {
            const matchesSearch = !searchTerm || (w.id && w.id.toString().includes(searchTerm));
            if (!matchesSearch) return false;

            if (advancedFilters.icao && !w.icaoCode?.toLowerCase().includes(advancedFilters.icao.toLowerCase())) return false;
            if (advancedFilters.ciudad && !w.city?.toLowerCase().includes(advancedFilters.ciudad.toLowerCase())) return false;
            if (advancedFilters.pais && !w.country?.toLowerCase().includes(advancedFilters.pais.toLowerCase())) return false;
            if (advancedFilters.continente && !w.continent?.toLowerCase().includes(advancedFilters.continente.toLowerCase())) return false;
            
            if (advancedFilters.minCapacity && w.storageCapacity < Number(advancedFilters.minCapacity)) return false;
            if (advancedFilters.maxCapacity && w.storageCapacity > Number(advancedFilters.maxCapacity)) return false;

            if (advancedFilters.gmt && w.gmtOffset !== Number(advancedFilters.gmt)) return false;

            return true;
        });
    }, [warehouses, searchTerm, advancedFilters]);

    const totalPages = Math.ceil(filteredWarehouses.length / itemsPerPage) || 1;

    const currentWarehouses = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        return filteredWarehouses.slice(start, start + itemsPerPage);
    }, [filteredWarehouses, currentPage]);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, advancedFilters, entryMode]);

    const fetchWarehouses = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/v1/aeropuertos');
            if (res.ok) {
                const data = await res.json();
                setWarehouses(data);
            } else {
                setStatus({ type: 'error', message: 'Error al obtener almacenes' });
            }
        } catch (err) {
            setStatus({ type: 'error', message: 'Error de conexión' });
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteWarehouse = async (id) => {
        if (!window.confirm("¿Está seguro de eliminar este almacén?")) return;
        setLoading(true);
        try {
            const res = await fetch(`/api/v1/aeropuertos/${id}`, { method: 'DELETE' });
            if (res.ok) {
                setStatus({ type: 'success', message: 'Almacén eliminado exitosamente.' });
                fetchWarehouses();
            } else {
                const errData = await res.json().catch(() => ({}));
                setStatus({ type: 'error', message: errData.message || 'No se pudo eliminar el almacén. Puede que tenga datos asociados.' });
            }
        } catch (err) {
            setStatus({ type: 'error', message: 'Error de conexión' });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchWarehouses();
    }, []);

    const [formData, setFormData] = useState({
        icaoCode: '',
        city: '',
        country: '',
        continent: 'AMERICA',
        storageCapacity: '',
        latitude: '',
        longitude: '',
        gmtOffset: ''
    });

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));

        if (name === 'icaoCode' && value.length === 4) {
            const airport = warehouses.find(w => w.icaoCode.toUpperCase() === value.toUpperCase());
            if (airport) {
                setFormData(prev => ({
                    ...prev,
                    city: airport.city || '',
                    country: airport.country || '',
                    continent: airport.continent || 'AMERICA',
                    latitude: airport.latitude || '',
                    longitude: airport.longitude || '',
                    gmtOffset: airport.gmtOffset || ''
                }));
            }
        }
    };

    const handleManualSubmit = (e) => {
        e.preventDefault();
        setStatus({ type: '', message: '' });

        const newWarehouse = {
            idTemp: Date.now() + Math.random().toString(36).substr(2, 9),
            icaoCode: formData.icaoCode.trim().toUpperCase(),
            city: formData.city.trim(),
            country: formData.country.trim(),
            continent: formData.continent,
            storageCapacity: parseInt(formData.storageCapacity, 10),
            latitude: parseFloat(formData.latitude),
            longitude: parseFloat(formData.longitude),
            gmtOffset: parseInt(formData.gmtOffset, 10) || 0
        };

        setSessionLogs(prev => [{...newWarehouse, source: 'Manual'}, ...prev]);
        setActiveTab('pending');
        setStatus({ type: 'success', message: 'Almacén añadido a la bandeja.' });
        
        setFormData({
            icaoCode: '', city: '', country: '', continent: 'AMERICA',
            storageCapacity: '', latitude: '', longitude: '', gmtOffset: ''
        });
    };

    const handleTxtUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target.result;
            const lines = content.split('\n');
            let currentContinent = 'AMERICA';
            const newWarehouses = [];

            const lineRegex = /^\s*\d+\s+([A-Z]{4})\s+(.+?)\s{2,}(.+?)\s{2,}\w+\s+([+-]?\d+)\s+(\d+)\s+Latitude:\s*(\d+)°\s*(\d+)'\s*(\d+)["']?\s*([NS])\s+Longitude:\s*(\d+)°\s*(\d+)'\s*(\d+)["']?\s*([EW])/;

            for (const line of lines) {
                const lowerLine = line.toLowerCase();
                if (lowerLine.includes('america')) currentContinent = 'AMERICA';
                else if (lowerLine.includes('europa')) currentContinent = 'EUROPE';
                else if (lowerLine.includes('asia')) currentContinent = 'ASIA';
                else if (lowerLine.includes('africa')) currentContinent = 'AFRICA';
                else if (lowerLine.includes('oceania')) currentContinent = 'OCEANIA';

                const match = line.match(lineRegex);
                if (match) {
                    const [
                        _, icaoCode, city, country, gmtOff, cap,
                        latDeg, latMin, latSec, latDir,
                        lonDeg, lonMin, lonSec, lonDir
                    ] = match;

                    const parseDMS = (deg, min, sec, dir) => {
                        let dec = parseInt(deg, 10) + parseInt(min, 10)/60 + parseInt(sec, 10)/3600;
                        if (dir === 'S' || dir === 'W') dec = -dec;
                        return dec;
                    };

                    newWarehouses.push({
                        idTemp: Date.now() + Math.random().toString(36).substr(2, 9),
                        icaoCode: icaoCode.trim(),
                        city: city.trim(),
                        country: country.trim(),
                        continent: currentContinent,
                        storageCapacity: parseInt(cap, 10),
                        gmtOffset: parseInt(gmtOff, 10),
                        latitude: parseDMS(latDeg, latMin, latSec, latDir),
                        longitude: parseDMS(lonDeg, lonMin, lonSec, lonDir),
                        source: 'TXT'
                    });
                }
            }

            if (newWarehouses.length > 0) {
                setSessionLogs(prev => [...newWarehouses, ...prev]);
                setActiveTab('pending');
                setStatus({ type: 'success', message: `Se cargaron ${newWarehouses.length} almacenes desde el archivo TXT.` });
            } else {
                setStatus({ type: 'error', message: 'No se encontraron almacenes con el formato esperado en el archivo TXT.' });
            }
        };
        reader.readAsText(file);
        e.target.value = ''; // Reset input
    };

    const handleUploadToLiveSystem = async () => {
        if (sessionLogs.length === 0) return;
        setLoading(true);
        setStatus({ type: 'info', message: 'Enviando a la red base de datos...' });

        let successCount = 0;
        let failCount = 0;
        let newlySaved = [];

        try {
            const listRes = await fetch('/api/v1/aeropuertos');
            let existingAirports = [];
            if (listRes.ok) {
                existingAirports = await listRes.json();
            }

            // Desduplicar manteniendo el registro más reciente (el que aparece primero)
            const uniqueLogsMap = new Map();
            sessionLogs.forEach(log => {
                if (!uniqueLogsMap.has(log.icaoCode)) {
                    uniqueLogsMap.set(log.icaoCode, log);
                }
            });
            const logsToProcess = Array.from(uniqueLogsMap.values());

            await Promise.all(logsToProcess.map(async (warehouse) => {
                try {
                    const existing = existingAirports.find(a => a.icaoCode === warehouse.icaoCode);
                    const gmtOffset = warehouse.gmtOffset !== undefined ? warehouse.gmtOffset : (existing ? existing.gmtOffset : 0);

                    const payload = {
                        icaoCode: warehouse.icaoCode,
                        city: warehouse.city,
                        country: warehouse.country,
                        continent: warehouse.continent,
                        latitude: parseFloat(warehouse.latitude),
                        longitude: parseFloat(warehouse.longitude),
                        storageCapacity: parseInt(warehouse.storageCapacity, 10) || 400,
                        gmtOffset: gmtOffset
                    };
                    
                    let res;
                    if (existing) {
                        res = await fetch(`/api/v1/aeropuertos/${existing.id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        });
                    } else {
                        res = await fetch('/api/v1/aeropuertos/create', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        });
                    }
                    if (res.ok) {
                        successCount++;
                        newlySaved.push(warehouse);
                    } else {
                        failCount++;
                    }
                } catch (err) {
                    failCount++;
                }
            }));
        } catch (err) {
            failCount++;
        }

        setLoading(false);

        if (failCount === 0) {
            setStatus({ type: 'success', message: `¡Los ${successCount} almacenes se registraron o actualizaron exitosamente!` });
            setRecentlySavedLogs(prev => [...newlySaved, ...prev]);
            setSessionLogs([]);
            setActiveTab('saved');
            refreshAirports();
        } else {
            setStatus({ type: 'error', message: `Hubo ${failCount} errores. Solo se registraron/actualizaron ${successCount} almacenes.` });
            if (newlySaved.length > 0) {
                setRecentlySavedLogs(prev => [...newlySaved, ...prev]);
                setSessionLogs(prev => prev.filter(p => !newlySaved.some(s => s.icaoCode === p.icaoCode)));
                setActiveTab('saved');
            }
            refreshAirports();
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

            <div style={{ display: 'flex', gap: '1.5rem', flex: 1, minHeight: 0 }}>
                {/* Lado Izquierdo: Formularios */}
                <div style={{ flex: 1, overflowY: 'auto', paddingRight: '0.5rem' }}>
                    {entryMode === 'manual' && (
                        <div style={{ background: 'rgba(15, 23, 42, 0.8)', border: '1px solid rgba(56,189,248,0.2)', padding: '1.5rem', borderRadius: '12px', marginBottom: '1.5rem' }}>
                            <h3 style={{ margin: '0 0 1rem 0', color: '#38bdf8', fontSize: '16px' }}>Ajuste de Almacenes (Aeropuertos)</h3>
                            <p style={{ margin: '0 0 1rem 0', fontSize: '13px', color: '#94a3b8' }}>Agrega o ajusta capacidades de los almacenes existentes de forma manual.</p>
                            
                            <form onSubmit={handleManualSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                <div>
                                    <label style={labelStyle}>CÓDIGO ICAO</label>
                                    <input type="text" name="icaoCode" value={formData.icaoCode} onChange={handleInputChange} required placeholder="Ej: SPJC" style={inputStyle} />
                                </div>
                                <div>
                                    <label style={labelStyle}>CAPACIDAD MÁXIMA (Maletas)</label>
                                    <input type="number" name="storageCapacity" value={formData.storageCapacity} onChange={handleInputChange} required min="100" placeholder="Ej: 430" style={inputStyle} />
                                </div>
                                <div>
                                    <label style={labelStyle}>CIUDAD</label>
                                    <input type="text" name="city" required placeholder="Ej: Lima" value={formData.city} onChange={handleInputChange} style={inputStyle} readOnly />
                                </div>
                                <div>
                                    <label style={labelStyle}>PAÍS</label>
                                    <input type="text" name="country" required placeholder="Ej: Peru" value={formData.country} onChange={handleInputChange} style={inputStyle} readOnly />
                                </div>
                                <div>
                                    <label style={labelStyle}>CONTINENTE</label>
                                    <select name="continent" value={formData.continent} onChange={handleInputChange} style={inputStyle} disabled>
                                        <option value="AMERICA">América</option>
                                        <option value="EUROPE">Europa</option>
                                        <option value="ASIA">Asia</option>
                                        <option value="AFRICA">África</option>
                                        <option value="OCEANIA">Oceanía</option>
                                    </select>
                                </div>
                                <div>
                                    <label style={labelStyle}>LATITUD</label>
                                    <input type="number" step="any" name="latitude" required placeholder="Ej: -12.01" value={formData.latitude} onChange={handleInputChange} style={inputStyle} readOnly />
                                </div>
                                <div>
                                    <label style={labelStyle}>LONGITUD</label>
                                    <input type="number" step="any" name="longitude" required placeholder="Ej: -77.06" value={formData.longitude} onChange={handleInputChange} style={inputStyle} readOnly />
                                </div>
                                <div>
                                    <label style={labelStyle}>GMT OFFSET</label>
                                    <input type="number" name="gmtOffset" required placeholder="Ej: -5" value={formData.gmtOffset} onChange={handleInputChange} style={inputStyle} readOnly />
                                </div>

                                <div style={{ gridColumn: 'span 2' }}>
                                    <button type="submit" disabled={loading} style={btnStylePrimary}>
                                        {loading ? 'Procesando...' : '+ Añadir / Actualizar Almacén'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    )}

                    {entryMode === 'txt' && (
                        <div style={{ background: 'rgba(15, 23, 42, 0.8)', border: '1px dashed rgba(148, 163, 184, 0.3)', padding: '1.5rem', borderRadius: '12px', marginBottom: '1.5rem' }}>
                            <h3 style={{ margin: '0 0 0.5rem 0', color: '#e2e8f0', fontSize: '14px' }}>Carga Masiva de Almacenes (.TXT)</h3>
                            <p style={{ margin: '0 0 1rem 0', fontSize: '11px', color: '#64748b' }}>Sube el archivo de configuración de capacidades de almacenes.</p>
                            
                            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.75rem', borderRadius: '6px', marginBottom: '1rem', fontSize: '11px', color: '#cbd5e1', fontFamily: 'monospace', overflowX: 'auto', whiteSpace: 'nowrap' }}>
                                <div style={{ color: '#38bdf8', marginBottom: '0.5rem', fontWeight: 'bold' }}>Formato esperado:</div>
                                <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;America del Sur.&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;CAPACIDAD</div>
                                <div>01&nbsp;&nbsp;&nbsp;SKBO&nbsp;&nbsp;&nbsp;Bogota&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Colombia&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;bogo&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;430&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Latitude:&nbsp;04°&nbsp;42'&nbsp;05"&nbsp;N&nbsp;&nbsp;&nbsp;Longitude:&nbsp;&nbsp;74°&nbsp;08'&nbsp;49"&nbsp;W</div>
                            </div>

                            <input type="file" accept=".txt" onChange={handleTxtUpload} style={{ width: '100%', color: '#94a3b8', fontSize: '12px' }} />
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
                                    <p style={{ color: '#64748b', fontSize: '12px', textAlign: 'center', marginTop: '2rem' }}>No hay almacenes pendientes de guardar.</p>
                                ) : (
                                    sessionLogs.map((log, idx) => (
                                        <div key={idx} style={{ position: 'relative', background: 'rgba(30, 41, 59, 0.8)', padding: '0.75rem', borderRadius: '8px', borderLeft: `3px solid #38bdf8`, fontSize: '12px' }}>
                                            <button 
                                                onClick={() => handleRemoveLog(idx)}
                                                style={{ position: 'absolute', top: '5px', right: '5px', background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '16px', lineHeight: 1, padding: '2px 5px' }}
                                                title="Quitar log"
                                            >
                                                ×
                                            </button>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', paddingRight: '15px' }}>
                                                <span style={{ fontWeight: 'bold', color: '#e2e8f0' }}>ICAO: {log.icaoCode}</span>
                                                <span style={{ color: '#94a3b8' }}>{log.city}, {log.country}</span>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginTop: '0.5rem' }}>
                                                <div style={{ color: '#34d399', fontWeight: 'bold' }}>Cap: {log.storageCapacity}</div>
                                            </div>
                                        </div>
                                    ))
                                )
                            ) : (
                                recentlySavedLogs.length === 0 ? (
                                    <p style={{ color: '#64748b', fontSize: '12px', textAlign: 'center', marginTop: '2rem' }}>No hay guardados recientes en esta sesión.</p>
                                ) : (
                                    recentlySavedLogs.map((log, idx) => (
                                        <div key={idx} style={{ position: 'relative', background: 'rgba(30, 41, 59, 0.8)', padding: '0.75rem', borderRadius: '8px', borderLeft: `3px solid #10b981`, fontSize: '12px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                                                <span style={{ fontWeight: 'bold', color: '#e2e8f0' }}>ICAO: {log.icaoCode}</span>
                                                <span style={{ color: '#94a3b8' }}>{log.city}, {log.country}</span>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginTop: '0.5rem' }}>
                                                <div style={{ color: '#34d399', fontWeight: 'bold' }}>Cap: {log.storageCapacity}</div>
                                                <div style={{ color: '#10b981' }}>✓ Guardado</div>
                                            </div>
                                        </div>
                                    ))
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
                        <h3 style={{ margin: 0, color: '#e2e8f0', fontSize: '16px' }}>Listado General de Almacenes</h3>
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
                            <button onClick={fetchWarehouses} style={btnStyleSecondary}>↻ Actualizar</button>
                        </div>
                    </div>

                    {showFilters && (
                        <div style={{ background: 'rgba(30, 41, 59, 0.6)', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem', border: '1px solid rgba(255,255,255,0.05)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '10px' }}>ICAO</label>
                                <input 
                                    type="text" 
                                    placeholder="Ej: SKBO" 
                                    value={advancedFilters.icao} 
                                    onChange={(e) => setAdvancedFilters(p => ({ ...p, icao: e.target.value }))}
                                    style={{ ...inputStyle, padding: '6px 10px', fontSize: '12px' }} 
                                />
                            </div>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '10px' }}>CIUDAD</label>
                                <input 
                                    type="text" 
                                    placeholder="Ej: Bogota" 
                                    value={advancedFilters.ciudad} 
                                    onChange={(e) => setAdvancedFilters(p => ({ ...p, ciudad: e.target.value }))}
                                    style={{ ...inputStyle, padding: '6px 10px', fontSize: '12px' }} 
                                />
                            </div>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '10px' }}>PAÍS</label>
                                <input 
                                    type="text" 
                                    placeholder="Ej: Colombia" 
                                    value={advancedFilters.pais} 
                                    onChange={(e) => setAdvancedFilters(p => ({ ...p, pais: e.target.value }))}
                                    style={{ ...inputStyle, padding: '6px 10px', fontSize: '12px' }} 
                                />
                            </div>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '10px' }}>CONTINENTE</label>
                                <select 
                                    value={advancedFilters.continente} 
                                    onChange={(e) => setAdvancedFilters(p => ({ ...p, continente: e.target.value }))}
                                    style={{ ...inputStyle, padding: '6px 10px', fontSize: '12px' }} 
                                >
                                    <option value="">Todos</option>
                                    <option value="AMERICA">América</option>
                                    <option value="EUROPE">Europa</option>
                                    <option value="ASIA">Asia</option>
                                    <option value="AFRICA">África</option>
                                    <option value="OCEANIA">Oceanía</option>
                                </select>
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
                                <label style={{ ...labelStyle, fontSize: '10px' }}>GMT OFFSET</label>
                                <input 
                                    type="number" 
                                    placeholder="Ej: -5" 
                                    value={advancedFilters.gmt} 
                                    onChange={(e) => setAdvancedFilters(p => ({ ...p, gmt: e.target.value }))}
                                    style={{ ...inputStyle, padding: '6px 10px', fontSize: '12px' }} 
                                />
                            </div>
                            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
                                <button 
                                    onClick={() => setAdvancedFilters({ icao: '', ciudad: '', pais: '', continente: '', minCapacity: '', maxCapacity: '', gmt: '' })} 
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
                                    <th style={{ padding: '12px' }}>ID</th>
                                    <th style={{ padding: '12px' }}>ICAO</th>
                                    <th style={{ padding: '12px' }}>Ciudad / País</th>
                                    <th style={{ padding: '12px' }}>Continente</th>
                                    <th style={{ padding: '12px' }}>Capacidad</th>
                                    <th style={{ padding: '12px' }}>GMT</th>
                                    <th style={{ padding: '12px' }}>Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading && currentWarehouses.length === 0 ? (
                                    <tr><td colSpan="7" style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>Cargando almacenes...</td></tr>
                                ) : currentWarehouses.length === 0 ? (
                                    <tr><td colSpan="7" style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>No hay almacenes que coincidan con la búsqueda.</td></tr>
                                ) : (
                                    currentWarehouses.map((w) => (
                                        <tr key={w.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                                            <td style={{ padding: '12px', color: '#94a3b8' }}>{w.id}</td>
                                            <td style={{ padding: '12px', color: '#38bdf8', fontWeight: 'bold' }}>{w.icaoCode}</td>
                                            <td style={{ padding: '12px' }}>{w.city}, {w.country}</td>
                                            <td style={{ padding: '12px' }}>{w.continent}</td>
                                            <td style={{ padding: '12px', color: '#34d399', fontWeight: 'bold' }}>{w.storageCapacity}</td>
                                            <td style={{ padding: '12px' }}>{w.gmtOffset}</td>
                                            <td style={{ padding: '12px' }}>
                                                <button 
                                                    onClick={() => handleDeleteWarehouse(w.id)}
                                                    disabled={loading}
                                                    style={{ ...btnStyleSecondary, color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.3)', background: 'rgba(239, 68, 68, 0.1)' }}
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
                                Mostrando {((currentPage - 1) * itemsPerPage) + 1} a {Math.min(currentPage * itemsPerPage, filteredWarehouses.length)} de {filteredWarehouses.length} almacenes
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
    background: type === 'success' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
    border: `1px solid ${type === 'success' ? '#10b981' : '#ef4444'}`,
    color: type === 'success' ? '#34d399' : '#f87171',
    marginTop: '1rem'
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

export default WarehouseManagement;
