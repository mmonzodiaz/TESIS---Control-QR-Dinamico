# Resultados de la prueba de carga (generado)

Generado por `backend/scripts/load_test.py` el 2026-09-29T19:15:39+00:00. No editar a mano.

- Plataforma: Windows 11 / Python 3.13.14 / Intel64 Family 6 Model 151 Stepping 2, GenuineIntel
- Montaje: 1 proceso uvicorn, SQLite en disco, cliente httpx asincrono en la misma maquina
- Entradas por nivel: 400; cada QR se escanea desde 2 filas a la vez (800 solicitudes por nivel)

| Concurrencia (guardias) | Solicitudes/s | Ingresos/s | Cliente media (ms) | Cliente p50 / p95 / p99 (ms) | Servidor p50 / p95 (ms) | Errores | Dobles concesiones |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 61.5 | 30.7 | 23.79 | 28.18 / 33.14 / 46.41 | 5.5 / 20.87 | 0 | 0 |
| 2 | 61.9 | 30.9 | 42.59 | 29.84 / 93.9 / 216.4 | 18.67 / 82.14 | 0 | 0 |
| 4 | 59.4 | 29.7 | 80.22 | 30.48 / 200.7 / 1229.47 | 18.92 / 189.49 | 0 | 0 |
| 8 | 58.7 | 29.4 | 150.79 | 31.17 / 650.5 / 2494.59 | 19.68 / 631.59 | 0 | 0 |
| 16 | 93.3 | 46.2 | 194.93 | 39.86 / 387.18 / 4930.32 | 2.87 / 227.29 | 6 | 0 |
