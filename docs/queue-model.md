# Prueba de carga y modelo de colas — ¿cuánto cuesta la seguridad en la fila?

**Contexto.** En los eventos masivos de hoy ya se lee un QR: el QR **estático** del carnet físico,
acompañado de una verificación visual. El aporte de la tesis es de **seguridad**: un QR dinámico
(45 s, un solo uso, validado en línea) no se puede reutilizar a partir de una foto o una copia, y
por eso es más difícil de falsear que una cédula física (ver `threat-model.md §6`).

El trámite en la puerta sigue siendo leer un QR y mirar a la persona, así que la hipótesis a
demostrar **no es** "filas más cortas". Es la siguiente:

> **H: El QR dinámico aumenta la seguridad sin alargar de forma relevante las filas.**

La validación en línea agrega dos riesgos concretos para H. Este documento mide ambos:

1. **Capacidad del servidor.** Si no alcanza a validar a la tasa de llegada, sería un cuello de
   botella (§1, prueba de carga).
2. **Latencia por persona.** Cada validación suma tiempo al servicio de cada fila, y cerca de la
   saturación incluso unos milisegundos se amplifican (§2, modelo de colas).

Resultados completos (generados por los scripts, no editar a mano):
[`results/load-test.md`](results/load-test.md) · [`results/queue-model.md`](results/queue-model.md)

---

## 1. Prueba de carga (`backend/scripts/load_test.py`)

**Montaje.** El script levanta un servidor propio (un proceso uvicorn, SQLite en disco) sobre una
base temporal, crea 400 entradas activadas y pre-genera un QR por entrada. Luego *k* escáneres
validan en paralelo (k = 1, 2, 4, 8, 16), sin pausa entre escaneos: es una prueba de estrés, más
dura que una puerta real. **Cada QR se escanea desde dos filas a la vez**, para ejercitar la
carrera que resuelve el consumo atómico (ADR-8).

**Resultados** (tabla completa en `results/load-test.md`):

- **Correctitud bajo carga:** 0 dobles concesiones en 2.000 QR. Cada QR concedió acceso
  exactamente una vez, aunque se escaneó desde dos filas simultáneamente.
- **Capacidad:** 29–43 ingresos/s (59–86 solicitudes/s), es decir, más de 100.000 validaciones
  por hora en un solo proceso con SQLite.
- **Latencia:** con 1 escáner la media es de 24 ms (p95 de 32 ms). Bajo estrés la mediana se
  mantiene en 30–60 ms, pero la cola crece: p95 de hasta 0,56 s y p99 de hasta 4,7 s. La causa es
  que **SQLite serializa las escrituras**.
- **Errores:** 6 de 4.000 solicitudes, todos con 8–16 escáneres saturando el servidor.

**Lectura.** En la punta del escenario (§2) llegan 5 validaciones/s a un servidor que atiende
unas 29 por segundo: **utilización del 17 %**. El servidor no es el cuello de botella. La cola de
latencia bajo saturación es una limitación de la infraestructura del prototipo, no del protocolo.
Se mitiga con PostgreSQL o SQLite en modo WAL y varios procesos (ADR-4).

**Límites de la prueba.** Cliente y servidor corren en la misma máquina: no hay red real de
estadio (congestión, pérdida) ni TLS. Los números acotan el procesamiento, no el enlace
inalámbrico. La conectividad en el recinto es el riesgo operativo pendiente (ADR-1).

## 2. Modelo de colas (`backend/scripts/queue_model.py`)

### 2.1 Modelo

Cada fila física es una cola **M/G/1** independiente: llegadas de Poisson, tiempo de servicio con
media E[S] y coeficiente de variación Cs, un guardia. Se eligió M/G/1 por fila porque en una
puerta cada fila tiene su propia cola. Para M/G/1 la espera media es **exacta** (fórmula de
Pollaczek–Khinchine):

$$W_q = \frac{\rho \, E[S]\,(1 + C_s^2)}{2(1-\rho)}, \qquad \rho = \lambda_{\text{fila}}\,E[S]$$

Por la **ley de Little**, las personas esperando en esa fila son $L_q = \lambda_{\text{fila}} W_q$.
Si $\rho \ge 1$ la fila es inestable y crece sin límite mientras dure la punta.

**Comparación.** Ambas modalidades tienen el **mismo tiempo humano** (leer QR + verificación
visual). El QR dinámico suma la latencia de validación **medida** en §1, en tres niveles:

| Nivel | Latencia sumada | Qué representa |
|---|---:|---|
| Realista | 24 ms | Media con 1 escáner concurrente. Al 17 % de utilización, las validaciones casi nunca coinciden |
| Estrés | 212 ms | Peor media observada, con el servidor saturado |
| Cota | 565 ms | Peor p95 aplicado a *todas* las validaciones (pesimista a propósito) |

**Validación.** La fórmula se contrastó con una simulación de eventos discretos (recursión de
Lindley, servicio Gamma, 200.000 personas por fila):

- Diferencias < 3 % para ρ ≤ 0,89.
- Diferencia de 10 % en el caso extremo ρ = 0,97, donde la simulación converge lento: con alta
  utilización hacen falta muchas más muestras.

Además, `backend/tests/test_queue_model.py` verifica los casos límite conocidos: M/M/1,
M/D/1 = ½·M/M/1, inestabilidad y ley de Little.

### 2.2 Supuestos — **a reemplazar por mediciones**

| Parámetro | Valor | Naturaleza |
|---|---|---|
| Llegadas en hora punta | 5 personas/s (18.000/h), Poisson | Supuesto ilustrativo |
| Filas con guardia | 45 | Supuesto (deja la línea base cerca de saturar, ρ ≈ 0,89) |
| Tiempo humano (leer QR + verificación visual) | 8 s, Cs = 0,5; sensibilidad 6–8,5 s | **Supuesto — no medido** |
| Latencia de validación | 24 / 212 / 565 ms | **Medido** (§1) |

El tiempo humano no cambia la conclusión cualitativa, pero sí la magnitud. Conviene cronometrarlo
en una puerta real (n ≥ 30) o respaldarlo con literatura verificada.

### 2.3 Resultados

Espera media en cola (s) / personas esperando por fila, con un tiempo humano de 8 s (ρ = 0,89):

| Modalidad | Espera media | Personas por fila |
|---|---:|---:|
| QR estático del carnet físico | 40,0 s | 4,4 |
| QR dinámico, latencia realista | 41,2 s (+3 %) | 4,6 |
| QR dinámico, servidor en estrés | 53,5 s (+34 %) | 5,9 |
| QR dinámico, cota pesimista | 105,3 s (+163 %) | 11,7 |

Con la cota pesimista, igualar la espera del carnet físico requiere **4 filas más** (de 45 a 49).
La sensibilidad a 6, 7 y 8,5 s está en `results/queue-model.md`: con holgura (6 s, ρ = 0,67) el
costo realista es de +0,1 s; muy cerca de la saturación (8,5 s, ρ = 0,94) es de +5 s.

### 2.4 Conclusión

- **En condiciones realistas, H se cumple.** La validación en línea agrega ~24 ms por persona, y la
  espera en la punta sube un 3 % (unos 1 s). El servidor opera al 17 % de su capacidad. **La
  seguridad adicional se obtiene prácticamente sin costo en la fila.**
- **El riesgo real es la cola de latencia, no la media.** Cerca de la saturación (ρ → 1), cualquier
  aumento del tiempo de servicio se amplifica de forma no lineal. Si el servidor se satura o la red
  del recinto agrega segundos, el efecto en la fila es grande. Esto se traduce en dos requisitos
  de despliegue:
  - una base de datos con escrituras concurrentes;
  - conectividad dedicada en las puertas, o un modo de verificación sin conexión (reabrir ADR-1).
- **Un beneficio posible, no demostrado:** si el escáner mostrara la foto del titular traída del
  servidor (ADR-10, propuesta), la verificación visual podría acortarse. En el escenario
  exploratorio de `results/queue-model.md §4` (supuesto de 3 s, 60 % de adopción), la espera media
  bajaría de 40 s a ~4 s. Es un supuesto no medido y **no debe presentarse como resultado**.

### 2.5 Limitaciones del modelo

- **Estacionario:** modela una hora punta con tasa constante. Los picos reales (apertura de
  puertas) llevan transitoriamente a ρ > 1 en ambas modalidades.
- **Filas independientes:** no hay cambio de fila (*jockeying*). La revisión de seguridad (bolsos,
  detectores) es una etapa en serie común a ambas modalidades y no se modela.
- **Latencia constante:** la latencia del servidor se suma como constante. Su varianza no entra en
  E[S²], lo que la subestima levemente en los niveles de estrés.

## 3. Cómo reproducir

```bash
cd backend
uv run python scripts/load_test.py      # ~1 min; escribe docs/results/load-test.{json,md}
uv run python scripts/queue_model.py    # usa load-test.json; escribe docs/results/queue-model.{json,md}
uv run python -m pytest tests/test_queue_model.py
```
