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
| Endpoint | `POST /baseline/static-validate` (`routers/static_baseline.py`) | `POST /qr/validate` (`routers/qr.py`) |
| Credencial | `CARNET:<RUT>:<serie>`: **fija** por persona, igual en todo evento y fecha | UUID emitido por el servidor, 45 s, un solo uso, ligado a la entrada |
| Qué verifica | Que el documento sea válido (serie) y que ese RUT tenga entrada en el evento | Que el QR exista, no esté usado ni vencido y sea de este evento |
| Admisión única por entrada | **Sí** | Sí |

La línea base emula lo que verifica hoy la lectura del QR del carnet. Por diseño, **se le dio la
misma regla de admisión única** que al modo dinámico, así que la única diferencia es que la
credencial sea estática o dinámica. Es una elección conservadora: si un evento real no registra
quién ya entró, al QR estático le iría peor que en este experimento.

La línea base solo existe para experimentar: se monta con `ENABLE_STATIC_BASELINE=1` y está
apagada por defecto.

**Modelo del atacante.** Obtiene una copia del QR que muestra el titular: una foto en la fila, una
captura, una fotocopia del carnet. En el modo estático, además, puede fabricar un carnet con ese
QR y su propia foto. No compromete el servidor ni el teléfono del titular (fuera de alcance,
`threat-model.md §4`).

**Reloj controlado.** El script reemplaza el reloj del backend para simular esperas (60 s, 1 h,
30 días) sin esperar de verdad. En cada escenario, después del intento del atacante, llega el
titular legítimo y se registra si puede entrar: así se mide también el daño a la víctima.

## 2. Resultados (TTL = 45 s)

| Escenario | QR estático (carnet) | QR dinámico | ¿Titular entra después? estático / dinámico |
|---|---|---|---|
| Control: el titular legítimo ingresa | Acepta | Acepta | — |
| Foto del QR usada 60 s después | **Ataque pasa** | Bloqueado (`expired`) | No / **Sí** |
| Foto del QR usada 1 hora después | **Ataque pasa** | Bloqueado (`expired`) | No / **Sí** |
| Copia usada en otro evento, 30 días después | **Ataque pasa** | Bloqueado (`wrong_event`) | No / **Sí** |
| Reenvío en tiempo real (4,5 s) | **Ataque pasa** | **Ataque pasa** | No / No |
| Copia usada después de que el titular ingresó | Bloqueado | Bloqueado | — |

**QR estático: 4 de 5 ataques exitosos. QR dinámico: 1 de 5.** (Filtro de prohibiciones en §2.1.) Ningún modo rechaza al titular
legítimo (0 falsos rechazos en el control).

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
| El sancionado usa la copia del QR de un tercero (capturada 10 min antes, sin cooperación) | **Evade el filtro** | Bloqueado (`expired`) |
| El sancionado usa la credencial de un tercero que coopera (carnet prestado / QR reenviado en tiempo real) | **Evade el filtro** | **Evade el filtro** |

**Evasiones del filtro: carnet 2 de 2, QR dinámico 1 de 2.** Ambos modos filtran correctamente al
sancionado que usa su propia credencial. La diferencia está en lo que cuesta evadirlo:

- **Con el carnet basta una copia.** Una foto o fotocopia del carnet de cualquier persona sin
  prohibición (o un carnet falsificado con ese QR y la foto del sancionado) sirve. El tercero ni
  siquiera tiene que enterarse, y la copia sirve en todos los partidos.
- **Con el QR dinámico hace falta un cómplice activo en ese momento**, que además **pierde su propio
  ingreso** a ese partido (admisión única, A9). El ataque pasa de "conseguir una fotocopia" a
  "convencer a alguien con entrada de quedarse afuera y coordinarse en tiempo real".
- **El caso que queda abierto (préstamo con cooperación) es el argumento más fuerte a favor de
  ADR-10.** Si al escanear el guardia viera la foto oficial del titular, reconocería que quien
  está en la puerta no es el tercero. Para filtrar hinchas sancionados, la foto de referencia
  deja de ser un extra de usabilidad y pasa a ser el control que cierra la brecha.

## 3. Lectura

- **El QR dinámico elimina toda la clase de ataques por copia diferida.** Una foto, captura o
  fotocopia deja de servir a los 45 s y nunca sirve en otro evento. Con el carnet, una sola copia
  sirve **para siempre y en cualquier evento** en que el titular tenga entrada.
- **Protege también a la víctima.** Con el QR estático, cuando el atacante entra primero, el
  titular legítimo queda afuera (`already_admitted`). Con el dinámico, el ataque falla y el
  titular entra normalmente.
- **El riesgo residual es el reenvío en tiempo real**, y se declara como tal (A1 en
  `threat-model.md`). Exige un cómplice coordinado que escanee dentro de la ventana de 45 s y
  antes que el titular. Es un ataque mucho más caro que fotocopiar un carnet. La mitigación
  propuesta es ADR-10 (el guardia ve la foto oficial del titular); otra opción es acortar el TTL,
  con su costo de usabilidad (`ttl-justification.md`).
- **Copia usada después del titular:** ambos modos la bloquean, pero en el estático es solo gracias
  a la regla de admisión única que le dimos a la línea base, no a la credencial.

## 4. Validez y límites

- **La línea base es una emulación**, no el sistema del Registro Civil. Modela lo que la lectura
  del QR del carnet puede verificar según información pública (vigencia del documento); la tesis
  debe respaldar esa caracterización con la fuente oficial.
- **La verificación visual no está automatizada.** En el modo estático, un carnet falsificado lleva
  la foto del atacante, así que esa verificación no lo detendría. En el modo dinámico, hoy el
  guardia solo ve nombre y RUT parcialmente oculto (ADR-10 pendiente).
- **Es un experimento de protocolo**, no una prueba de penetración: no evalúa implementación,
  red ni dispositivos.
- **Resultado determinista:** mismos ataques, mismos resultados. `backend/tests/test_attack_experiment.py`
  fija esta matriz, así que si un cambio futuro debilita la propuesta, el test falla.

## 5. Cómo reproducir

```bash
cd backend
uv run python scripts/attack_experiment.py    # escribe docs/results/attack-experiment.{json,md}
uv run python -m pytest tests/test_attack_experiment.py
```
