# Guía para llevar el prototipo a la tesis

Qué incluir de este repositorio en la tesis, en qué capítulo, de qué documento sacarlo y qué
afirmar (y qué no). Estado del prototipo al 2026-10-03: completo, **155 tests en verde** (106 de
backend con `pytest`, 49 de frontend con `vitest`), commit `8ba76cf` en adelante. Los documentos de `docs/` son autocontenidos: cada sección de abajo apunta
al que tiene el detalle.

---

## 0. Antes de redactar (bloqueantes)

- [ ] **Informar a los guías** (Eduardo Godoy, Alejandro Hevia) de los cambios de diseño que
      reabren decisiones ya conversadas: el QR ahora lleva firmas de clave pública (ADR-10, ADR-11),
      foto firmada para comparación humana (ADR-10), la cédula es
      de la persona y no del evento (ADR-13), revocación (ADR-14), operación sin conexión (ADR-15) y
      el endurecimiento OWASP. **Prioritario:** ADR-16 reemplaza al ADR-5 e incorpora comparación
      biométrica a pedido de la revisión; cambia el alcance declarado de la tesis y la sección de
      consideraciones éticas, así que conviene conversarlo antes de redactar.
- [ ] **Corregir `metodologia.tex`**: la frase que dice que el QR dinámico "no constituye una prueba
      criptográfica de clave pública" ya no describe el prototipo. Ahora hay firma Ed25519 del
      emisor y del dispositivo; lo que sigue siendo cierto es que **no es firma electrónica con
      valor legal** (`security-guarantees.md §2.4`).
- [ ] **Traer la versión vigente del proyecto LaTeX**: el zip del escritorio
      (`Título_de_la_Memoria_Tesis.zip`) está desactualizado (falta `sec:qr-dinamico`). Releer
      `estado_del_arte.tex` antes de integrar la tabla comparativa, para no duplicar ni contradecir.
- [ ] **Conseguir fuentes citables** para los hechos que siguen siendo observación propia:
  - **Prioritario:** la app real de Identificación Digital muestra sobre el QR una foto a color de
    buena calidad (hoy: observación directa del autor). La Res. Ex. 234/2026 dice que las
    fotografías de la cédula digital son **en blanco y negro**, así que hay un conflicto que una
    captura propia (con el RUN tapado) resuelve. Ver el análisis en `attack-experiment.md §4.1`:
    si la app es en blanco y negro, el argumento se fortalece en vez de caerse;
  - **qué devuelve** la consulta de vigencia del carnet. La estructura del QR ya está resuelta
    (ver `threat-model.md §6`: cuatro parámetros, `RUN`, `type`, `serial` y `mrz`, triangulados
    contra el comportamiento del servidor, una biblioteca de terceros y un proveedor forense), y
    la foto láser en blanco y negro ya tiene fuente primaria —Res. Ex. 466/2024 del Registro
    Civil, en el `.bib`—. Lo que falta es la página de resultado, que responde 403 con Cloudflare
    ante peticiones automatizadas: documentarla como captura fechada con metodología explícita;
  - el payload del QR del **carnet nuevo** (desde diciembre de 2024) no tiene lectura publicada.
    Todo lo afirmado describe el formato 2013: no extrapolar al nuevo sin escanear uno.
- [ ] **Pasar las citas por `verificador-citas`** una vez redactadas.

---

## 1. Encuadre (Introducción / Metodología)

**Qué decir:**
- El prototipo es un componente **independiente** del objetivo específico 5 (bosquejo conceptual),
  como ya declara `intro.tex`. Lo demuestra aplicadamente, no lo reemplaza.
- Caso de aplicación: **control de acceso en eventos masivos** (estadios, conciertos), donde hoy se
  lee el QR estático del carnet y se compara la foto a ojo.
- El aporte es de **seguridad**, no de velocidad. La hipótesis es: *el QR dinámico aumenta la
  seguridad sin alargar de forma relevante las filas*.
- El prototipo **simula** la app Identificación Digital (enrolamiento, PIN, QR dinámico) porque sus
  claves e interfaces de verificación no son públicas. No interopera con el sistema real.

**No decir:** que el sistema es más rápido, que reemplaza a la app real o que describe su
funcionamiento interno.

### 1.1 Cómo contar la biometría, el QR oficial y la foto a color

Tres hallazgos de octubre de 2026 se tocan entre sí y es fácil encadenarlos mal. **Van como tres
afirmaciones separadas, sin relación causal entre ellas.** Cada una se defiende sola; encadenadas,
se caen.

**(a) La comparación biométrica se evaluó, se decidió y no se implementó.** ADR-16 la incorpora
como apoyo a la decisión del guardia, con sus invariantes (corre en el dispositivo del guardia, no
persiste imagen ni *embedding*, existe vía de ingreso no biométrica), su costo medido
(`results/biometric-degradation.md`) y su fundamento legal (`ley-21719.md`). La implementación
queda fuera de alcance por tres razones propias: sin detección de ataques de presentación el
comparador es derrotable (A15 en `threat-model.md`), probarlo en serio exige rostros reales con
consentimiento informado porque los retratos de la demo son sintéticos, y el aporte de la tesis es
el QR dinámico y su verificación, no construir un sistema biométrico.

> **El error que hay que evitar.** No escribir «no se implementó biometría *porque* el QR no puede
> llevar la foto». Son dos QR distintos: el que no puede llevarla es el **oficial** (256 bytes); el
> **del prototipo** sí la lleva (846 B a 112×112), y justamente por eso la comparación ahí es
> factible — medida en 92,0 % de TAR. Ese encadenamiento invita a la pregunta «¿y por qué no la
> hizo en su propio prototipo, donde sí tiene la foto?», que no tiene respuesta. Tampoco escribir
> que la biometría «se eliminó»: eso vuelve al ADR-5 que la revisión objetó. Lo correcto es que
> está **diseñada y medida, con la implementación fuera de alcance**.

**(b) El QR oficial no puede llevar la fotografía.** Llamarlo **caracterización externa del
payload**, nunca «ingeniería inversa»: lo que se hizo fue escanear el QR de la cédula digital del
propio autor con un lector genérico y medir el sobre — 344 caracteres, relleno `==`, alfabeto
base64, o sea 256 bytes exactos. **No se decodificó nada**, no se recuperó ningún campo ni se
determinó la estructura. Si se escribe «ingeniería inversa», la primera pregunta de la defensa es
qué se decodificó, y la respuesta honesta es nada. La conclusión se sostiene igual porque se
deriva solo del tamaño: en 256 bytes no cabe un retrato (el del prototipo ocupa ~846 B por sí
solo), así que el verificador oficial depende de otro canal — el Bluetooth con ISO 18013-5 de la
Res. Ex. 234/2026, o una consulta en línea. Que lleve el **hash** de la foto es **hipótesis, no
conclusión** (ver el bloque de corrección del ADR-10 en `architecture.md`). Esto **refuerza** el
aporte del prototipo: es el único de los dos diseños que entrega al guardia una foto autenticada
sin depender de red.

**(c) La foto a color reduce el error humano, y es el argumento más débil de los tres.** Va dentro
de `attack-experiment.md §4.1`, como detalle de apoyo y **no como titular**: se apoya en un estudio
sobre pares de fotografías, no sobre una persona en vivo, y eso está declarado como inferencia. Y
sigue **pendiente de resolver**: la Res. Ex. 234/2026 fija las fotografías de la cédula digital
oficial en blanco y negro, contra la observación directa del autor de que la app muestra color
(ver el bloqueante de §0). Si resulta que la app es en blanco y negro, el color pasa a ser decisión
de diseño propia y el argumento se fortalece.

**El titular, entonces, es otro:** el aporte es haber **diseñado y documentado el lado del
verificador**, que es lo que no existe — sin app verificadora oficial, sin SDK, sin API pública,
sin registro de verificadores y sin *trust framework* (`security-guarantees.md §3`) — y que entrega
una foto autenticada verificable **sin conexión**. El color y la biometría son detalles dentro de
eso, no el eje.

---

## 2. Diseño del prototipo (Metodología, `sec:prototipo`)

**Fuente:** `architecture.md` (diagramas Mermaid y ADR-1 a ADR-17), `README.md`.

Incluir:
1. **Modelo de tres actores** (emisor–titular–verificador, como en credenciales verificables):
   Registro Civil simulado, teléfono del ciudadano, lector del guardia, más el backend del recinto.
   Diagrama de secuencia de `architecture.md §1–§4`.
2. **La cédula digital** (ADR-10, ADR-13): nombre, RUN, foto y clave pública del teléfono, firmados
   con Ed25519 por el emisor. Es de la persona y sirve ante cualquier lector autorizado; el recinto
   solo tiene la lista de RUT con entrada.
3. **El QR dinámico** (ADR-11): lo genera el teléfono sin conexión cada 45 s, lo firma con la clave
   del dispositivo y lo cifra para los lectores autorizados (X25519 + HKDF-SHA256 +
   ChaCha20-Poly1305, codificado en base45). Trae la foto; el emisor firma su hash SHA-256.
4. **Verificación en dos pasos** (ADR-12): el lector verifica firmas localmente y muestra la foto
   firmada **en el dispositivo del guardia**; el servidor revisa uso único, entrada, prohibiciones y
   revocación sin recibir la foto; el guardia confirma o rechaza.
5. **Revocación** (ADR-14) y **operación sin conexión** (ADR-15).
6. **Controles de seguridad de la aplicación** (OWASP Top 10): tabla de
   `security-guarantees.md §1b`, en una frase o en un anexo.

Tabla sugerida: resumen de los ADR (número, decisión, razón) a partir de `architecture.md`.

---

## 3. Decisión de diseño: vigencia de 45 s

**Fuente:** `ttl-justification.md`. Incluir la derivación completa: piso de usabilidad (ajustado
por arquetipos de la encuesta) y techo de exposición a *replay*, anclado en RFC 6238. Es una
subsección corta y muy defendible ante el jurado.

---

## 4. Modelo de amenazas (Resultados)

**Fuente:** `threat-model.md`.

- Tabla de actores y ataques **A1–A15**, con mitigación y riesgo residual, y lo que queda **fuera
  de alcance**.
- **Tabla central de resultados: QR estático del carnet vs. QR dinámico** (`§6`). Es la pieza que
  mejor muestra el aporte. Incluye las filas nuevas "QR adulterado" y "Calidad de la foto de
  referencia".
- Mensaje de fondo: el QR estático prueba que *existe un documento vigente*; el dinámico prueba que
  *quien lo muestra controla ahora la credencial* y trae la foto firmada de su titular.

---

## 5. Experimento de ataque (Resultados)

**Fuente:** `attack-experiment.md` (resultados en `results/attack-experiment.*`, reproducible con
`backend/scripts/attack_experiment.py`).

| Nivel | QR estático (carnet) | QR dinámico |
|---|---|---|
| Validación automática | 4 de 5 ataques pasan | 1 de 5 (reenvío en tiempo real) |
| Con comparación correcta de la foto | 4 de 5 | 0 de 5 |
| Filtro de prohibiciones (automático / con foto) | 2 de 2 / 1 de 2 | 1 de 2 / 0 de 2 |

**Cómo presentarlo (importante):**
- El nivel "con comparación correcta de la foto" es un **límite superior**, no el resultado
  esperado. Respaldarlo con `attack-experiment.md §4.1` y `referencias-comparacion-rostros.bib`.
- Frases clave con cita:
  - oficiales de pasaportes aceptaron un 14 % de fotos fraudulentas, sin relación con su
    experiencia (White et al., 2014);
  - comparar una persona en vivo con una foto ronda el 85 % de acierto (Megreya y Burton, 2008);
  - los impostores poco frecuentes se omiten más (Papesh y Goldinger, 2014);
  - las fotos antiguas y de baja resolución empeoran el acierto (Megreya et al., 2013; Bindemann
    et al., 2013).
- La conclusión no cambia de signo: aun con una comparación imperfecta, el QR dinámico elimina las
  copias y obliga a un impostor **parecido** y coordinado en tiempo real.

---

## 6. Costo en la fila (Resultados, breve)

**Fuente:** `queue-model.md`. Solo lo necesario para sostener la hipótesis; no es el foco.
- La validación en línea suma ~24 ms por persona y +3 % de espera en la punta; el servidor opera al
  17 % de su capacidad; 0 dobles concesiones bajo carga.
- La fila de cédula digital es más corta por ser **preferente** para una minoría (incentivo a la
  adopción), no por un trámite más rápido.
- Declarar que el tiempo humano de servicio (8 s) y la tasa de llegadas son supuestos.

---

## 7. Discusión

**Por qué la foto de la cédula digital ayuda al guardia** (`attack-experiment.md §4.1`):
1. **Es auténtica**: en un carnet falso la foto la controla el falsificador; con la foto firmada, el
   atacante tiene que parecerse al titular.
2. **Es a color**: la del carnet va grabada en blanco y negro (La Tercera), y comparar una foto gris
   con una persona vista a color sesga hacia aceptar al impostor (Bobak, Mileva y Hancock, 2019). El
   color ayuda más en imágenes pequeñas (Yip y Sinha, 2002). *Matiz:* Bobak et al. usaron pares de
   fotos, no una persona en vivo.
3. **Se ve en el dispositivo del guardia**: una foto en la pantalla del titular no prueba nada por
   sí sola (una app falsa o un video pueden mostrar cualquier foto). En el prototipo, la foto que
   cuenta es la que el lector del guardia descifra del QR firmado. **Es un aporte de diseño de esta
   tesis, y ahora hay evidencia propia de que la app oficial no lo hace así**: su QR mide 256
   bytes, donde no cabe una fotografía (la del prototipo ocupa ~846 B sola, más del triple), así que su verificador
   necesita otro canal. Ver `architecture.md` ADR-10 para la medición y sus salvedades.

**Debilidades del QR del carnet** (`threat-model.md §6`): es fijo (una foto o fotocopia sirve), no
va firmado (se puede adulterar o apuntar a un sitio falso), no trae la foto y filtra la fecha de
nacimiento en el parámetro `mrz`. **Cuidado al redactar:** el carnet sí tiene criptografía, en el
chip (ICAO-eMTRD, firma electrónica avanzada, *Match on Card*, por Res. Ex. 466/2024); lo que no
va firmado es el QR, y aprovechar el chip en una puerta exigiría NFC y el PKD de ICAO. Afirmar que
el documento carece de criptografía sería atacable en la defensa. Y la fila "QR adulterado" es una
inferencia: no hay incidente documentado sobre el QR, el precedente real es la adulteración del
PDF417 de las cédulas antiguas (2016).

**Comparación internacional**: tabla de `security-guarantees.md §3` (Colombia, Uruguay/Perú,
ISO/IEC 18013-5, RFC 6238 y la app chilena según información pública). Reutilizable casi tal cual,
revisando que no contradiga `estado_del_arte.tex`.

**Aplicabilidad a otros dominios** (opcional): control de acceso en faenas mineras, donde calzan la
operación sin conexión, la credencial ligada a la persona y la revocación al desvincular.

---

## 8. Limitaciones (Discusión o Conclusiones)

**Fuente:** `security-guarantees.md §2` (declaradas explícitamente para no inflar garantías).
- **Emisor simulado**: una sola clave, sin certificados X.509 ni cadena de confianza.
- **Enrolamiento**: la clave de activación reemplaza a ClaveÚnica + verificación facial con prueba
  de vida. Declararlo como sustituto simulado.
- **Sin biometría automática todavía**: el guardia compara la foto y puede equivocarse (ver §5).
  ADR-16 la decide como apoyo local a su decisión, sin guardar imagen ni plantilla, con la medición
  ya hecha (ver abajo) pero **sin implementar**. Declararlo como trabajo en curso, no como
  propiedad del prototipo.
- **Sin conexión**: el doble ingreso por dos puertas sin red se detecta al sincronizar, no se evita.
- **Almacenamiento**: la cédula y la clave del teléfono van cifradas con PIN en el navegador, no en
  un almacén seguro de hardware.
- **Despliegue**: TLS, límites de intentos en memoria de un proceso, registro de seguridad sin
  centralizar, sin MFA para el personal.
- **Sin validez legal**: no es firma electrónica ni aporta no repudio.

**No decir:** que el QR de la app real trae la foto firmada, que la foto de la app real se ve en el
lector del guardia, ni cualquier propiedad interna de la app real sin fuente oficial.

---

## 9. Trabajo futuro (Conclusiones)

- **Piloto real** en un evento: medir si el guardia detecta impostores con la foto firmada frente al
  carnet (calidad de la verificación, no tiempo).
- **Mejorar la comparación humana**: seleccionar guardias por aptitud (Robertson et al., 2016;
  White et al., 2014) o apoyarlos con un algoritmo (Phillips et al., 2018).
- **Doble ingreso sin red**: sincronizar lectores por red local o asignar RUT a puertas.
- **Integración oficial**: una interfaz pública de verificación del Registro Civil, en línea con la
  recomendación de política pública de `conclu.tex`.
- **Credenciales estándar**: migrar el formato a ISO/IEC 18013-5 (mdoc) o credenciales verificables.

---

## 10. Anexos sugeridos

- **Trazabilidad arquetipos → interfaz** (tabla del `README.md`): cómo el prototipo responde a las
  recomendaciones del Anexo A.2 (encuesta n=338). Incluir la brecha declarada del "Joven
  desconectado".
- **Capturas** de la app del ciudadano y del escáner (enrolamiento, PIN, QR, "¿Es la persona que
  tienes al frente?", cédula revocada, modo sin conexión).
- **Verificación del software**: 155 tests automáticos (106 backend + 49 frontend; lista en `HANDOFF.md §6`), vectores de
  prueba compartidos entre Python y TypeScript, y análisis con `pip-audit`, `npm audit` y `bandit`.
- **Repositorio y reproducibilidad**: enlace al repositorio y cómo levantar la demo
  (`uv run demo.py`, `README.md`).

---

## Fuentes en este repositorio

| Para | Documento |
|---|---|
| Arquitectura, diagramas y decisiones | `architecture.md` |
| Vigencia de 45 s | `ttl-justification.md` |
| Amenazas y comparación con el carnet | `threat-model.md` |
| Garantías, límites, OWASP y comparación internacional | `security-guarantees.md` |
| Experimento de ataque y literatura sobre comparación de rostros | `attack-experiment.md` |
| Prueba de carga y modelo de colas | `queue-model.md` |
| **Costo biométrico de meter la foto en el QR** (resultado propio, ADR-16) | `results/biometric-degradation.md`, reproducible con `backend/scripts/biometric_degradation.py` |
| Protección de datos personales (Ley 21.719) y biometría | `ley-21719.md` |
| Resultados generados por los scripts | `results/` |
| Bibliografía verificada (BibTeX) | `referencias-comparacion-rostros.bib` |
