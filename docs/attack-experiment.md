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
| Credencial | `CARNET:<RUT>:<serie>`: **fija** por persona, igual en todo evento y fecha | QR generado por el teléfono: cédula firmada por el emisor (con foto) + firma del dispositivo, 45 s, un solo uso, cifrado para lectores autorizados (ADR-11) |
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
| Copia usada en otro evento, 30 días después | **Ataque pasa** | Bloqueado (`expired`) | No / **Sí** |
| Reenvío en tiempo real (4,5 s) | **Ataque pasa** (el carnet falso lleva la foto del cómplice) | Pasa la validación, pero **la foto es la del titular**: el guardia lo rechaza (`photo_mismatch`) | No / **Sí** |
| Copia usada después de que el titular ingresó | Bloqueado | Bloqueado | — |

| | QR estático | QR dinámico |
|---|---|---|
| Ataques que pasan la validación automática | **4 de 5** | 1 de 5 |
| Ataques que pasan además una comparación correcta de la foto | **4 de 5** | **0 de 5** |

Ningún modo rechaza al titular legítimo (0 falsos rechazos en el control). El modo dinámico usa el
escáner en dos pasos (ADR-12) con un guardia que compara bien la foto: por eso, en el reenvío en
tiempo real, el titular sí entra después; con un solo paso, el intento del cómplice habría consumido
su entrada aunque el guardia no lo dejara pasar.

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
  el guardia siempre detecta a una persona distinta. Es un **límite superior**, no el resultado
  esperado: ver §4.1.

### 4.1 Qué dice la literatura sobre el error humano al comparar rostros

Comparar una foto con una persona desconocida es una tarea con errores frecuentes, incluso para
profesionales. Referencias verificadas (DOI) en `referencias-comparacion-rostros.bib`.

- **La tarea es difícil aun con la persona en vivo.** Al comparar a una persona presente con una
  sola foto, el acierto ronda el 85 % (Megreya y Burton, 2008). Somos expertos en rostros
  conocidos, no en desconocidos (Young y Burton, 2018).
- **La experiencia no protege.** Oficiales que emiten pasaportes, comparando fotos con personas en
  vivo, aceptaron un 14 % de fotos "fraudulentas", con precisión igual a la de estudiantes y sin
  relación con sus años de experiencia (White et al., 2014). Cajeros que verificaban tarjetas de
  crédito con foto rindieron mal incluso en condiciones favorables (Kemp et al., 1997). Una
  técnica común de capacitación no mejora el acierto (Towler et al., 2014).
- **Las condiciones de una puerta lo empeoran:**
  - los impostores son raros, y cuando lo son se omiten mucho más (Papesh y Goldinger, 2014;
    Papesh et al., 2018);
  - la foto del documento no es de hoy, y las fotos tomadas con meses de diferencia se comparan
    peor (Megreya et al., 2013; Fysh y Bindemann, 2018);
  - la foto del QR es de baja resolución (72×96 px en el prototipo), y el acierto baja al aumentar
    la pixelación (Bindemann et al., 2013).
- **Qué ayuda:** seleccionar a quienes comparan mejor (Robertson et al., 2016; Bindemann et al.,
  2012), sumar varios juicios (White et al., 2013) o combinar el juicio humano con un algoritmo
  (Phillips et al., 2018). Esta última es la vía que adopta **ADR-16**: un comparador local en el
  dispositivo del guardia que apoya su decisión en vez de reemplazarla, que es exactamente la
  combinación humano+algoritmo que Phillips et al. encuentran superior a cualquiera de los dos por
  separado. Aún no implementada, y su techo depende de la pixelación citada arriba: medir primero.

**Por qué la foto de la cédula digital ayuda al guardia frente a la del carnet.** Todo lo que sigue
describe **este prototipo**: su QR trae la foto (WebP de 72×96 px) y el emisor firma su hash
SHA-256 dentro del núcleo de la cédula, así que cambiar un solo bit de la foto hace que el lector
la rechace (`credential.py::check_qr`). El contenido del QR de la app real de Identificación
Digital no es público: no se sabe si trae la foto, si el lector la obtiene en línea o si trae solo
un identificador. No trasladar estas propiedades a la app real sin una fuente oficial.

1. **Es auténtica.** En el carnet falsificado la foto es la del atacante, así que el guardia
   "acierta" al compararla y el ataque pasa igual. Con la foto firmada del QR, el atacante tiene
   que **parecerse** al titular: el error humano no desaparece, pero el ataque queda restringido
   al impostor parecido.
2. **Es a color.** La foto del carnet físico va grabada con láser en blanco y negro — fuente
   primaria: Resolución Exenta 466 de 2024 del Registro Civil, que al describir el anverso dice
   *«Fotografía principal en blanco y negro grabada mediante láser»* (la misma resolución añade una
   segunda fotografía SLI reducida con el año de nacimiento integrado) — y el guardia la compara
   con una persona que ve a color. Esa
   comparación mixta es la más desfavorable: con una foto en escala de grises y otra a color, las
   personas tienden a aceptar el par como "la misma persona" sea o no la misma, y el acierto baja
   (Bobak, Mileva y Hancock, 2019). La foto del prototipo es a color, así que la comparación es
   entre imágenes congruentes. Además, el color aporta más justo cuando la forma del rostro se ve
   degradada, como en una imagen pequeña (Yip y Sinha, 2002), que es el caso de la foto del QR.
   En la app real de Identificación Digital, al mostrar el QR dinámico aparece sobre él una foto
   a color y de buena calidad del titular (observación directa del autor, 2026-09-30; para la
   tesis conviene sumar una captura o una fuente oficial). *Matiz:* Bobak et al. compararon pares
   de fotos, no una foto con una persona en vivo; extenderlo a la puerta es una inferencia
   razonable, no un resultado medido.
3. **Se ve en el dispositivo del guardia, no solo en el del titular.** Una foto mostrada en la
   pantalla del celular del titular no prueba nada por sí sola: una app falsa, un video o una
   captura editada pueden poner cualquier foto sobre un QR, igual que el falsificador controla la
   foto de un carnet falso. La foto es confiable solo si el verificador la obtiene por un canal
   que el titular no controla. En este prototipo, el escáner del guardia descifra el QR y muestra
   **en su propia pantalla** la foto firmada por el emisor; si no coincide con la que muestra el
   celular del titular, el engaño queda en evidencia. No es público si el lector oficial de la app
   real hace lo mismo; este prototipo lo garantiza por construcción.

**Cómo usarlo en la tesis:** presentar el nivel "con comparación de foto" como límite superior,
declarar las condiciones que lo empeoran y mantener los dos matices a favor (foto auténtica y a
color). La conclusión no cambia de signo: con una comparación imperfecta el QR dinámico sigue
eliminando las copias y exige un impostor parecido y coordinado en tiempo real.
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
