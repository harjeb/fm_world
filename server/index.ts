import { createAppServer } from './app.ts'

const port = Number(process.env.PORT ?? 8787)
const { server } = createAppServer({
  dataDir: process.env.FM_DATA_DIR ?? 'data',
  staticDir: process.env.FM_STATIC_DIR ?? 'dist',
  tickMs: Number(process.env.FM_TICK_MS ?? 30_000),
})

server.listen(port, '0.0.0.0', () => {
  console.log(`FM online server: http://localhost:${port}`)
})
