import { defineConfig } from 'vite'

/** 构建时间用本地时区，页脚显示的时间和开发者看到的一致。 */
const pad = (value: number) => String(value).padStart(2, '0')
const builtAt = (() => {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
})()

export default defineConfig({
  // GitHub Pages 的项目页部署在 /<repo>/ 下，使用相对资源路径。
  base: './',
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
  // 页脚显示构建时间，用来判断浏览器拿到的是不是最新那版。
  define: {
    __BUILD_ID__: JSON.stringify(builtAt),
  },
})
