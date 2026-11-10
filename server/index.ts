import { createAppServer, type RegistrationMode } from './app.ts'
import { loadPveContent } from '../src/game/pve-content.ts'

const port = Number(process.env.PORT ?? 8787)
// PvE 对手快照很大，启动时只在这里读一次；普通页面不会下载它。
await loadPveContent()

function readRegistration(): RegistrationMode {
  const raw = (process.env.FM_REGISTRATION ?? 'open').trim().toLowerCase()
  if (raw === 'open' || raw === 'invite' || raw === 'closed') return raw
  console.warn(`FM_REGISTRATION="${raw}" 无法识别，回退为 open（可选 open / invite / closed）`)
  return 'open'
}

const registration = readRegistration()
const inviteCode = process.env.FM_INVITE_CODE?.trim() ?? ''

if (registration === 'invite' && !inviteCode) {
  console.error('FM_REGISTRATION=invite 但缺少 FM_INVITE_CODE，已改为 closed（只允许登录）。')
}

const { server } = createAppServer({
  dataDir: process.env.FM_DATA_DIR ?? 'data',
  staticDir: process.env.FM_STATIC_DIR ?? 'dist',
  tickMs: Number(process.env.FM_TICK_MS ?? 30_000),
  registration: registration === 'invite' && !inviteCode ? 'closed' : registration,
  inviteCode,
  turnstileSecret: process.env.FM_TURNSTILE_SECRET?.trim(),
  turnstileSiteKey: process.env.FM_TURNSTILE_SITEKEY?.trim(),
  registerLimitPerHour: Number(process.env.FM_REGISTER_LIMIT_PER_HOUR ?? 5),
})

server.listen(port, '0.0.0.0', () => {
  console.log(`FM online server: http://localhost:${port}`)
  console.log(
    `注册入口: ${registration === 'invite' && !inviteCode ? 'closed（缺少 FM_INVITE_CODE）' : registration}`
      + `${process.env.FM_TURNSTILE_SECRET ? ' · Turnstile 已启用' : ''}`
      + ` · 单 IP 每小时 ${process.env.FM_REGISTER_LIMIT_PER_HOUR ?? 5} 次`,
  )
})
