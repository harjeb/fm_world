import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer, type AppServerOptions } from '../server/app.ts'

const servers: AppServer[] = []
const dirs: string[] = []

async function start(options: Partial<AppServerOptions> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-register-test-'))
  dirs.push(dir)
  const app = createAppServer({ dataDir: dir, staticDir: path.resolve('dist'), tickMs: 0, ...options })
  servers.push(app)
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  const port = (app.server.address() as AddressInfo).port
  return { app, base: `http://127.0.0.1:${port}`, dir }
}

async function postRegister(base: string, body: Record<string, unknown>) {
  const response = await fetch(`${base}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `u${Math.random().toString(36).slice(2, 8)}`, password: 'secret123', ...body }),
  })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

afterEach(() => {
  while (servers.length) servers.pop()!.close()
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('注册入口开关', () => {
  it('默认 open：不填邀请码也能注册', async () => {
    const { base } = await start()
    const result = await postRegister(base, {})
    expect(result.status).toBe(201)
    expect(typeof result.body.token).toBe('string')
  })

  it('closed：一律拒绝注册', async () => {
    const { base } = await start({ registration: 'closed' })
    const result = await postRegister(base, {})
    expect(result.status).toBe(403)
    expect(result.body.error).toBe('本服务器已关闭注册')
  })

  it('invite：邀请码错误或缺失都拒绝', async () => {
    const { base } = await start({ registration: 'invite', inviteCode: 'fm-secret' })
    expect((await postRegister(base, {})).status).toBe(403)
    expect((await postRegister(base, { inviteCode: 'wrong' })).status).toBe(403)
    expect((await postRegister(base, { inviteCode: 'fm-secret2' })).status).toBe(403)
  })

  it('invite：允许粘贴带来的首尾空白', async () => {
    const { base } = await start({ registration: 'invite', inviteCode: 'fm-secret' })
    expect((await postRegister(base, { inviteCode: '  fm-secret ' })).status).toBe(201)
  })

  it('invite：邀请码正确时注册成功', async () => {
    const { base } = await start({ registration: 'invite', inviteCode: 'fm-secret' })
    const result = await postRegister(base, { inviteCode: 'fm-secret' })
    expect(result.status).toBe(201)
    expect(typeof result.body.token).toBe('string')
  })

  it('invite 模式缺少邀请码时启动即失败，避免锁死注册', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-register-test-'))
    dirs.push(dir)
    expect(() => createAppServer({ dataDir: dir, staticDir: path.resolve('dist'), registration: 'invite' })).toThrow(/invite/)
  })

  it('Turnstile 启用但未带 token 时拒绝注册', async () => {
    const { base } = await start({ turnstileSecret: 'dummy-secret', turnstileSiteKey: 'dummy-sitekey' })
    const result = await postRegister(base, {})
    expect(result.status).toBe(400)
    expect(result.body.error).toContain('人机验证')
  })

  it('单 IP 每小时限速生效', async () => {
    const { base } = await start({ registerLimitPerHour: 2 })
    expect((await postRegister(base, {})).status).toBe(201)
    expect((await postRegister(base, {})).status).toBe(201)
    const blocked = await postRegister(base, {})
    expect(blocked.status).toBe(429)
    expect(blocked.body.error).toContain('频繁')
  })
})

describe('/api/public-config', () => {
  it('下发给前端的只有注册模式与 sitekey', async () => {
    const { base } = await start({ registration: 'invite', inviteCode: 'fm-secret', turnstileSiteKey: 'site-key-123' })
    const response = await fetch(`${base}/api/public-config`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.registration).toBe('invite')
    expect(body.turnstileSiteKey).toBe('site-key-123')
    expect(JSON.stringify(body)).not.toContain('fm-secret')
  })

  it('closed 模式如实下发', async () => {
    const { base } = await start({ registration: 'closed' })
    const body = (await (await fetch(`${base}/api/public-config`)).json()) as Record<string, unknown>
    expect(body.registration).toBe('closed')
    expect(body.turnstileSiteKey).toBe('')
  })
})
