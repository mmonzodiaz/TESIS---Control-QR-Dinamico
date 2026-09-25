# Resultados de la prueba de carga (generado)

Generado por `backend/scripts/load_test.py` el 2026-09-25T06:17:03+00:00. No editar a mano.

- Plataforma: Windows 11 / Python 3.13.14 / Intel64 Family 6 Model 151 Stepping 2, GenuineIntel
- Montaje: 1 proceso uvicorn, SQLite en disco, cliente httpx asincrono en la misma maquina
- Entradas por nivel: 400; cada QR se escanea desde 2 filas a la vez (800 solicitudes por nivel)

| Concurrencia (guardias) | Solicitudes/s | Ingresos/s | Cliente media (ms) | Cliente p50 / p95 / p99 (ms) | Servidor p50 / p95 (ms) | Errores | Dobles concesiones |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 62.0 | 31.0 | 23.51 | 28.32 / 32.34 / 47.33 | 4.73 / 20.51 | 0 | 0 |
| 2 | 59.9 | 30.0 | 44.19 | 30.2 / 114.64 / 291.94 | 18.58 / 92.77 | 0 | 0 |
| 4 | 58.7 | 29.4 | 84.86 | 32.0 / 281.34 / 1122.14 | 19.88 / 254.56 | 0 | 0 |
| 8 | 59.7 | 29.8 | 152.06 | 31.42 / 564.64 / 2577.25 | 19.5 / 539.67 | 1 | 0 |
| 16 | 85.8 | 42.6 | 211.63 | 59.35 / 375.03 / 4662.89 | 2.76 / 252.01 | 5 | 0 |
