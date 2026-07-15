import React, { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../../hooks/api';

const UpcomingFlightsPanel = ({ currentEpochTime = 0 }) => {
    const [flights, setFlights] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState('time'); // 'time' o 'capacity'

    const fetchUpcomingFlights = async () => {
        try {
            setLoading(true);
            const res = await apiFetch('/api/v1/vuelos/search');
            if (!res.ok) throw new Error('Error al obtener vuelos');
            
            const data = await res.json();
            
            // currentEpochTime viene en milisegundos absolutos (Epoch) desde el backend.
            // Para obtener el minuto actual del día en UTC:
            const date = new Date(currentEpochTime);
            const currentMinuteOfDay = date.getUTCHours() * 60 + date.getUTCMinutes();
            
            // Filtramos vuelos que NO han sido cancelados y que salen en el futuro.
            // Para lidiar con el final del día, mostramos los que salen entre currentMinuteOfDay y currentMinuteOfDay + 300 (5 horas aprox)
            // o simplemente los más próximos en general.
            let processed = data
                .filter(v => !v.cancelled || v.reagendado)
                .map(v => {
                    const isRescheduled = v.reagendado;
                    
                    let diff = v.departureMinute - currentMinuteOfDay;
                    const crossedBoundary = diff < 0;
                    if (crossedBoundary) diff += 1440;
                    
                    // Si el vuelo fue reagendado, le sumamos 1440 SOLO si no ha cruzado su hora natural hoy.
                    // Si ya cruzó su hora natural hoy, diff ya contiene las 24h hacia mañana.
                    const extraDay = (isRescheduled && !crossedBoundary) ? 1440 : 0;
                    
                    return {
                        ...v,
                        originalDiff: diff,
                        isRescheduled,
                        actualWaitMin: diff + extraDay
                    };
                });

            setFlights(processed);
            setError(null);
        } catch (err) {
            console.error(err);
            setError('No se pudo cargar la lista de vuelos');
        } finally {
            setLoading(false);
        }
    };

    const currentUtcDay = currentEpochTime > 0 ? Math.floor(currentEpochTime / 86400000) : 0;
    const fetchRef = useRef(fetchUpcomingFlights)
    fetchRef.current = fetchUpcomingFlights

    useEffect(() => {
        fetchRef.current();
        // Recargar cada minuto
        const interval = setInterval(() => fetchRef.current(), 60000);
        return () => clearInterval(interval);
    }, [currentUtcDay]);

    // Formatear minutos (0-1439) a HH:MM
    const formatTime = (minutes) => {
        const h = Math.floor(minutes / 60).toString().padStart(2, '0');
        const m = Math.floor(minutes % 60).toString().padStart(2, '0');
        return `${h}:${m}`;
    };

    return (
        <div style={containerStyle}>
            <div style={headerStyle}>
                <h3 style={titleStyle}>PRÓXIMAS SALIDAS PROGRAMADAS</h3>
                <button onClick={fetchUpcomingFlights} style={refreshBtnStyle} title="Actualizar">
                    ↻
                </button>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                <input 
                    type="text" 
                    placeholder="Buscar por ICAO o ID..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={searchInputStyle}
                />
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={selectStyle}>
                    <option value="time">Próxima Salida</option>
                    <option value="capacity">Mayor Capacidad</option>
                </select>
            </div>

            <div style={timeInfoStyle}>
                Hora Actual (UTC Simulador): <strong>{formatTime(new Date(currentEpochTime).getUTCHours() * 60 + new Date(currentEpochTime).getUTCMinutes())}</strong>
            </div>

            {loading && <div style={messageStyle}>Cargando próximos vuelos...</div>}
            {error && <div style={{...messageStyle, color: '#f87171'}}>{error}</div>}

            {!loading && !error && flights.length === 0 && (
                <div style={messageStyle}>No hay vuelos programados.</div>
            )}

            {!loading && !error && flights.length > 0 && (
                <div style={listContainerStyle}>
                    {flights
                        .filter(f => {
                            if (!searchQuery) return true;
                            const q = searchQuery.toLowerCase();
                            return f.id?.toString().includes(q) || 
                                   f.origenIcao.toLowerCase().includes(q) || 
                                   f.destinoIcao.toLowerCase().includes(q);
                        })
                        .sort((a, b) => {
                            if (sortBy === 'time') return a.actualWaitMin - b.actualWaitMin;
                            if (sortBy === 'capacity') return b.capacity - a.capacity;
                            return 0;
                        })
                        .slice(0, 50)
                        .map((flight) => {
                        const simDate = new Date(currentEpochTime);
                        const simMinuteOfDay = simDate.getUTCHours() * 60 + simDate.getUTCMinutes();
                        let diffMin = flight.departureMinute - simMinuteOfDay;
                        if (diffMin < 0) diffMin += 1440;

                        return (
                            <div key={flight.id} style={flightCardStyle}>
                                <div style={{display: 'flex', alignItems: 'center', gap: '0.75rem'}}>
                                    <div style={flightRouteStyle}>
                                        <span style={{color: '#64748b', fontSize: '10px', marginRight: '4px', fontWeight: 'bold'}}>#{flight.id}</span>
                                        <span style={airportBadgeStyle}>{flight.origenIcao}</span>
                                        <span style={{color: '#94a3b8', fontSize: '10px'}}>✈️</span>
                                        <span style={airportBadgeStyle}>{flight.destinoIcao}</span>
                                    </div>
                                    <div style={{display: 'flex', gap: '0.5rem', alignItems: 'center'}}>
                                        <span style={valueStyle}>{formatTime(flight.departureMinute)}</span>
                                        <span style={{color: '#64748b', fontSize: '10px'}}>➝</span>
                                        <span style={valueStyle}>{formatTime(flight.arrivalMinute)}</span>
                                        <span style={labelStyle}>UTC</span>
                                    </div>
                                </div>
                                <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                                    {flight.isRescheduled && (
                                        <span style={rescheduledBadgeStyle}>REAGENDADO</span>
                                    )}
                                    <div style={flight.isRescheduled ? countdownRescheduledStyle : countdownStyle}>
                                        En {Math.floor(flight.actualWaitMin / 60)}h {Math.floor(flight.actualWaitMin % 60)}m
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

const containerStyle = {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    color: '#e2e8f0',
    backgroundColor: '#0f172a',
    padding: '1rem',
    boxSizing: 'border-box'
};

const headerStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.5rem',
    borderBottom: '1px solid rgba(56, 189, 248, 0.2)',
    paddingBottom: '0.5rem'
};

const titleStyle = {
    margin: 0,
    fontSize: '13px',
    color: '#38bdf8',
    letterSpacing: '1px'
};

const refreshBtnStyle = {
    background: 'rgba(56, 189, 248, 0.1)',
    border: '1px solid rgba(56, 189, 248, 0.3)',
    color: '#38bdf8',
    borderRadius: '4px',
    cursor: 'pointer',
    padding: '2px 8px',
    fontSize: '14px'
};

const searchInputStyle = {
    flex: 1,
    background: 'rgba(15, 23, 42, 0.8)',
    border: '1px solid rgba(148, 163, 184, 0.3)',
    borderRadius: '6px',
    padding: '6px 10px',
    color: '#e2e8f0',
    fontSize: '12px',
    outline: 'none'
};

const selectStyle = {
    background: 'rgba(15, 23, 42, 0.8)',
    border: '1px solid rgba(148, 163, 184, 0.3)',
    borderRadius: '6px',
    padding: '6px 10px',
    color: '#e2e8f0',
    fontSize: '12px',
    outline: 'none',
    cursor: 'pointer'
};

const timeInfoStyle = {
    fontSize: '12px',
    color: '#94a3b8',
    marginBottom: '1rem',
    textAlign: 'right'
};

const messageStyle = {
    textAlign: 'center',
    padding: '2rem',
    color: '#94a3b8',
    fontSize: '13px'
};

const listContainerStyle = {
    flex: 1,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    paddingRight: '0.5rem'
};

const flightCardStyle = {
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    border: '1px solid rgba(148, 163, 184, 0.1)',
    borderRadius: '6px',
    padding: '0.4rem 0.5rem',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '0.5rem'
};

const flightRouteStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.25rem'
};

const airportBadgeStyle = {
    backgroundColor: 'transparent',
    fontSize: '12px',
    fontWeight: 'bold',
    color: '#e2e8f0'
};

const labelStyle = {
    fontSize: '9px',
    color: '#64748b',
    fontWeight: 'bold'
};

const valueStyle = {
    fontSize: '12px',
    color: '#f8fafc',
    fontFamily: 'monospace'
};

const countdownStyle = {
    fontSize: '11px',
    fontWeight: 'bold',
    color: '#34d399',
    backgroundColor: 'rgba(52, 211, 153, 0.1)',
    padding: '3px 8px',
    borderRadius: '12px'
};

const countdownRescheduledStyle = {
    fontSize: '11px',
    fontWeight: 'bold',
    color: '#fbbf24',
    backgroundColor: 'rgba(251, 191, 36, 0.1)',
    padding: '3px 8px',
    borderRadius: '12px'
};

const rescheduledBadgeStyle = {
    fontSize: '9px',
    fontWeight: 'bold',
    color: '#f87171',
    backgroundColor: 'rgba(248, 113, 113, 0.1)',
    border: '1px solid rgba(248, 113, 113, 0.3)',
    padding: '2px 6px',
    borderRadius: '4px',
    letterSpacing: '0.5px'
};

export default UpcomingFlightsPanel;
