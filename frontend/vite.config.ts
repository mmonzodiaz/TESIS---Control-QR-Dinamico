import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { defineConfig } from 'vitest/config'

// El frontend llama a /api y Vite lo reenvia al backend local: el celular solo necesita llegar a
// este servidor (sin exponer el backend en la red ni configurar CORS).
const apiProxy = {
  '/api': {
    target: 'http://localhost:8000',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api/, ''),
  },
  // Registro Civil simulado (backend/registro_civil/app.py), proceso aparte.
  '/registro-civil': {
    target: 'http://localhost:8001',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/registro-civil/, ''),
  },
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // `npm run dev:celular`: HTTPS autofirmado, porque el navegador del celular solo da acceso a la
  // camara (escaner) en contextos seguros.
  plugins: [react(), tailwindcss(), ...(mode === 'celular' ? [basicSsl()] : [])],
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
  test: {
    environment: 'node',
  },
}))
