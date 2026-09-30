import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { defineConfig } from 'vitest/config'

// El frontend llama a /api y Vite lo reenvia al backend local: el celular solo necesita llegar a
// este servidor (sin exponer el backend en la red ni configurar CORS).
// xfwd: agrega X-Forwarded-For con la IP de quien llama, para que el limite de intentos por IP del
// backend vea a cada visitante y no solo a este proxy (uvicorn confia en X-Forwarded-For de 127.0.0.1).
const apiProxy = {
  '/api': {
    target: 'http://localhost:8000',
    changeOrigin: true,
    xfwd: true,
    rewrite: (path: string) => path.replace(/^\/api/, ''),
  },
  // Registro Civil simulado (backend/registro_civil/app.py), proceso aparte.
  '/registro-civil': {
    target: 'http://localhost:8001',
    changeOrigin: true,
    xfwd: true,
    rewrite: (path: string) => path.replace(/^\/registro-civil/, ''),
  },
}

// Cabeceras de seguridad (OWASP Secure Headers). La camara (escaner) y el puerto serie (pistola
// lectora) solo para este mismo sitio; nada mas.
const baseHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(self), serial=(self), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
}

// CSP de la version de produccion (`npm run build` + `npm run preview`, o el servidor que la sirva).
// En desarrollo no se aplica: Vite inyecta scripts en linea para recargar en caliente.
// - wasm-unsafe-eval: el lector de QR (ZXing-C++) es WebAssembly, servido desde este mismo sitio.
// - style-src 'unsafe-inline': estilos en linea de React y del lector de camara (no ejecuta codigo).
// - fonts.googleapis.com / fonts.gstatic.com: tipografias Manrope y DM Mono.
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // `npm run dev:celular`: HTTPS autofirmado, porque el navegador del celular solo da acceso a la
  // camara (escaner) en contextos seguros.
  plugins: [react(), tailwindcss(), ...(mode === 'celular' ? [basicSsl()] : [])],
  server: { proxy: apiProxy, headers: baseHeaders },
  preview: {
    proxy: apiProxy,
    headers: { ...baseHeaders, 'Content-Security-Policy': contentSecurityPolicy },
    // `npm run tunel` publica la version de produccion con un tunel rapido de Cloudflare
    // (https://<aleatorio>.trycloudflare.com); Vite rechaza por defecto los dominios que no conoce.
    allowedHosts: ['.trycloudflare.com'],
  },
  test: {
    environment: 'node',
  },
}))
