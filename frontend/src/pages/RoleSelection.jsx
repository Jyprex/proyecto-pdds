import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAirports } from '../hooks/useAirports';

const RoleSelection = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { airports } = useAirports();
    
    const [showModal, setShowModal] = useState(false);
    const [registradorCode, setRegistradorCode] = useState('');
    const [error, setError] = useState('');

    const handleSelectRole = (role, path) => {
        if (role === 'REGISTRADOR') {
            setShowModal(true);
        } else {
            sessionStorage.setItem('userRole', role);
            // Preservamos el ?session= usando location.search que es confiable en React Router
            const existingSession = new URLSearchParams(location.search).get('session');
            const destination = existingSession ? `${path}?session=${existingSession}` : path;
            navigate(destination);
        }
    };

    const handleLoginRegistrador = (e) => {
        e.preventDefault();
        
        // Simulación de códigos de usuario: 
        // Aceptaremos OP-{ICAO} o validaremos si es un código de aeropuerto válido
        let foundAirport = null;
        const code = registradorCode.trim().toUpperCase();
        
        // Hardcoded example profiles
        const predefinedProfiles = {
            'LIM-001': 'SPIM',
            'AMS-001': 'EHAM',
            'BOG-001': 'SKBO'
        };

        if (predefinedProfiles[code]) {
            foundAirport = predefinedProfiles[code];
        } else if (code.startsWith('OP-') && code.length === 7) {
            const icao = code.substring(3);
            if (airports.find(a => a.icao === icao)) {
                foundAirport = icao;
            }
        } else {
            // Fallback: If they just type the ICAO code for testing
            if (airports.find(a => a.icao === code)) {
                foundAirport = code;
            }
        }

        if (foundAirport) {
            sessionStorage.setItem('userRole', 'REGISTRADOR');
            // Guardamos el perfil en localStorage para que toda la app sepa de dónde viene
            localStorage.setItem('profileAirport', foundAirport);
            localStorage.setItem('profileCode', code);
            navigate('/registro-datos');
        } else {
            setError('Código de registrador inválido o aeropuerto no encontrado. Ej: LIM-001 o OP-SPIM');
        }
    };

    return (
        <div style={styles.container}>
            <div style={styles.overlay}></div>
            <div style={styles.content}>
                <h1 style={styles.title}>Tasf.B2B</h1>
                <p style={styles.subtitle}>Seleccione su portal de acceso operativo</p>
                
                <div style={styles.cardsContainer}>
                    {/* Tarjeta Empleado Registrador */}
                    <div 
                        style={styles.card}
                        onClick={() => handleSelectRole('REGISTRADOR', '/registro-datos')}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'translateY(-10px)';
                            e.currentTarget.style.boxShadow = '0 20px 40px rgba(56, 189, 248, 0.2)';
                            e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.5)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5)';
                            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)';
                        }}
                    >
                        <div style={styles.iconContainer}>
                            <svg style={styles.icon} viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                <polyline points="14 2 14 8 20 8"></polyline>
                                <line x1="16" y1="13" x2="8" y2="13"></line>
                                <line x1="16" y1="17" x2="8" y2="17"></line>
                                <polyline points="10 9 9 9 8 9"></polyline>
                            </svg>
                        </div>
                        <div style={styles.textContainer}>
                            <h2 style={styles.cardTitle}>Empleado Registrador</h2>
                            <p style={styles.cardDesc}>Ingreso de datos adicionales, excepciones operativas y gestión de almacenes.</p>
                        </div>
                    </div>

                    {/* Tarjeta Encargado Logística */}
                    <div 
                        style={styles.card}
                        onClick={() => handleSelectRole('LOGISTICA', '/map')}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'translateY(-10px)';
                            e.currentTarget.style.boxShadow = '0 20px 40px rgba(219, 39, 119, 0.2)';
                            e.currentTarget.style.borderColor = 'rgba(219, 39, 119, 0.5)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5)';
                            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)';
                        }}
                    >
                        <div style={styles.iconContainer}>
                            <svg style={styles.icon} viewBox="0 0 24 24" fill="none" stroke="#db2777" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"></polygon>
                                <line x1="9" y1="3" x2="9" y2="21"></line>
                                <line x1="15" y1="3" x2="15" y2="21"></line>
                            </svg>
                        </div>
                        <div style={styles.textContainer}>
                            <h2 style={styles.cardTitle}>Encargado de Logística</h2>
                            <p style={styles.cardDesc}>Monitoreo en tiempo real, simulación y evaluación de escenarios operativos.</p>
                        </div>
                    </div>
                </div>

                {/* Modal de Login de Registrador */}
                {showModal && (
                    <div style={styles.modalOverlay}>
                        <div style={styles.modalContent}>
                            <h3 style={{ margin: '0 0 1rem 0', color: '#e2e8f0', fontSize: '1.2rem' }}>Acceso Registrador</h3>
                            <p style={{ fontSize: '0.9rem', color: '#94a3b8', marginBottom: '1.5rem' }}>
                                Ingrese su código de operador para identificar su aeropuerto de origen automáticamente.
                            </p>
                            <form onSubmit={handleLoginRegistrador} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                <input 
                                    type="text" 
                                    placeholder="Ej: LIM-001 o OP-SPIM" 
                                    value={registradorCode}
                                    onChange={(e) => { setRegistradorCode(e.target.value); setError(''); }}
                                    style={styles.input}
                                    autoFocus
                                />
                                {error && <div style={{ color: '#ef4444', fontSize: '0.8rem' }}>{error}</div>}
                                <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                                    <button type="button" onClick={() => setShowModal(false)} style={styles.btnCancel}>Cancelar</button>
                                    <button type="submit" style={styles.btnPrimary}>Ingresar</button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

const styles = {
    container: {
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0F172A',
        backgroundImage: 'radial-gradient(circle at top right, #1e293b, #0f172a)',
        fontFamily: "'Inter', 'Roboto', sans-serif",
        position: 'relative',
        overflow: 'hidden'
    },
    overlay: {
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        background: 'radial-gradient(circle at center, rgba(56, 189, 248, 0.05) 0%, transparent 70%)',
        pointerEvents: 'none'
    },
    content: {
        position: 'relative',
        zIndex: 10,
        textAlign: 'center',
        maxWidth: '1000px',
        width: '100%',
        padding: '2rem'
    },
    title: {
        fontSize: '3.5rem',
        fontWeight: '800',
        color: '#f8fafc',
        marginBottom: '0.5rem',
        letterSpacing: '-1px'
    },
    subtitle: {
        fontSize: '1.2rem',
        color: '#94a3b8',
        marginBottom: '4rem'
    },
    cardsContainer: {
        display: 'flex',
        flexDirection: 'row',
        gap: '2.5rem',
        justifyContent: 'center',
        alignItems: 'stretch',
        flexWrap: 'nowrap',
        width: '100%',
        padding: '0 1rem'
    },
    card: {
        background: 'rgba(30, 41, 59, 0.5)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255, 255, 255, 0.05)',
        borderRadius: '24px',
        padding: '3rem 2.5rem',
        width: '100%',
        maxWidth: '400px',
        cursor: 'pointer',
        transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
        boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center'
    },
    iconContainer: {
        width: '80px',
        height: '80px',
        borderRadius: '20px',
        background: 'rgba(15, 23, 42, 0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: '1.5rem',
        flexShrink: 0,
        boxShadow: 'inset 0 2px 10px rgba(255,255,255,0.05)'
    },
    icon: {
        width: '40px',
        height: '40px'
    },
    textContainer: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center'
    },
    cardTitle: {
        fontSize: '1.5rem',
        fontWeight: '700',
        color: '#e2e8f0',
        marginBottom: '1rem',
        marginTop: 0
    },
    cardDesc: {
        fontSize: '1rem',
        color: '#94a3b8',
        margin: 0,
        lineHeight: '1.6'
    },
    modalOverlay: {
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.8)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50
    },
    modalContent: {
        background: 'rgba(30, 41, 59, 0.95)',
        border: '1px solid rgba(56, 189, 248, 0.3)',
        borderRadius: '16px',
        padding: '2rem',
        width: '100%',
        maxWidth: '400px',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
        textAlign: 'left'
    },
    input: {
        width: '100%',
        padding: '0.75rem',
        borderRadius: '8px',
        background: 'rgba(15, 23, 42, 0.9)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        color: '#fff',
        fontSize: '1rem',
        outline: 'none',
        boxSizing: 'border-box'
    },
    btnPrimary: {
        flex: 1,
        padding: '0.75rem',
        background: '#38bdf8',
        color: '#0f172a',
        border: 'none',
        borderRadius: '8px',
        fontWeight: 'bold',
        cursor: 'pointer',
        fontSize: '1rem',
        transition: 'background 0.2s'
    },
    btnCancel: {
        flex: 1,
        padding: '0.75rem',
        background: 'transparent',
        color: '#94a3b8',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '8px',
        fontWeight: 'bold',
        cursor: 'pointer',
        fontSize: '1rem',
        transition: 'background 0.2s'
    }
};

export default RoleSelection;
