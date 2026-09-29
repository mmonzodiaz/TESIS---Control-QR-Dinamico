# Prueba de carga y modelo de colas — ¿cuánto cuesta la seguridad en la fila?

**Contexto.** En los eventos masivos de hoy ya se lee un QR: el QR **estático** del carnet físico,
acompañado de una verificación visual. El aporte de la tesis es de **seguridad**: un QR dinámico
(45 s, un solo uso, validado en línea) no se puede reutilizar a partir de una foto o una copia, y
por eso es más difícil de falsear que una cédula física (ver `threat-model.md §6`).

El trámite en la puerta sigue siendo leer un QR y mirar a la persona, así que la hipótesis a
demostrar **no es** "un trámite más rápido". Es la siguiente:

> **H: El QR dinámico aumenta la seguridad sin alargar de forma relevante las filas.**

Lo que sí mejora es la **calidad** de la verificación: el guardia compara a la persona con una foto
firmada que no se puede alterar, y el sistema rechaza por sí solo la cédula alterada, vencida,
copiada o con prohibición de ingreso. Las filas de cédula digital pueden ser más cortas, pero por
otra razón: mientras pocos la tengan, se les puede dar una fila preferente (§2.5).

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
- **Capacidad:** 29–46 ingresos/s (59–93 solicitudes/s), es decir, más de 100.000 validaciones
  por hora en un solo proceso con SQLite.
- **Latencia:** con 1 escáner la media es de 24 ms (p95 de 33 ms). Bajo estrés la mediana se
  mantiene en 28–40 ms, pero la cola crece: p95 de hasta 0,65 s y p99 de hasta 4,9 s. La causa es
  que **SQLite serializa las escrituras**.
- **Errores:** 6 de 4.000 solicitudes, todos con 8–16 escáneres saturando el servidor.

**Lectura.** En la punta del escenario (§2) llegan 5 validaciones/s a un servidor que atiende
unas 29 por segundo: **utilización del 17 %**. El servidor no es el cuello de botella. La cola de
latencia bajo saturación es una limitación de la infraestructura del prototipo, no del protocolo.
Se mitiga con PostgreSQL o SQLite en modo WAL y varios procesos (ADR-4).

**Límites de la prueba.** Cliente y servidor corren en la misma máquina: no hay red real de
estadio (congestión, pérdida) ni TLS. Los números acotan el procesamiento, no el enlace
inalámbrico. La conectividad en el recinto es el riesgo operativo pendiente (ADR-11: sin red, el
escáner verifica identidad y vigencia, pero no el uso único).

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
| Estrés | 195 ms | Peor media observada, con el servidor saturado |
| Cota | 650 ms | Peor p95 aplicado a *todas* las validaciones (pesimista a propósito) |

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
| Latencia de validación | 24 / 195 / 650 ms | **Medido** (§1) |

El tiempo humano no cambia la conclusión cualitativa, pero sí la magnitud. Conviene cronometrarlo
en una puerta real (n ≥ 30) o respaldarlo con literatura verificada.

### 2.3 Resultados

Espera media en cola (s) / personas esperando por fila, con un tiempo humano de 8 s (ρ = 0,89):

| Modalidad | Espera media | Personas por fila |
|---|---:|---:|
| QR estático del carnet físico | 40,0 s | 4,4 |
| QR dinámico, latencia realista | 41,2 s (+3 %) | 4,6 |
| QR dinámico, servidor en estrés | 52,1 s (+30 %) | 5,8 |
| QR dinámico, cota pesimista | 133,8 s (+235 %) | 14,9 |

Con la cota pesimista, igualar la espera del carnet físico requiere **5 filas más** (de 45 a 50).
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
  - conectividad dedicada en las puertas; sin red, el escáner cae a verificación parcial (ADR-11).
- **Un costo no medido del escáner en dos pasos (ADR-12):** el guardia toca "Dejar pasar" después de
  mirar la foto. Es parte del tiempo humano de servicio (8 s, supuesto), que ya incluye la
  verificación visual; no se modela aparte.
- **El beneficio es de calidad, no de tiempo.** El escáner muestra la foto firmada que trae el QR
  (ADR-10). La verificación visual podría incluso mejorar, pero lo que la tesis sostiene es que la
  información que el guardia mira es **más difícil de falsear**: en el carnet físico la foto y los
  datos están impresos en el mismo objeto que se falsifica; aquí vienen firmados por el emisor y
  cualquier cambio rompe la firma. Por eso el modelo usa el mismo tiempo humano en ambas
  modalidades y no supone una verificación más rápida.

### 2.5 Fila de cédula digital: preferente mientras sean pocos (incentivo a la adopción)

**Argumento.** Hoy pocas personas tienen la cédula digital. Una fila exclusiva para ellas (en el
prototipo, la "Fila cédula digital"), como las filas preferentes de los conciertos, sería corta y **podría incentivar que la gente obtenga su
cédula digital**. Así se ataca una barrera de adopción identificada en la encuesta: la
"Mayoría desinformada activa" (47 %, Anexo A.2) está dispuesta a usar el mecanismo si percibe un
valor concreto, y una fila corta es un valor inmediato y visible.

**Cómo se modela.** El tiempo humano es el mismo en ambas filas (8 s; la digital suma los 24 ms
del servidor), así que la fila digital **no es más corta porque el trámite sea más rápido**. Es
más corta porque el organizador le asigna **más filas por persona** que al resto, que es
exactamente lo que hace una fila preferente. El script asigna a la fila digital el mínimo de filas
que deja su espera bajo 5 s, y mide qué le pasa a la fila normal (tabla completa en
`results/queue-model.md §4`):

| Adopción digital | Filas digitales (proporcional) | Espera fila digital | Espera fila normal (base: 40 s) | Guardias extra para que la normal no empeore |
|---:|---:|---:|---:|---:|
| 2 % | 2 (1) | 3,4 s | 51,6 s | 2 |
| 5 % | 5 (2) | 3,4 s | 95,0 s | 3 |
| 10 % | 9 (4) | 4,0 s | inestable | 5 |
| 20 % | 17 (9) | 4,5 s | inestable | 8 |
| 30 % | 25 (14) | 4,7 s | inestable | 12 |

**Lectura.**

- **El incentivo existe y es fuerte:** quien tiene la cédula digital espera ~4 s en vez de 40 s.
- **No es gratis.** Si la línea base ya está cerca de saturar, quitarle filas al público general lo
  perjudica (con 5 % de adopción, su espera pasa de 40 s a 95 s), y desde un 10 % de adopción la
  fila normal colapsa. **La fila preferente solo es aceptable si se agregan guardias:** 2–3 con
  baja adopción, 12 con un 30 %. Ese es el costo del incentivo y lo paga el organizador, no el
  público.
- **El incentivo se autolimita:** mientras más gente adopta la cédula digital, la fila preferente
  se llena y su ventaja se diluye. Funciona como mecanismo de **transición** para impulsar la
  adopción inicial, no como estado permanente.
- **Equidad.** La fila normal concentra a quienes no pueden o no quieren usar la cédula digital:
  personas sin smartphone, adultos mayores y el arquetipo "Joven desconectado" (17 %, Anexo A.2,
  brecha ya reconocida en `architecture.md §6`). Una condición de diseño defendible es que **la
  fila normal no empeore respecto de la situación actual**. Eso es lo que mide la última columna.

**Lo que el modelo NO demuestra.** Que la fila corta efectivamente motive a la gente a obtener su
cédula digital es una **hipótesis de comportamiento**. El modelo solo cuantifica la ventaja de
espera que se ofrecería. Validarla requeriría una pregunta en la encuesta (disposición a obtener
la cédula digital a cambio de una fila preferente) o un piloto. Tampoco se modela la verificación
de que quien entra a la fila digital realmente tiene la credencial: se resuelve en la misma
puerta, porque sin QR dinámico no puede pasar.

### 2.6 Limitaciones del modelo

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
