import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

// 测试产生的大量临时数据库和模拟文件直接落盘到 /var/tmp，避免受限于 971MB tmpfs 内存盘
process.env.TMPDIR = process.env.TMPDIR || '/var/tmp'

/**
 * 测试配置。构建用的 vite.config.ts 不动，这里只补测试需要的部分。
 *
 * 引擎、赛季、培养的测试要跑整场 / 整赛季的模拟，单个测试要几秒到几十秒（v3 一场约 0.3 秒，批量测试一次跑几十到上百场），
 * 默认的 5 秒在并行跑几十个测试文件时必然误报超时，并行时每个测试还会慢 2 倍以上。120 秒仍然能抓住真正卡死的测试。
 * 个别测试自己声明了更长的超时，以它为准。
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      testTimeout: 120_000,
      hookTimeout: 120_000,
    },
  }),
)
