# Resultados del modelo de colas (generado)

Generado por `backend/scripts/queue_model.py`. No editar a mano. Metodo y supuestos en `docs/queue-model.md`.

## Supuestos

- Llegadas en hora punta: 5.0 personas/s (18,000/h), Poisson; 45 filas con guardia
- Tiempo humano de servicio (leer QR + verificacion visual), **igual en ambas modalidades**: 8.0 s, CV 0.5 — **supuesto**
- Latencia del servidor sumada al QR dinamico (medida, `load-test.json`):
  - realista 24 ms (media con 1 escaner concurrente),
  - estres 195 ms (peor media, servidor saturado),
  - cota 650 ms (peor p95 aplicado a todas las validaciones)

## 1. Costo en la fila de la validacion en linea

Espera media en cola Wq (s) y personas esperando por fila Lq, por tiempo humano de servicio.

| Servicio humano (s) | ρ carnet | Carnet fisico Wq / Lq | QR dinamico realista Wq / Lq | QR dinamico estres Wq / Lq | QR dinamico cota Wq / Lq | Filas extra para igualar (cota) |
|---:|---:|---:|---:|---:|---:|---:|
| 6.0 | 0.67 | 7.5 / 0.8 | 7.6 / 0.8 | 8.6 / 1.0 | 11.8 / 1.3 | 7 |
| 7.0 | 0.78 | 15.3 / 1.7 | 15.6 / 1.7 | 17.9 / 2.0 | 27.1 / 3.0 | 6 |
| 8.0 | 0.89 | 40.0 / 4.4 | 41.2 / 4.6 | 52.1 / 5.8 | 133.8 / 14.9 | 5 |
| 8.5 | 0.94 | 90.3 / 10.0 | 95.4 / 10.6 | 154.9 / 17.2 | inestable / inestable | 4 |

## 2. Capacidad del servidor

Demanda en punta: 5.0 validaciones/s. Capacidad medida (peor nivel): 29.4 ingresos/s → utilizacion **17%**.

## 3. Validacion: Pollaczek-Khinchine vs. simulacion

Recursion de Lindley, servicio Gamma, 200,000 personas por fila, semilla 20260925.

| Caso | Wq analitico (s) | Wq simulado (s) | Diferencia |
|---|---:|---:|---:|
| Carnet fisico (8 s) | 40.00 | 39.69 | -0.8% |
| QR dinamico, cota (8 s + p95) | 133.82 | 144.89 | +8.3% |
| Fila rapida exploratoria: qr | 2.47 | 2.49 | +0.5% |
| Fila rapida exploratoria: manual | 6.15 | 6.32 | +2.6% |

## 4. Fila preferente para portadores de cedula digital (incentivo a la adopcion)

Mismo tiempo humano en ambas filas (8 s; la digital suma la latencia realista). A la fila digital se le asigna el minimo de filas que deja su espera bajo 5 s; el resto atiende al publico general. Linea base (todas normales): 40.0 s de espera.

| Adopcion digital | Filas digitales (proporcional) | Espera fila digital (s) / personas | Espera fila normal (s) / personas | Filas extra para que la normal no empeore |
|---:|---:|---:|---:|---:|
| 2% | 2 (1) | 3.4 / 0.2 | 51.6 / 5.9 | 2 |
| 5% | 5 (2) | 3.4 / 0.2 | 95.0 / 11.3 | 3 |
| 10% | 9 (4) | 4.0 / 0.2 | inestable / inestable | 5 |
| 20% | 17 (9) | 4.5 / 0.3 | inestable / inestable | 8 |
| 30% | 25 (14) | 4.7 / 0.3 | inestable / inestable | 12 |

## 5. Exploratorio: fila rapida con la foto firmada del QR (ADR-10)

Supone que, al mostrar el escaner la foto firmada que trae el QR, la verificacion visual se acorta a 3 s para el 60% que llega con QR dinamico. **El mecanismo esta implementado, pero el tiempo de 3 s es un supuesto no medido.**

| Fila | N° filas | Servicio medio (s) | ρ | Wq (s) | Lq por fila |
|---|---:|---:|---:|---:|---:|
| Fila normal | 45 | 8.00 | 0.89 | 40.0 | 4.4 |
| Fila rapida | 16 | 3.02 | 0.57 | 2.5 | 0.5 |
| Fila normal | 29 | 8.00 | 0.55 | 6.2 | 0.4 |

Espera media: 40.0 s (todas normales) → 3.9 s (con fila rapida).

| Adopcion | Filas rapidas / normales | Espera media (s) |
|---:|---:|---:|
| 0% | 0 / 45 | 40.0 |
| 20% | 4 / 41 | 15.4 |
| 40% | 9 / 36 | 7.5 |
| 60% | 16 / 29 | 3.9 |
| 80% | 27 / 18 | 2.0 |
