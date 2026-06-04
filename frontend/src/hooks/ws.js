import { Client } from '@stomp/stompjs'
import SockJS from 'sockjs-client'
import { apiUrl } from './api'

/**
 * Crea un cliente STOMP configurado con SockJS para compatibilidad con proxies.
 * Usa apiUrl() para resolver la URL del endpoint WebSocket según el entorno.
 */
export const createStompClient = () => {
  const wsUrl = apiUrl('/ws')

  const client = new Client({
    // Usamos SockJS para funcionar bien en dev y con proxies.
    webSocketFactory: () => new SockJS(wsUrl),
    reconnectDelay: 1500,
    heartbeatIncoming: 0,
    heartbeatOutgoing: 20000,
  })

  return client
}
