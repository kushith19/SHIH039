import { io } from 'socket.io-client'

let socket = null

export function getGameSocket() {
  if (!socket) {
    const url = import.meta.env.VITE_WS_URL
    socket = io(url || undefined, {
      path: '/socket.io',
      autoConnect: true,
      // Poll first, then upgrade. Websocket-first fails through the Vite
      // proxy (and shows "websocket error") when the API is down or WS
      // upgrade is blocked.
      transports: ['polling', 'websocket'],
      upgrade: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 800,
    })
  }
  return socket
}

export function disconnectGameSocket() {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}
