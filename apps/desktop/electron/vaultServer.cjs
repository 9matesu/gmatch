// Localhost HTTP surface for the on-disk vault. The in-app renderer uses
// vault://, but a browser tab (or any tool outside Electron) cannot speak a
// custom scheme — it needs a real http origin. This reuses vault.serveVault
// wholesale rather than re-implementing Range, MIME lookup and traversal
// checks a second time.
//
// Bind is 127.0.0.1 only and the port is OS-assigned: the vault holds adult
// media and must not be reachable from the LAN. Keys are sha256 hashes, so a
// path is not guessable — but any local process that learns the key can read
// the file.
// ponytail: no auth on the local origin; add a token in the URL if a hostile
// local process becomes part of the threat model.
const http = require('http')
const vault = require('./vault.cjs')

let server = null
let serverOrigin = ''

async function start(_vaultDir, { host = '127.0.0.1', port = 0 } = {}) {
  if (server) return { origin: serverOrigin }
  server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, `http://${host}`)
      if (!u.pathname.startsWith('/f/')) {
        res.writeHead(404).end('not found')
        return
      }
      const out = await vault.serveVault(
        new Request(`vault://f/${u.pathname.slice(3)}`, {
          headers: req.headers.range ? { range: req.headers.range } : {},
        }),
      )
      const headers = Object.fromEntries(out.headers)
      res.writeHead(out.status, headers)
      const bytes = Buffer.from(await out.arrayBuffer())
      res.end(bytes)
    } catch {
      res.writeHead(500).end('vault http error')
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolve)
  })
  serverOrigin = `http://${host}:${server.address().port}`
  return { origin: serverOrigin }
}

async function stopServer() {
  if (!server) return
  if (typeof server.closeAllConnections === 'function') {
    server.closeAllConnections()
  }
  await new Promise((resolve) => server.close(resolve))
  server = null
  serverOrigin = ''
}

/** localhost URL for a stored vault:// URL, or null when it is not stored. */
function httpUrl(vaultUrl) {
  if (!serverOrigin || !vaultUrl || !String(vaultUrl).startsWith('vault://f/')) return null
  return `${serverOrigin}/f/${String(vaultUrl).split('/').pop()}`
}

module.exports = { start, stop: stopServer, httpUrl, origin: () => serverOrigin }
