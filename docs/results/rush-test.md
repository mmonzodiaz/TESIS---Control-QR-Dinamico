# Resultados de la prueba de punta (generado)

Generado por `backend/scripts/rush_test.py`. No editar a mano. Servidor, base y cliente en la misma
máquina, así que los tiempos son una cota inferior de lo que se vería con red.

Cada persona tiene una entrada válida y pasa por el flujo de dos pasos. Una fracción intenta además
un fraude a la vez: *mismo QR en dos filas* o *dos QR en dos filas*. Lo correcto es que cada
persona entre exactamente una vez.

| Corrida | Base | Procesos | Personas | Filas | Personas/min | Solicitud p50 / p95 / p99 (ms) | Persona p50 / p95 (ms) | Errores 5xx | Entraron dos veces | No entraron |
|---|---|---:|---:|---:|---:|---|---|---:|---:|---:|
| postgresql-1 | PostgreSQL | 1 | 2000 | 32 | 2184 | 297.2 / 1162.3 / 1748.7 | 737.3 / 1876.4 | 0 de 4640 | 0 | 0 |
| postgresql-4 | PostgreSQL | 4 | 2000 | 32 | 2058 | 314.2 / 1259.1 / 1972.1 | 793.4 / 1987.8 | 0 de 4629 | 0 | 0 |
| sqlite-1 | SQLite | 1 | 2000 | 32 | 1640 | 349.9 / 1550.6 / 4375.2 | 833.4 / 3462.5 | 24 de 4766 | 0 | 18 |

Detalle por tipo de persona:

- **postgresql-1** (2026-11-07T20:12:26+00:00): normal: 1574 de 1574 una vez, 0 dos veces; mismo QR en dos filas: 212 de 212 una vez, 0 dos veces; dos QR en dos filas: 214 de 214 una vez, 0 dos veces. En la base: 2000 ingresos.
- **postgresql-4** (2026-11-07T20:13:32+00:00): normal: 1574 de 1574 una vez, 0 dos veces; mismo QR en dos filas: 212 de 212 una vez, 0 dos veces; dos QR en dos filas: 214 de 214 una vez, 0 dos veces. En la base: 2000 ingresos.
- **sqlite-1** (2026-11-07T20:33:29+00:00): normal: 1556 de 1574 una vez, 0 dos veces; mismo QR en dos filas: 212 de 212 una vez, 0 dos veces; dos QR en dos filas: 214 de 214 una vez, 0 dos veces. En la base: 1982 ingresos.
