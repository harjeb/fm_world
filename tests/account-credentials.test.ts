import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'

const servers: AppServer[] = []
const dirs: string[] = []

async function start(dir?: string) {
  const dataDir = dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'fm-credentials-test-'))
  if (!dir) dirs.push(dataDir)
  const app = createAppServer({ dataDir, staticDir: path.resolve('dist'), tickMs: 0 })
  servers.push(app)
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  const port = (app.server.address() as AddressInfo).port
  return { app, base: `http://127.0.0.1:${port}`, dir: dataDir }
}

async function postJson(base: string, pathname: string, body: Record<string, unknown>, token?: string) {
  const response = await fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: (await response.json()) as Record<string, any> }
}

async function getJson(base: string, pathname: string, token?: string) {
  const response = await fetch(`${base}${pathname}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  return { status: response.status, body: (await response.json()) as Record<string, any> }
}

afterEach(() => {
  while (servers.length) servers.pop()!.close()
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

describe('修改账号与密码接口', () => {
  it('校验登录态、当前密码、格式与重名，拒绝 Agent 令牌', async () => {
    const { base } = await start()
    const a = await postJson(base, '/api/register', { username: 'alice_01', password: 'password1' })
    const b = await postJson(base, '/api/register', { username: 'bob_02', password: 'password2' })
    expect(a.status).toBe(201)
    expect(b.status).toBe(201)
    const tokenA = a.body.token as string

    // 未登录拒绝
    expect((await postJson(base, '/api/account/credentials', { currentPassword: 'password1', username: 'new_name' })).status).toBe(401)

    // Agent 令牌不能修改账号密码
    const agent = await postJson(base, '/api/agent/token', {}, tokenA)
    expect(agent.status).toBe(200)
    expect((await postJson(base, '/api/account/credentials', { currentPassword: 'password1', username: 'agent_hack' }, agent.body.token)).status).toBe(401)

    // 缺少当前密码 -> 400；当前密码错误 -> 403
    expect((await postJson(base, '/api/account/credentials', { username: 'alice_new' }, tokenA)).status).toBe(400)
    expect((await postJson(base, '/api/account/credentials', { currentPassword: 'wrong-password', username: 'alice_new' }, tokenA)).status).toBe(403)

    // 未提供变更 / 格式错误 / 重名 / 新密码过短 / 与原密码相同
    expect((await postJson(base, '/api/account/credentials', { currentPassword: 'password1', username: 'alice_01' }, tokenA)).status).toBe(400)
    expect((await postJson(base, '/api/account/credentials', { currentPassword: 'password1', username: 'x' }, tokenA)).status).toBe(400)
    expect((await postJson(base, '/api/account/credentials', { currentPassword: 'password1', username: 'BOB_02' }, tokenA)).status).toBe(409)
    expect((await postJson(base, '/api/account/credentials', { currentPassword: 'password1', newPassword: '123' }, tokenA)).status).toBe(400)
    expect((await postJson(base, '/api/account/credentials', { currentPassword: 'password1', newPassword: 'password1' }, tokenA)).status).toBe(400)
  })

  it('只修改用户名时保留登录态、同步聊天记录，并支持仅调整大小写且重启持久化', async () => {
    const first = await start()
    const reg = await postJson(first.base, '/api/register', { username: 'coach_old', password: 'password1' })
    const token = reg.body.token as string

    // 先发一条聊天消息，改名后应同步显示新用户名
    const sent = await postJson(first.base, '/api/chat', { text: '大家好' }, token)
    expect(sent.status).toBe(200)

    const renamed = await postJson(first.base, '/api/account/credentials', { currentPassword: 'password1', username: '新教练_01' }, token)
    expect(renamed.status).toBe(200)
    expect(renamed.body.user.username).toBe('新教练_01')
    expect(renamed.body.usernameChanged).toBe(true)
    expect(renamed.body.passwordChanged).toBe(false)
    expect(renamed.body.token).toBeUndefined()

    // 原会话仍然有效且 /api/me 返回新用户名
    const me = await getJson(first.base, '/api/me', token)
    expect(me.status).toBe(200)
    expect(me.body.user.username).toBe('新教练_01')

    // 聊天历史同步更新
    const chat = await getJson(first.base, '/api/chat', token)
    expect(chat.body.messages.some((m: any) => m.username === '新教练_01' && m.text === '大家好')).toBe(true)

    // 允许只调整自己用户名的大小写
    const cased = await postJson(first.base, '/api/account/credentials', { currentPassword: 'password1', username: 'Coach_Case' }, token)
    expect(cased.status).toBe(200)
    const cased2 = await postJson(first.base, '/api/account/credentials', { currentPassword: 'password1', username: 'coach_case' }, token)
    expect(cased2.status).toBe(200)
    expect(cased2.body.user.username).toBe('coach_case')

    // 重启后新用户名持久化，旧用户名无法登录
    await first.app.shutdown()
    servers.pop()
    const second = await start(first.dir)
    expect((await postJson(second.base, '/api/login', { username: 'coach_old', password: 'password1' })).status).toBe(401)
    const relogin = await postJson(second.base, '/api/login', { username: 'coach_case', password: 'password1' })
    expect(relogin.status).toBe(200)
    expect(relogin.body.user.username).toBe('coach_case')
  })

  it('修改密码（含同时改名）会轮换当前令牌、使旧设备会话失效，并持久化', async () => {
    const first = await start()
    const reg = await postJson(first.base, '/api/register', { username: 'dual_user', password: 'old_password' })
    const token1 = reg.body.token as string
    const login2 = await postJson(first.base, '/api/login', { username: 'dual_user', password: 'old_password' })
    const token2 = login2.body.token as string

    const updated = await postJson(first.base, '/api/account/credentials', {
      currentPassword: 'old_password',
      username: 'dual_renamed',
      newPassword: 'new_password_99',
    }, token1)
    expect(updated.status).toBe(200)
    expect(updated.body.usernameChanged).toBe(true)
    expect(updated.body.passwordChanged).toBe(true)
    expect(updated.body.user.username).toBe('dual_renamed')
    expect(typeof updated.body.token).toBe('string')
    const freshToken = updated.body.token as string
    expect(freshToken).not.toBe(token1)

    // 旧令牌（当前设备旧 token 和其他设备 token2）全部失效，新令牌有效
    expect((await getJson(first.base, '/api/me', token1)).status).toBe(401)
    expect((await getJson(first.base, '/api/me', token2)).status).toBe(401)
    const me = await getJson(first.base, '/api/me', freshToken)
    expect(me.status).toBe(200)
    expect(me.body.user.username).toBe('dual_renamed')

    // 重启后只有新用户名 + 新密码可登录
    await first.app.shutdown()
    servers.pop()
    const second = await start(first.dir)
    expect((await postJson(second.base, '/api/login', { username: 'dual_renamed', password: 'old_password' })).status).toBe(401)
    expect((await postJson(second.base, '/api/login', { username: 'dual_user', password: 'new_password_99' })).status).toBe(401)
    const okLogin = await postJson(second.base, '/api/login', { username: 'dual_renamed', password: 'new_password_99' })
    expect(okLogin.status).toBe(200)
    expect(okLogin.body.user.username).toBe('dual_renamed')
  })

  it('/api/health 返回浏览器在线人数与活跃人数（不含 Agent 轮询），并在停服时及时清理 SSE', async () => {
    const { app, base } = await start()
    const before = await getJson(base, '/api/health')
    expect(before.status).toBe(200)
    expect(before.body.onlinePlayers).toBe(0)
    expect(before.body.onlineConnections).toBe(0)
    expect(before.body.recentBrowserPlayers).toBe(0)

    const reg = await postJson(base, '/api/register', { username: 'online_watch', password: 'password1' })
    const token = reg.body.token as string
    const me = await getJson(base, '/api/me', token)
    expect(me.status).toBe(200)

    const ctrl = new AbortController()
    const sse = await fetch(`${base}/api/events?token=${encodeURIComponent(token)}&client=c1`, { signal: ctrl.signal })
    expect(sse.status).toBe(200)
    const during = await getJson(base, '/api/health')
    expect(during.body.onlinePlayers).toBe(1)
    expect(during.body.onlineConnections).toBe(1)
    expect(during.body.recentBrowserPlayers).toBe(1)

    ctrl.abort()
    await app.shutdown()
    servers.pop()
  })
})

describe('账号弹窗与俱乐部页修改入口 UI', () => {
  it('已登录时无需退出，联机账号弹窗直接展示修改表单，俱乐部页也提供快捷入口', async () => {
    const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('window', { localStorage: storage, location: { search: '', hash: '', origin: 'http://localhost' }, addEventListener() {}, matchMedia: () => ({ matches: false }) })
    vi.stubGlobal('document', { documentElement: { dataset: {} }, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} })

    const { ui } = await import('../src/ui/state.ts')
    const { onlineState } = await import('../src/online.ts')
    const { renderAccountOverlay } = await import('../src/ui/screens/overlays.ts')
    const { renderClub } = await import('../src/ui/screens/club.ts')

    const prevUi = { accountOpen: ui.accountOpen, accountEditNonce: ui.accountEditNonce, accountEditError: ui.accountEditError, accountEditBusy: ui.accountEditBusy }
    const prevOnline = { status: onlineState.status, user: onlineState.user, connected: onlineState.connected, error: onlineState.error }
    try {
      Object.assign(onlineState, { status: 'online', user: { id: 'u1', username: 'demo_coach' }, connected: true, error: '' })
      Object.assign(ui, { accountOpen: true, accountEditNonce: 0, accountEditError: '当前密码不正确', accountEditBusy: false })

      const modal = renderAccountOverlay()
      expect(modal).toContain('demo_coach')
      expect(modal).toContain('修改账号与密码')
      expect(modal).toContain('无需退出登录')
      expect(modal).toContain('id="account-current-password"')
      expect(modal).toContain('id="account-new-username"')
      expect(modal).toContain('id="account-new-password"')
      expect(modal).toContain('id="account-confirm-password"')
      expect(modal).toContain('data-action="account-credentials-submit"')
      expect(modal).toContain('当前密码不正确')

      const clubHtml = renderClub()
      expect(clubHtml).toContain('data-action="account-open-credentials"')
      expect(clubHtml).toContain('修改账号 / 密码')
    } finally {
      Object.assign(ui, prevUi)
      Object.assign(onlineState, prevOnline)
    }
  })
})
