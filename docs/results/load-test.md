# Resultados de la prueba de carga (generado)

Generado por `backend/scripts/load_test.py` el 2026-09-29T15:31:18+00:00. No editar a mano.

- Plataforma: Windows 11 / Python 3.13.14 / Intel64 Family 6 Model 151 Stepping 2, GenuineIntel
- Montaje: 1 proceso uvicorn, SQLite en disco, cliente httpx asincrono en la misma maquina
- Entradas por nivel: 400; cada QR se escanea desde 2 filas a la vez (800 solicitudes por nivel)

| Concurrencia (guardias) | Solicitudes/s | Ingresos/s | Cliente media (ms) | Cliente p50 / p95 / p99 (ms) | Servidor p50 / p95 (ms) | Errores | Dobles concesiones |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 63.0 | 31.5 | 22.93 | 28.12 / 32.22 / 46.02 | 7.75 / 21.03 | 0 | 0 |
| 2 | 61.9 | 31.0 | 39.9 | 29.23 / 108.38 / 262.72 | 17.51 / 83.71 | 0 | 0 |
| 4 | 61.6 | 30.8 | 72.1 | 29.05 / 124.3 / 1667.12 | 17.94 / 112.49 | 0 | 0 |
| 8 | 58.1 | 29.0 | 158.81 | 29.87 / 318.01 / 3797.96 | 18.73 / 267.53 | 3 | 0 |
| 16 | 93.7 | 46.7 | 186.66 | 37.6 / 565.51 / 3756.57 | 2.63 / 356.9 | 2 | 0 |
