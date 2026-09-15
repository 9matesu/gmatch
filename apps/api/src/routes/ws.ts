// WebSocketPair is a Cloudflare Workers runtime global
declare class WebSocketPair {
  [key: number]: WebSocket
  0: WebSocket
  1: WebSocket
}

interface WorkerWebSocket extends WebSocket {
  accept(): void
}

import { handleIncoming, conns, watchDisconnect, WsConn } from '../ws-bus'

// Hard cap on concurrent sockets so anonymous squatting can't exhaust memory.
const MAX_WS_CONNS = 500
// Anonymous connections are closed after this window unless they authenticate.
const WS_AUTH_GRACE_MS = 15_000

export async function handleWebSocketUpgrade(request: Request): Promise<Response | null> {
  const upgradeHeader = request.headers.get('Upgrade')
  if (upgradeHeader !== 'websocket') return null
  if (conns.size >= MAX_WS_CONNS) return new Response(null, { status: 503 })

  const pair = new WebSocketPair()
  const [client, server] = Object.values(pair) as [WebSocket, WorkerWebSocket]

  server.accept()

  const conn: WsConn = {
    send: (data) => {
      if (server.readyState === 1) {
        server.send(data)
        return true
      }
      return false
    },
    rooms: new Set(),
    authed: false,
  }
  conns.add(conn)

  // Anonymous connections get a short grace window to present a one-time auth
  // ticket, then they are closed. Prevents unauthenticated sockets from
  // squatting resources or acting as reflection amplifiers.
  const authTimer = setTimeout(() => {
    if (!conn.authed) {
      conns.delete(conn)
      try { server.close() } catch {}
    }
  }, WS_AUTH_GRACE_MS)

  server.addEventListener('message', (event) => {
    handleIncoming(conn, event.data as string)
  })

  server.addEventListener('close', () => {
    clearTimeout(authTimer)
    conns.delete(conn)
    watchDisconnect(conn)
  })

  server.addEventListener('error', () => {
    clearTimeout(authTimer)
    conns.delete(conn)
    watchDisconnect(conn)
  })

  return new Response(null, { status: 101, webSocket: client } as ResponseInit & { webSocket: WebSocket })
}
