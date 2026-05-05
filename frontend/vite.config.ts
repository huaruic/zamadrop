import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// FHE SDK 需要 SharedArrayBuffer / Web Worker threads（4.7MB tfhe.wasm 用 wasm-bindgen-rayon 跑）
// 浏览器只有在 cross-origin isolated 时才允许 SharedArrayBuffer，必须发这两个响应头
//
// COEP 用 credentialless 而非 require-corp：require-corp 要求所有跨源子资源带 CORP header，
// 但浏览器钱包扩展（OKX/OneKey 等）注入的 content script 不带 CORP，会破坏 isolation。
// credentialless 同样解锁 SharedArrayBuffer，且对扩展注入更友好（Chrome 96+ 支持）
const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    global: 'globalThis',
  },
  optimizeDeps: {
    exclude: ['@zama-fhe/relayer-sdk'],
  },
  server: {
    headers: crossOriginIsolationHeaders,
  },
  preview: {
    headers: crossOriginIsolationHeaders,
  },
})
