/**
 * Custom Next.js server with Socket.io.
 * Used in development and on Railway (when NEXT_CUSTOM_SERVER=true).
 *
 * Railway startup: `node dist/server.js` (after tsc build)
 * Local dev: `npx ts-node --esm server.ts`
 */

import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { initSocketServer } from './src/lib/socket-server.js'

const dev  = process.env['NODE_ENV'] !== 'production'
const port = parseInt(process.env['PORT'] ?? '3000', 10)

const app     = next({ dev })
const handler = app.getRequestHandler()

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url ?? '/', true)
    void handler(req, res, parsedUrl)
  })

  // Attach Socket.io to the same HTTP server
  initSocketServer(httpServer)

  httpServer.listen(port, () => {
    console.log(`[Server] Quorum running on http://localhost:${port}`)
    console.log(`[Server] Socket.io listening on /api/socket`)
    console.log(`[Server] Mode: ${dev ? 'development' : 'production'}`)
  })
}).catch((err: unknown) => {
  console.error('[Server] Failed to start:', err)
  process.exit(1)
})
