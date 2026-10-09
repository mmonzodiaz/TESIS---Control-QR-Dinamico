# Modelo de amenazas — Prototipo de verificación por QR dinámico

> Documento de rigor técnico para el componente "Prototipo de verificación por código QR dinámico"
> (ver `metodologia.tex §Prototipo de verificación`, `sec:prototipo`). Se aplica exclusivamente al
> sistema implementado en este repositorio (`control-acceso-simple`), no a la app oficial
> "Identificación Digital" del Registro Civil de Chile ni a ningún sistema del Estado: sus claves
> de verificación no son públicas y este trabajo no intenta interoperar con ellas
> (`intro.tex`, líneas 129–138).

## 1. Alcance del sistema

El sistema autoriza un **evento puntual de acceso físico** a un recinto (ingreso por portería),
no emite ni certifica una identidad legal. El activo que protege es "¿esta persona tiene, en este
momento, autorización vigente para ingresar?", no "¿quién es esta persona, con validez jurídica?".
Esta distinción es la base de todo el análisis: los requisitos de seguridad de una credencial de
identidad nacional (equivalencia legal, no repudio, verificación offline) son órdenes de magnitud
más exigentes que los de un pase de acceso de un solo uso, y este prototipo se diseña y evalúa
para lo segundo. La Sección 4 de `docs/security-guarantees.md` deja explícito que no se debe leer
este sistema como un sustituto de una credencial de identidad.

## 2. Activos

| Activo | Descripción | Ubicación en el código |
|---|---|---|
| QR vigente | Autoriza un único ingreso mientras no expire ni se use su nonce | `credential.py::build_qr`, `QRUse` (`backend/app/models.py`) |
| Cédula digital (core firmado + foto) | Identidad que el guardia ve al escanear; la firma el Registro Civil. Es de la persona, no de un evento (ADR-13) | Teléfono del titular, cifrada con su PIN (`frontend/src/wallet.ts`); el recinto nunca recibe la foto |
| Clave del dispositivo (Ed25519) | Liga cada QR al teléfono donde se enroló la cédula; su pública va firmada dentro de la cédula | Teléfono, cifrada con el PIN |
| Clave privada de lectores autorizados (X25519) | Permite leer los QR de cédula (foto, nombre, RUT) | La entrega el Registro Civil; el recinto la pasa a sus escáneres (`GET /events/{id}/verifier`) |
| Lista de entradas nominativas | Qué RUT pueden entrar a cada evento | Backend del recinto (`Ticket`) |
| Lista de cédulas revocadas | Qué emisiones de la cédula ya no valen (solo hashes, firmada por el emisor, ADR-14) | Registro Civil (`GET /revocaciones`); caché en el backend (`app/revocation.py`) |
| Copia de contingencia | RUT con entrada, ya admitidos, con prohibición y cédulas revocadas, para operar sin red (ADR-15) | Memoria del escáner (`GET /events/{id}/contingencia`) |
| Decisiones pendientes sin red | QR leídos sin la foto y lo que decidió el guardia, hasta sincronizarlos | `localStorage` del escáner (`frontend/src/offline.ts`) |
| Sesión JWT | Autentica al usuario ante la API | `security.py::create_access_token` |
| Registro de auditoría | Evidencia de cada intento de acceso, concedido o no | `AccessLog` (`backend/app/models.py`) |
| Asignación de rol | Determina si alguien puede generar QR (cualquiera) o validar QR (guard/admin) | `Role` enum + `deps.py::require_roles` |

## 3. Actores y ataques considerados (dentro de alcance)

| # | Actor / capacidad asumida | Ataque | Mitigación implementada | Riesgo residual explícito |
|---|---|---|---|---|
| A1 | Observador oportunista que fotografía o captura de pantalla el QR mostrado por el titular. *No es hipotético: en mayo de 2025 se recuperó el QR del carnet desde el pantallazo de un reportaje de televisión y se usó para consultar datos de una persona real (§6)* | **Replay**: reutiliza la imagen capturada más tarde para ingresar en lugar del titular | Uso único por nonce (`QRUse`, `routers/qr.py::validate_qr`) + vigencia corta firmada por el dispositivo (`QR_TTL_SECONDS`, justificada en `docs/ttl-justification.md`). Además, el QR va cifrado: el observador no puede leer foto, nombre ni RUT (ADR-11) | Si el atacante escanea **antes** que el titular dentro de la ventana de TTL (reenvío en tiempo real a un cómplice), el sistema acepta el QR. Pero el escáner muestra la **foto firmada del titular**, no la del cómplice, y el ingreso no se registra hasta que el guardia confirma (ADR-10, ADR-12): si rechaza, el titular todavía puede entrar. El riesgo residual es el error humano al comparar rostros. |
| A2 | Atacante en la red (on-path) entre el navegador y el backend | Intercepta la sesión o las consultas a la API | **Parcial.** El QR mismo va cifrado de extremo a extremo hacia el escáner (ADR-11) y la consulta en línea no lleva la foto. El resto de la API (login, JWT, claves del escáner en `GET /events/{id}/verifier`) depende de TLS, que es un requisito de despliegue; el entorno de desarrollo corre en HTTP plano | Sin TLS, un atacante en la red podría robar sesiones y la clave privada del evento que recibe el escáner. Se declara como **requisito no negociable de despliegue**. |
| A3 | Verificador (portero) cuya sesión JWT es robada o reutilizada | Valida tokens ajenos fabricando entradas de acceso falsas en el log | El log asocia `scanned_by_id` a cada evento (`AccessLog`); no hay endpoint para editar o borrar `AccessLog` desde la API. Por la vía sin conexión (`/qr/sync`) tampoco puede usar un QR fotografiado hace tiempo declarando una hora de escaneo antigua: el servidor solo cree esa hora dentro de la vigencia de la copia de contingencia sellada o del `check` en línea previo (ADR-15), así que la sesión robada no da más sin red que en línea | Alguien con acceso directo a la base de datos (fuera de la API) sí podría alterar el historial — esto es un problema de gobernanza de infraestructura, fuera del alcance de este control de aplicación. |
| A4 | Persona que se presenta como "portero" ante el titular sin serlo, y le pide mostrar/escanear el QR con un dispositivo no autorizado | **Suplantación del verificador**: el titular no tiene forma de confirmar que el dispositivo que escanea es el oficial del recinto | Ninguna. El backend autentica al verificador *ante sí mismo* (JWT con rol `guard`/`admin`), pero el titular no tiene ningún canal para autenticar al verificador *ante él* | Riesgo residual explícito y no mitigado. Es una limitación estructural de los esquemas QR "mostrar y escanear" sin canal de confianza mutuo (p. ej. verificación visual de una credencial física del guardia, fuera del alcance de este prototipo de software). |
| A5 | Falsificación de un QR sin poseer uno legítimo | Fabricar un QR válido para otra persona | Un QR válido exige la firma del emisor sobre la cédula y la firma del teléfono cuya clave está dentro de ella; el lector y el servidor verifican ambas (`credential.py::check_signatures`). Adivinarlas es computacionalmente inviable | Sin riesgo criptográfico relevante. Para el abuso automatizado hay límite de intentos: 120 validaciones/min por guardia en `POST /qr/validate` y `/qr/sync`, y 5 logins/min por cuenta y 30 por IP en `POST /auth/login` (`app/ratelimit.py`). Es en memoria de un solo proceso (`security-guarantees.md §2.6`). |
| A6 | Reutilización de un QR vencido | Presentar un QR cuya hora firmada ya salió de la ventana | La hora va firmada por el dispositivo; el servidor la compara con su propio reloj en cada validación (TTL + 5 s de tolerancia) y rechaza además los QR fechados en el futuro | Quien controla el teléfono del titular puede fechar un QR como quiera dentro de la tolerancia; no gana más que eso. |
| A7 | Tercero que conoce el RUT del titular (dato semi-público) | **Suplantación por dato público**: obtener la cédula digital de otra persona ingresando solo su RUT | El enrolamiento exige RUT + clave de activación (simula la ClaveÚnica); el Registro Civil responde un 401 idéntico ante cualquier fallo y tiene rate limit por IP (10/min, compartido con `POST /reportar-perdida`, `registro_civil/app.py`) | El rate limit es en memoria y por IP; en producción el control es el de la ClaveÚnica real. Conocer el RUT ya no sirve de nada en la puerta: lo que se verifica es la firma de la cédula y del teléfono. |
| A8 | Quien copia la cédula del teléfono del titular (archivo o almacenamiento) | Usarla desde otro teléfono | La clave pública del teléfono va firmada dentro de la cédula: un QR firmado con otra clave es `invalid`, en el lector (sin red) y en el servidor. La cédula y la clave están cifradas con el PIN | Si además obtiene la clave del teléfono (malware, o probando los 10^6 PIN sobre una copia del almacenamiento), sus QR muestran la foto del titular: lo delata la comparación de la foto (ADR-10). Si el titular sospecha, puede revocar la cédula reportando la pérdida o activándola de nuevo en su teléfono (ADR-14). |
| A9 | Asistente ya ingresado | **Pass-back**: genera un QR nuevo y se lo pasa a alguien fuera del recinto | El teléfono puede generar QR sin conexión, pero el servidor rechaza cualquier QR de una entrada ya admitida (`Ticket.admitted_at`, `already_admitted`) y el `INSERT` del nonce impide que dos filas concedan el mismo QR (ADR-8) | Ninguno relevante con la consulta en línea. Sin red, el escáner sabe quién ya ingresó según su copia de contingencia y lo que él mismo registró, pero no los ingresos por otras puertas durante la caída (A13). |
| A10 | Persona con **prohibición de ingreso** (p. ej. hincha sancionado, derecho de admisión) | **Evasión del filtro**: entra presentando la credencial de un tercero sin prohibición, porque el filtro revisa el RUT de la credencial presentada, no el de la persona | Lista de prohibición revisada en la puerta en cada escaneo, sin consumir el QR ni registrar ingreso (`routers/bans.py`, `qr.py::validate_qr`). La credencial dinámica no se puede copiar de antemano (A1, A6). Si un tercero coopera en tiempo real, el escáner muestra **la foto firmada del tercero**, no la del sancionado (ADR-10) | La evasión con cooperación pasa la validación automática; la detiene la comparación visual de la foto. El riesgo residual es el error humano al comparar rostros, sobre todo si el sancionado se parece al tercero. |
| A11 | Falsificador de cédulas | **Cédula falsa o foto cambiada**: fabrica una cédula con su foto y el RUT de otro, o cambia la foto de una cédula real | La firma Ed25519 del emisor cubre RUT, nombre y hash de la foto. El escáner rechaza una firma inválida o una foto que no calza con su hash; el backend verifica la firma en cada validación (`credential.py::check_qr`, `check_signatures`) | Ninguno dentro del modelo, mientras la clave privada del emisor no se filtre (fuera de alcance: compromiso del Registro Civil). |
| A12 | Quien obtiene un escáner del personal o su sesión | Lee QR de cédula con la clave privada de lectores | La clave solo se entrega a personal autenticado (`GET /events/{id}/verifier`) | Es una sola clave para todos los lectores: puede **leer** foto, nombre y RUT de cualquier QR de cédula que vea (privacidad), pero no **fabricar** QR: le faltan la clave del teléfono y la firma del emisor. En producción habría claves por lector y rotación. **Si ADR-16 se implementa en su variante (B)**, plantilla biométrica firmada dentro del core, este lector robado leería además esa plantilla: exposición peor que la foto misma, y un costo que peso en descartar (B). |
| A13 | Quien aprovecha una caída de la red del recinto (o la provoca, p. ej. con un inhibidor) | **Doble ingreso sin conexión**: entra por una puerta y, con otro QR de la misma cédula (o un cómplice con un QR reenviado), por otra puerta que tampoco tiene red | Contingencia (ADR-15): cada escáner decide con una copia de hasta 10 min (revocadas, prohibiciones, entradas, ya admitidos) y recuerda lo que él mismo admitió; sin copia vigente no deja pasar a nadie. Al volver la red, `POST /qr/sync` reverifica cada decisión y marca como **alerta** lo que el servidor no habría permitido (`already_admitted`, `banned`, `revoked`, `expired`, `invalid`) | No se evita, solo se detecta después, cuando la persona ya entró. Tampoco aplican las prohibiciones ni revocaciones posteriores a la última copia. La foto firmada sigue delatando al cómplice. |
| A14 | Quien roba o encuentra el teléfono del titular | Usar la cédula del titular | La cédula y la clave del dispositivo están cifradas con el PIN (5 fallos bloquean 60 s); el QR muestra la foto del titular. El titular la revoca desde otro dispositivo (`POST /reportar-perdida`) o activándola en un teléfono nuevo, y el recinto rechaza con `revoked` (ADR-14) | La revocación tarda hasta 30 s en línea y hasta ~70 s en un escáner sin red; si el Registro Civil no responde, el recinto usa la última lista válida. El límite de intentos de PIN lo aplica la página, no el hardware (A8). |
| A15 | Quien presenta la credencial de un tercero cooperador (A10) o reenviada en tiempo real (A1), y dispone de una fotografía del rostro del titular | **Ataque de presentación** (*spoofing*): muestra a la cámara del escáner una foto impresa, una pantalla o un video del titular legítimo para que el comparador biométrico de ADR-16 lo califique como coincidencia | **Ninguna automática.** ADR-16 no implementa detección de ataques de presentación (ISO/IEC 30107-3). La mitigación es estructural y deliberada: el guardia está presente mirando a la persona, y el puntaje es apoyo a su decisión, no un veredicto que la reemplace | Riesgo residual explícito. Un comparador sin prueba de vida lo derrota cualquiera que consiga una foto del titular, que en redes sociales suele ser trivial. De ahí la restricción de ADR-16 de no presentar la biometría como barrera independiente: **sin el guardia mirando, este ataque transforma el refuerzo en un falso sentido de seguridad**, porque el sistema afirmaría una coincidencia que no ocurrió. Mientras ADR-16 no esté implementado el ataque no aplica: no hay comparador que engañar, y la fila corresponde al diseño decidido, no al código actual. |

## 4. Explícitamente fuera de alcance

Se excluyen deliberadamente del análisis y del diseño, y se declaran así para no generar una
falsa sensación de cobertura:

- **Malware o compromiso del dispositivo del titular** (p. ej. captura de pantalla automatizada
  por una app maliciosa instalada en el teléfono del residente).
- **Compromiso del servidor o la infraestructura backend** (se asume el backend como raíz de
  confianza; comprometerlo invalida cualquier garantía del sistema).
- **Coacción física** (obligar a alguien a mostrar su QR bajo amenaza).
- **Denegación de servicio** contra la API.
- **Canales laterales** (timing attacks, análisis de tráfico cifrado, etc.).
- **Suplantación biométrica automática**: no aplica **al código actual**, que no hace reconocimiento
  facial: la foto firmada la compara una persona y sus errores se declaran como riesgo residual
  (A1, A10). Deja de estar fuera de alcance cuando se implemente ADR-16: habrá un comparador que
  engañar, y el ataque de presentación —mostrarle a la cámara una foto del titular legítimo— pasa a
  ser una amenaza que hay que modelar, con la presencia del guardia como única mitigación prevista
  (sin prueba de vida, ISO/IEC 30107-3). Ver `security-guarantees.md §4`.
- **Extracción de la clave del dispositivo** por malware: en el prototipo vive en `localStorage`,
  cifrada con el PIN; en una cédula real iría en el almacén seguro del teléfono. Quien copie ese
  almacenamiento podría probar los 10^6 PIN fuera de la página: el bloqueo por intentos solo rige
  dentro de la app.
- **Compromiso de la clave privada del Registro Civil**: invalidaría la autenticidad de todas las
  cédulas; es un problema del emisor, no de este sistema.
- **Phishing de las credenciales de login** (email/contraseña): es un problema de autenticación
  general, no específico del mecanismo de QR dinámico que es objeto de este análisis.

## 5. Marco de referencia

El formato de tabla actor→ataque→mitigación→riesgo residual sigue la lógica de modelado de
amenazas centrado en adversarios de OWASP Threat Modeling y los conceptos de niveles de garantía
de autenticador de NIST SP 800-63B, usados aquí como marco analítico, no como certificación
regulatoria (Chile no es jurisdicción NIST).

## 6. Comparación con el QR estático del carnet físico (control actual en eventos)

Hoy, en eventos masivos, la identidad se verifica leyendo el QR impreso en la cédula física y
comparando visualmente la foto de la tarjeta con la persona. Ese QR contiene una **URL de consulta
de vigencia** del Registro Civil con cuatro parámetros:

```
https://portal.sidiv.registrocivil.cl/docstatus?RUN=<RUN-DV>&type=CEDULA&serial=<n° documento>&mrz=<serie+DV+AAMMDD nacimiento+DV+AAMMDD vencimiento+DV>
```

**Ninguna fuente oficial especifica ese contenido:** la Resolución Exenta 466 de 2024 del Registro
Civil lista el «código de respuesta rápida (código QR)» como ítem de la zona de datos opcionales
del reverso y no describe qué encode. La estructura se establece por triangulación de tres
evidencias independientes: el servidor del Registro Civil responde `301` preservando exactamente
esos cuatro parámetros hacia `portal.nuevosidiv.registrocivil.cl/document-validity`; una
biblioteca independiente de terceros lleva el host de `docstatus` y el parseo de los cuatro
parámetros escritos en su código; y un proveedor forense describe el mismo contenido. Lo descrito
corresponde al **formato 2013** (Res. Ex. 861/2013): el payload del QR del formato nuevo, vigente
desde diciembre de 2024, no tiene ninguna lectura publicada y afirmar algo de él sería
extrapolación.

De ahí se siguen cuatro propiedades:
- su contenido es **fijo** durante toda la vida del documento, así que una foto, fotocopia o
  captura del QR se lee igual que el original;
- **no va firmado**: es texto que cualquiera puede generar o alterar, por ejemplo para apuntar a
  otro documento vigente o a un sitio que imite la consulta;
- **no trae la foto**: la foto contra la que se compara es la impresa en la tarjeta, que en un
  carnet falsificado controla el falsificador. Esa foto va grabada con láser en **blanco y negro**
  —Res. Ex. 466/2024, textual: *«Fotografía principal en blanco y negro grabada mediante
  láser»*—, lo que empeora la comparación humana frente a una foto a color (ver
  `attack-experiment.md §4.1`). La misma resolución describe una segunda fotografía SLI reducida
  con el año de nacimiento integrado en la imagen;
- **filtra más datos de los necesarios para consultar vigencia**: el parámetro `mrz` replica la
  línea media de la MRZ, así que quien fotografíe el QR en la fila obtiene además la **fecha de
  nacimiento** y la de vencimiento. El QR dinámico va cifrado para lectores autorizados (ADR-11),
  así que no expone nada a terceros.

**Precisión necesaria para no exagerar el contraste:** el carnet físico **sí** tiene criptografía,
pero no en el QR. La Res. Ex. 466/2024 describe un chip con capacidad criptográfica (ISO 14443 tipo
A y B) con aplicación de viaje ICAO-eMTRD —control de acceso básico y extendido, autenticación
pasiva y activa—, identidad con firma electrónica avanzada, y *Match on Card* con huellas y
reconocimiento facial. Lo que falta es practicable, no teórico: aprovechar eso en la puerta de un
estadio exige lectura NFC y validación contra el *Public Key Directory* de ICAO, no un escaneo de
cámara. El argumento correcto es que **el QR no lleva firma**, no que el documento carezca de
criptografía.

*(Para la tesis: la página de resultado de la consulta no se pudo observar —responde 403 con
Cloudflare ante peticiones automatizadas—, así que qué devuelve exactamente sigue siendo
observación directa del autor; documentarla como captura fechada con metodología explícita.)*

La diferencia de fondo es qué prueba cada lectura:
- **QR estático:** prueba que *existe un documento vigente con ese número de serie*.
- **QR dinámico (este prototipo):** prueba que *quien lo muestra controla, en este momento, la credencial activada
  en su dispositivo*, y trae la foto firmada de su titular para compararla con la persona.

| Ataque | QR estático del carnet físico + verificación visual | QR dinámico (este prototipo) |
|---|---|---|
| **Copia del QR** (foto, fotocopia, captura) y reutilización posterior | **Funciona, y está documentado.** La copia se lee igual que el original: el QR no cambia ni se consume. En mayo de 2025, con el lanzamiento de los pagos con cédula, se recuperó un QR desde el **pantallazo de un reportaje de televisión** y con él se consultaron saldo y movimientos de una beneficiaria real; dos académicos lo validaron en prensa. El mismo hallazgo mostró que con RUN, fecha de nacimiento, vencimiento y serie se puede **regenerar** el QR sin tener el carnet | **No funciona.** Expira en 45 s y se consume al primer escaneo (A1, A6) |
| **Carnet falsificado con el QR clonado de uno real** | **La lectura del QR pasa** (el documento clonado existe y está vigente). Solo queda la verificación visual del guardia, contra una foto que el falsificador controla | **No funciona.** Una cédula con otra foto o datos no tiene firma válida del emisor (A11) y un QR sin la clave del dispositivo es `invalid` (A5, A8) |
| **Cambio de foto** en una tarjeta real (robada o prestada) | La lectura del QR pasa. La detección depende de que el guardia note la adulteración | **No funciona.** La foto va firmada dentro del QR; cambiarla rompe la firma (A11) |
| **QR adulterado** (reemplazado por otro que apunta a un documento vigente ajeno o a un sitio que imita la consulta) | **Puede funcionar.** El QR no va firmado; el guardia ve una página de "vigente" y solo le queda la foto impresa. *Inferencia, no incidente documentado: no se halló ningún reporte de un QR de carnet adulterado. El precedente empírico es sobre el otro código del documento —el PDF417 de las cédulas 2002-2012—, donde se aisló y sustituyó el segmento de la huella dactilar conservando los datos de la víctima (caso investigado por la PDI, 2016). Misma clase de ataque: un campo legible por máquina sin firma verificable sí fue manipulado en la práctica.* | **No funciona.** Cualquier cambio en el QR rompe la firma del emisor o el cifrado; el lector lo rechaza como `invalid` (A5, A11) |
| **Calidad de la foto de referencia** | Grabada en blanco y negro: comparación mixta con una persona vista a color, que sesga hacia aceptar al impostor (Bobak et al., 2019) | A color y firmada: comparación entre imágenes congruentes. Sigue siendo una foto pequeña (112×112 px en el prototipo) y el guardia puede equivocarse (`attack-experiment.md §4.1`) |
| **Uso de un documento ajeno** (prestado, robado) por alguien parecido | Pasa si el guardia no nota la diferencia | Requiere además el dispositivo desbloqueado con la entrada activada (A8). La comparación visual es contra la foto firmada, igual de exigente para el guardia |
| **Varias personas con copias del mismo documento** | Todas pasan la lectura del QR | Una sola: admisión única por entrada (A9) y consumo atómico (ADR-8) |
| **Persona con prohibición de ingreso usa la copia del QR de un tercero** (hincha sancionado) | **Funciona.** El filtro revisa el RUT del tercero, que no tiene prohibición; la verificación visual compara contra la foto del carnet falso | **No funciona.** La copia expiró; el sancionado necesitaría la cooperación del tercero en tiempo real (A10) |
| **Persona con prohibición de ingreso usa la credencial prestada por un tercero que coopera** | Pasa la lectura; la foto del carnet prestado es la del tercero (si no usa uno falso, ver fila anterior) | Pasa la validación automática, pero el escáner muestra **la foto firmada del tercero** y el tercero pierde su ingreso (A9, A10). Lo detiene una comparación visual correcta |
| **Reenvío en tiempo real** del QR a un cómplice en la puerta (*relay*) | No aplica (no hace falta: basta una copia) | Pasa la validación automática si el cómplice escanea antes que el titular, pero el escáner muestra **la foto del titular**. Si el guardia lo rechaza, la entrada no se consume y el titular entra después (A1, ADR-12) |
| **Robo o pérdida** | Hay que bloquear el documento; mientras tanto, el QR sigue leyéndose | La cédula está cifrada con el PIN y el QR del ladrón muestra la foto del titular. El titular la revoca desde otro dispositivo o activándola en un teléfono nuevo, y los lectores la rechazan en alrededor de un minuto (A14, ADR-14) |
| **Caída de la red en el recinto** | La lectura se degrada a solo verificación visual | El escáner sigue verificando **localmente** cédula, foto y vigencia (ADR-11) y, con su copia de contingencia, revocación, entrada, prohibiciones y ingresos previos. Sin copia reciente deriva a la fila normal. El doble ingreso por dos puertas sin red se detecta al sincronizar, no se evita (A13, ADR-15) |
| **Costo en la fila** | Línea base | +24 ms por persona en condiciones realistas, +3 % de espera en la punta (`queue-model.md`) |

**Verificación empírica:** [`attack-experiment.md`](attack-experiment.md) ejecuta estos ataques contra ambos modos sobre el backend real. En la validación automática, el QR estático cae en 4 de 5 ataques y el dinámico en 1 de 5 (solo el reenvío en tiempo real). Si además el guardia compara bien la foto, el estático sigue cayendo en 4 de 5 (el carnet falso lleva la foto del atacante) y el dinámico en 0 de 5. Para el filtro de personas con prohibición de ingreso: con el carnet, 2 de 2 evasiones pasan la lectura y 1 de 2 sobrevive a la comparación de la foto; con el QR dinámico, 1 de 2 y 0 de 2.

**Lectura para la tesis.** El QR dinámico elimina la clase de ataques más barata contra el carnet
físico: **copiar o clonar un QR estático**. El atacante ya no puede prepararse de antemano, tiene
que actuar en tiempo real (*relay*) y necesita un cómplice coordinado. Y como el QR trae la foto
firmada del titular, ese cómplice queda frente a un guardia que ve una cara que no es la suya.
La verificación visual sigue siendo el eslabón que vincula la credencial con la persona física en
ambos esquemas, pero en el dinámico la foto contra la que se compara es auténtica, no la que el
falsificador imprimió. En el código actual, sin biometría automática, el límite es el error humano
al comparar rostros; ADR-16 decide atacar ese límite con un comparador local que apoya al guardia,
ya medido: la compresión para el QR cuesta 7,5 puntos de TAR y la foto quedó en 112×112 para
recuperar 5,2 de ellos (`results/biometric-degradation.md`).
