# Experimento de ataque — QR estático del carnet vs. QR dinámico

**Afirmación a demostrar.** Un QR dinámico (45 s, un solo uso, validado en línea) es más difícil de
falsear que el QR estático del carnet físico que hoy se lee en los eventos masivos.

`threat-model.md §6` argumenta esta afirmación ataque por ataque. Este experimento la **ejecuta**:
corre los mismos ataques contra el backend real en ambos modos y registra si cada uno pasa.
Resultados generados: [`results/attack-experiment.md`](results/attack-experiment.md).

## 1. Diseño

**Dos modos, una sola variable.**

| | QR estático (línea base) | QR dinámico (propuesta) |
|---|---|---|
| Endpoint | `POST /baseline/static-validate` (`routers/static_baseline.py`) | Escáner local (`scripts/qr_clients.py`) + `POST /qr/validate` (`routers/qr.py`) |
| Credencial | `CARNET:<RUT>:<serie>`: **fija** por persona, igual en todo evento y fecha | QR generado por el teléfono: cédula firmada por el emisor (con foto) + firma del dispositivo, 45 s, un solo uso, cifrado para el evento (ADR-11) |
| Qué verifica | Que el documento sea válido (serie) y que ese RUT tenga entrada en el evento | Firmas del emisor y del dispositivo, vigencia, evento, uso único y prohibiciones |
| Foto que ve el guardia | La impresa en el carnet presentado (la controla quien lo fabrica) | La firmada dentro del QR: siempre la del titular (ADR-10) |
| Admisión única por entrada | **Sí** | Sí |

La línea base emula lo que verifica hoy la lectura del QR del carnet. Por diseño, **se le dio la
misma regla de admisión única** que al modo dinámico, así que la única diferencia es que la
credencial sea estática o dinámica. Es una elección conservadora: si un evento real no registra
quién ya entró, al QR estático le iría peor que en este experimento.

La línea base solo existe para experimentar: se monta con `ENABLE_STATIC_BASELINE=1` y está
apagada por defecto.

**Modelo del atacante.** Obtiene una copia del QR que muestra el titular: una foto en la fila, una
captura, una fotocopia del carnet. En el modo estático, además, puede fabricar un carnet con ese
QR y su propia foto. No compromete el servidor, el teléfono del titular ni la clave del emisor
(fuera de alcance, `threat-model.md §4`).

**Dos niveles de resultado.** Para cada intento se registra (1) si pasa la **validación automática**
y (2) si **la foto que ve el guardia es la de quien está en la puerta**. La comparación de rostros
no se automatiza: el segundo nivel indica lo que pasaría si el guardia compara bien, que es un
supuesto optimista (ver §4).

**Reloj controlado.** El script reemplaza el reloj del backend para simular esperas (60 s, 1 h,
30 días) sin esperar de verdad. En cada escenario, después del intento del atacante, llega el
titular legítimo y se registra si puede entrar: así se mide también el daño a la víctima.

## 2. Resultados (TTL = 45 s)

| Escenario | QR estático (carnet) | QR dinámico | ¿Titular entra después? estático / dinámico |
|---|---|---|---|
| Control: el titular legítimo ingresa | Acepta | Acepta | — |
| Foto del QR usada 60 s después | **Ataque pasa** | Bloqueado (`expired`) | No / **Sí** |
| Foto del QR usada 1 hora después | **Ataque pasa** | Bloqueado (`expired`) | No / **Sí** |
| Copia usada en otro evento, 30 días después | **Ataque pasa** | Bloqueado (`invalid`: el escáner de otro evento no puede descifrarlo) | No / **Sí** |
| Reenvío en tiempo real (4,5 s) | **Ataque pasa** (el carnet falso lleva la foto del cómplice) | Pasa la validación, pero **la foto es la del titular** | No / No |
| Copia usada después de que el titular ingresó | Bloqueado | Bloqueado | — |

| | QR estático | QR dinámico |
|---|---|---|
| Ataques que pasan la validación automática | **4 de 5** | 1 de 5 |
| Ataques que pasan además una comparación correcta de la foto | **4 de 5** | **0 de 5** |

Ningún modo rechaza al titular legítimo (0 falsos rechazos en el control).

### 2.1 Filtro de personas con prohibición de ingreso

El mismo argumento se aplica **más allá del robo de entradas**: al filtro de personas no deseadas,
como los hinchas con prohibición de asistir a estadios o las personas excluidas por derecho de
admisión. En Chile, la violencia en espectáculos de fútbol profesional está regulada por la
**Ley N° 19.327** y se opera con el plan Estadio Seguro. *(Para la tesis: citar la redacción
vigente de la ley y el mecanismo oficial de prohibición antes de usarlo como argumento.)*

Una prohibición se aplica sobre la **identidad (RUT)**, pero el filtro solo ve **la credencial que
se presenta**. Por eso es exactamente tan fuerte como el vínculo entre credencial y persona. El
experimento agrega una lista de prohibición (`routers/bans.py`), revisada en la puerta en ambos
modos, y la pone a prueba:

| Escenario | QR estático (carnet) | QR dinámico |
|---|---|---|
| Control: el sancionado usa su propia credencial | Bloqueado (`banned`) | Bloqueado (`banned`) |
| El sancionado usa la copia del QR de un tercero (capturada 10 min antes, sin cooperación) | **Evade el filtro** (carnet falso con su propia foto) | Bloqueado (`expired`) |
| El sancionado usa la credencial de un tercero que coopera (carnet prestado / QR reenviado en tiempo real) | Pasa la lectura; la foto es la del tercero | Pasa la validación; **la foto firmada es la del tercero** |

| | QR estático | QR dinámico |
|---|---|---|
| Evasiones que pasan la validación automática | **2 de 2** | 1 de 2 |
| Evasiones que pasan además una comparación correcta de la foto | **1 de 2** | **0 de 2** |

Ambos modos filtran correctamente al sancionado que usa su propia credencial. La diferencia está
en lo que cuesta evadirlo:

- **Con el carnet basta una copia.** Un carnet falsificado con el QR de cualquier persona sin
  prohibición y la foto del sancionado pasa la lectura y la comparación visual. El tercero ni
  siquiera tiene que enterarse, y la copia sirve en todos los partidos.
- **Con el QR dinámico hace falta un cómplice activo en ese momento**, que además **pierde su propio
  ingreso** a ese partido (admisión única, A9). Y aun así, el escáner muestra la foto firmada del
  cómplice, no la del sancionado (ADR-10): la evasión solo funciona si el guardia no compara la
  foto o se equivoca.

## 3. Lectura

- **El QR dinámico elimina toda la clase de ataques por copia diferida.** Una foto, captura o
  fotocopia deja de servir a los 45 s y nunca sirve en otro evento. Con el carnet, una sola copia
  sirve **para siempre y en cualquier evento** en que el titular tenga entrada.
- **Protege también a la víctima.** Con el QR estático, cuando el atacante entra primero, el
  titular legítimo queda afuera (`already_admitted`). Con el dinámico, el ataque falla y el
  titular entra normalmente.
- **El reenvío en tiempo real pasa la validación automática, pero no la foto.** Exige un cómplice
  coordinado que escanee dentro de la ventana de 45 s y antes que el titular, y ese cómplice
  queda frente a un guardia que ve la foto firmada del titular (ADR-10). Con el carnet, el
  falsificador imprime su propia foto, así que la comparación visual no lo detiene.
- **La foto importa por dónde viene, no por estar.** Ambos modos tienen foto; la diferencia es que
  la del carnet la controla quien fabrica el objeto y la del QR dinámico la firma el emisor.
- **Copia usada después del titular:** ambos modos la bloquean, pero en el estático es solo gracias
  a la regla de admisión única que le dimos a la línea base, no a la credencial.

## 4. Validez y límites

- **La línea base es una emulación**, no el sistema del Registro Civil. Modela lo que la lectura
  del QR del carnet puede verificar según información pública (vigencia del documento); la tesis
  debe respaldar esa caracterización con la fuente oficial.
- **La comparación de la foto no está automatizada ni medida.** El experimento registra si la foto
  mostrada corresponde a la persona en la puerta; el nivel "con comparación correcta" supone que
  el guardia siempre detecta a una persona distinta. Es un supuesto optimista: comparar rostros
  desconocidos tiene tasas de error relevantes incluso en personal entrenado. *(Para la tesis:
  respaldar con literatura sobre comparación de rostros desconocidos, p. ej. estudios con
  controladores de pasaportes, antes de usar este argumento.)*
- **Emisor simulado.** Las cédulas del experimento las firma una clave de prueba; no se evalúa la
  infraestructura real del Registro Civil.
- **Es un experimento de protocolo**, no una prueba de penetración: no evalúa implementación,
  red ni dispositivos.
- **Resultado determinista:** mismos ataques, mismos resultados. `backend/tests/test_attack_experiment.py`
  fija esta matriz (ambos niveles), así que si un cambio futuro debilita la propuesta, el test falla.

## 5. Cómo reproducir

```bash
cd backend
uv run python scripts/attack_experiment.py    # escribe docs/results/attack-experiment.{json,md}
uv run python -m pytest tests/test_attack_experiment.py
```
