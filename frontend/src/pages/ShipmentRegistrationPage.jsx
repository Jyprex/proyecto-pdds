import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AIRPORTS } from '../data/airportsData';
import { apiFetch } from '../hooks/api';

const ShipmentRegistrationPage = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('manual');
  
  // Manual form state
  const [formData, setFormData] = useState({
    fecha: '',
    hora: '',
    origenIcao: '',
    destinoIcao: '',
    cantidadMaletas: 1,
    clienteId: ''
  });

  const [file, setFile] = useState(null);
  const [status, setStatus] = useState({ type: '', message: '' });
  const [loading, setLoading] = useState(false);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleManualSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setStatus({ type: '', message: '' });

    try {
      const res = await apiFetch('/api/v1/envios/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (res.ok) {
        setStatus({ type: 'success', message: 'Envío registrado exitosamente.' });
        setFormData({
          fecha: '',
          hora: '',
          origenIcao: '',
          destinoIcao: '',
          cantidadMaletas: 1,
          clienteId: ''
        });
      } else {
        setStatus({ type: 'error', message: 'Error al registrar el envío.' });
      }
    } catch (err) {
      setStatus({ type: 'error', message: 'Error de conexión con el servidor.' });
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleFileSubmit = async (e) => {
    e.preventDefault();
    if (!file) return;

    setLoading(true);
    setStatus({ type: '', message: '' });

    const formDataFile = new FormData();
    formDataFile.append('file', file);

    try {
      // Usamos fetch directamente porque apiFetch podría no manejar FormData automáticamente si añade headers de JSON
      // Pero apiFetch en este proyecto es solo un wrapper de fetch(apiUrl(path), options)
      const res = await apiFetch('/api/v1/envios/archivo', {
        method: 'POST',
        body: formDataFile
      });

      if (res.ok) {
        setStatus({ type: 'success', message: 'Archivo procesado exitosamente.' });
        setFile(null);
      } else {
        setStatus({ type: 'error', message: 'Error al procesar el archivo.' });
      }
    } catch (err) {
      setStatus({ type: 'error', message: 'Error de conexión con el servidor.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="registration-page" style={{ padding: '2rem', color: 'white', background: '#0f172a', minHeight: '100vh', fontFamily: 'sans-serif' }}>
      <button 
        onClick={() => navigate('/')} 
        style={{ 
          marginBottom: '2rem', 
          background: 'rgba(59, 130, 246, 0.2)', 
          color: '#60a5fa', 
          border: '1px solid #3b82f6', 
          padding: '0.6rem 1.2rem', 
          borderRadius: '8px', 
          cursor: 'pointer',
          fontWeight: 'bold',
          transition: 'all 0.2s'
        }}
        onMouseOver={(e) => e.target.style.background = 'rgba(59, 130, 246, 0.3)'}
        onMouseOut={(e) => e.target.style.background = 'rgba(59, 130, 246, 0.2)'}
      >
        ← Volver al Centro de Control
      </button>

      <div style={{ maxWidth: '800px', margin: '0 auto' }}>
        <h1 style={{ marginBottom: '0.5rem', color: '#f8fafc' }}>Registrar Nuevo Envío</h1>
        <p style={{ marginBottom: '2rem', color: '#94a3b8' }}>Ingrese los datos del envío para su procesamiento en la red logística.</p>

        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2.5rem', background: 'rgba(30, 41, 59, 0.5)', padding: '0.4rem', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.05)' }}>
          <button 
            onClick={() => setActiveTab('manual')}
            style={{ 
              flex: 1,
              background: activeTab === 'manual' ? '#3b82f6' : 'transparent',
              color: activeTab === 'manual' ? 'white' : '#94a3b8', 
              border: 'none', 
              padding: '0.8rem', 
              borderRadius: '6px', 
              cursor: 'pointer',
              fontWeight: 'bold',
              transition: 'all 0.3s'
            }}
          >
            📋 Registro Individual
          </button>
          <button 
            onClick={() => setActiveTab('file')}
            style={{ 
              flex: 1,
              background: activeTab === 'file' ? '#3b82f6' : 'transparent',
              color: activeTab === 'file' ? 'white' : '#94a3b8', 
              border: 'none', 
              padding: '0.8rem', 
              borderRadius: '6px', 
              cursor: 'pointer',
              fontWeight: 'bold',
              transition: 'all 0.3s'
            }}
          >
            📁 Carga Masiva (CSV)
          </button>
        </div>

        {status.message && (
          <div style={{ 
            padding: '1.2rem', 
            marginBottom: '2rem', 
            borderRadius: '10px', 
            background: status.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            border: `1px solid ${status.type === 'success' ? '#10b981' : '#ef4444'}`,
            color: status.type === 'success' ? '#34d399' : '#f87171',
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}>
            <span style={{ fontSize: '1.2rem' }}>{status.type === 'success' ? '✅' : '❌'}</span>
            {status.message}
          </div>
        )}

        <div style={{ background: 'rgba(30, 41, 59, 0.3)', padding: '2.5rem', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>
          {activeTab === 'manual' ? (
            <form onSubmit={handleManualSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
              <div style={{ gridColumn: 'span 1' }}>
                <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.9rem', color: '#cbd5e1' }}>Fecha de Envío</label>
                <input type="date" name="fecha" value={formData.fecha} onChange={handleInputChange} required style={{ width: '100%', padding: '0.8rem', borderRadius: '8px', background: '#0f172a', border: '1px solid #334155', color: 'white', boxSizing: 'border-box' }} />
              </div>
              <div style={{ gridColumn: 'span 1' }}>
                <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.9rem', color: '#cbd5e1' }}>Hora de Envío</label>
                <input type="time" name="hora" value={formData.hora} onChange={handleInputChange} required style={{ width: '100%', padding: '0.8rem', borderRadius: '8px', background: '#0f172a', border: '1px solid #334155', color: 'white', boxSizing: 'border-box' }} />
              </div>
              <div style={{ gridColumn: 'span 1' }}>
                <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.9rem', color: '#cbd5e1' }}>Aeropuerto de Origen</label>
                <select name="origenIcao" value={formData.origenIcao} onChange={handleInputChange} required style={{ width: '100%', padding: '0.8rem', borderRadius: '8px', background: '#0f172a', border: '1px solid #334155', color: 'white', boxSizing: 'border-box' }}>
                  <option value="">Seleccione origen...</option>
                  {AIRPORTS.sort((a,b) => a.city.localeCompare(b.city)).map(a => <option key={a.icao} value={a.icao}>{a.city} ({a.icao})</option>)}
                </select>
              </div>
              <div style={{ gridColumn: 'span 1' }}>
                <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.9rem', color: '#cbd5e1' }}>Aeropuerto de Destino</label>
                <select name="destinoIcao" value={formData.destinoIcao} onChange={handleInputChange} required style={{ width: '100%', padding: '0.8rem', borderRadius: '8px', background: '#0f172a', border: '1px solid #334155', color: 'white', boxSizing: 'border-box' }}>
                  <option value="">Seleccione destino...</option>
                  {AIRPORTS.sort((a,b) => a.city.localeCompare(b.city)).map(a => <option key={a.icao} value={a.icao}>{a.city} ({a.icao})</option>)}
                </select>
              </div>
              <div style={{ gridColumn: 'span 1' }}>
                <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.9rem', color: '#cbd5e1' }}>Cantidad de Maletas</label>
                <input type="number" name="cantidadMaletas" value={formData.cantidadMaletas} onChange={handleInputChange} min="1" required style={{ width: '100%', padding: '0.8rem', borderRadius: '8px', background: '#0f172a', border: '1px solid #334155', color: 'white', boxSizing: 'border-box' }} />
              </div>
              <div style={{ gridColumn: 'span 1' }}>
                <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.9rem', color: '#cbd5e1' }}>Código de Cliente (7 dígitos)</label>
                <input type="text" name="clienteId" value={formData.clienteId} onChange={handleInputChange} maxLength="7" pattern="\d{7}" required placeholder="Ej: 0000001" style={{ width: '100%', padding: '0.8rem', borderRadius: '8px', background: '#0f172a', border: '1px solid #334155', color: 'white', boxSizing: 'border-box' }} />
              </div>
              <div style={{ gridColumn: 'span 2', marginTop: '1rem' }}>
                <button type="submit" disabled={loading} style={{ width: '100%', padding: '1rem', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: 'bold', fontSize: '1rem', boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)', transition: 'transform 0.2s' }} onMouseDown={(e) => e.target.style.transform = 'scale(0.98)'} onMouseUp={(e) => e.target.style.transform = 'scale(1)'}>
                  {loading ? '⏳ Procesando Registro...' : '🚀 Confirmar y Registrar Envío'}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleFileSubmit} style={{ textAlign: 'center' }}>
              <div 
                style={{ 
                  padding: '3rem 2rem', 
                  border: '2px dashed #334155', 
                  borderRadius: '16px', 
                  background: 'rgba(15, 23, 42, 0.4)',
                  cursor: 'pointer',
                  transition: 'border-color 0.3s'
                }}
                onMouseOver={(e) => e.currentTarget.style.borderColor = '#3b82f6'}
                onMouseOut={(e) => e.currentTarget.style.borderColor = '#334155'}
              >
                <span style={{ fontSize: '3rem', display: 'block', marginBottom: '1rem' }}>📄</span>
                <input type="file" accept=".csv" onChange={handleFileChange} style={{ marginBottom: '1.5rem', color: '#94a3b8' }} />
                <p style={{ fontSize: '0.95rem', color: '#94a3b8', lineHeight: '1.6' }}>
                  Seleccione un archivo <strong>CSV</strong> con el siguiente formato de columnas:<br />
                  <code style={{ background: '#0f172a', padding: '0.4rem 0.8rem', borderRadius: '6px', fontSize: '0.85rem', marginTop: '10px', display: 'inline-block', border: '1px solid rgba(255,255,255,0.05)' }}>
                    fecha(YYYY-MM-DD), hora(HH:MM), origen(ICAO), destino(ICAO), cantidad, clienteID
                  </code>
                </p>
              </div>
              <button type="submit" disabled={!file || loading} style={{ marginTop: '2rem', width: '100%', padding: '1rem', background: file ? '#10b981' : '#334155', color: 'white', border: 'none', borderRadius: '10px', cursor: file ? 'pointer' : 'not-allowed', fontWeight: 'bold', fontSize: '1rem', boxShadow: file ? '0 4px 12px rgba(16, 185, 129, 0.3)' : 'none' }}>
                {loading ? '⏳ Subiendo y Procesando...' : '📤 Subir Archivo CSV'}
              </button>
            </form>
          )}
        </div>

        <div style={{ marginTop: '3rem', padding: '1.5rem', background: 'rgba(245, 158, 11, 0.05)', borderRadius: '12px', border: '1px solid rgba(245, 158, 11, 0.2)', color: '#f59e0b' }}>
          <h4 style={{ margin: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: '8px' }}>💡 Nota sobre el Código de Seguimiento</h4>
          <p style={{ margin: 0, fontSize: '0.85rem', opacity: 0.8 }}>Para mantener la concordancia con el sistema, cada registro manual o por lote generará automáticamente un <strong>código de envío aleatorio de 9 dígitos</strong>.</p>
        </div>
      </div>
    </div>
  );
};

export default ShipmentRegistrationPage;
