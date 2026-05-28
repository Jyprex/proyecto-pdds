import { Client } from '@stomp/stompjs'
import SockJS from 'sockjs-client'
import { apiUrl } from './api'

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
