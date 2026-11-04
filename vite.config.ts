import { defineConfig } from 'vite'

export default defineConfig({
  // GitHub Pages 的项目页部署在 /<repo>/ 下，使用相对资源路径。
  base: './',
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
