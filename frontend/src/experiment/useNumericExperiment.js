import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../hooks/api';

const API_BASE = '/api/v1/numeric-experiment';

export function useNumericExperiment() {
    const [doeData, setDoeData] = useState(null);      // { levels: [...] }
    const [sessionId, setSessionId] = useState(null);
    const [sessionData, setSessionData] = useState(null); // estado completo de la sesión
    const [status, setStatus] = useState('IDLE');          // IDLE | RUNNING | DONE | FAILED
    const [error, setError] = useState(null);
    const timerRef = useRef(null);

    // ── Calcular niveles DOE desde archivos planos ────────────────────────
    const loadDOE = async () => {
        setError(null);
        try {
            const res = await apiFetch(`${API_BASE}/doe`);
            if (!res.ok) throw new Error(`Error ${res.status} al calcular niveles DOE`);
            const data = await res.json();
            setDoeData(data);
        } catch (err) {
            console.error('[DOE] Error:', err);
            setError('No se pudieron calcular los niveles DOE. ¿Está el backend activo?');
        }
    };

    // ── Iniciar experimento para el algoritmo seleccionado ────────────────
    const startExperiment = async (algorithm) => {
        setError(null);
        setStatus('RUNNING');
        setSessionData(null);

        try {
            const res = await apiFetch(`${API_BASE}/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ algorithm })
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || `Error ${res.status}`);
            }
            const data = await res.json();
            setSessionId(data.sessionId);
            startPolling(data.sessionId);
        } catch (err) {
            setStatus('FAILED');
            setError(err.message);
        }
    };

    // ── Polling de estado cada 1.5 segundos ───────────────────────────────
    const startPolling = (id) => {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = setInterval(async () => {
            try {
                const res = await apiFetch(`${API_BASE}/status/${id}`);
                if (!res.ok) return;
                const data = await res.json();
                setSessionData(data);
                setStatus(data.status);

                if (data.status === 'DONE' || data.status === 'FAILED') {
                    clearInterval(timerRef.current);
                    timerRef.current = null;
                }
            } catch (err) {
                console.error('[Polling] Error:', err);
            }
        }, 1500);
    };

    // ── Resetear para nueva ejecución ─────────────────────────────────────
    const reset = () => {
        if (timerRef.current) clearInterval(timerRef.current);
        setSessionId(null);
        setSessionData(null);
        setStatus('IDLE');
        setError(null);
    };

    // Limpieza al desmontar
    useEffect(() => {
        return () => { if (timerRef.current) clearInterval(timerRef.current); };
    }, []);

    return {
        // Estado DOE
        doeData,
        doeLoaded: !!doeData,

        // Estado sesión
        sessionId,
        sessionData,
        status,
        isRunning: status === 'RUNNING',
        isDone: status === 'DONE',
        isFailed: status === 'FAILED',

        // Acciones
        loadDOE,
        startExperiment,
        reset,
        error,
    };
}
