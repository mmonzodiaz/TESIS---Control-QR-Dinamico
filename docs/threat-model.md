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
| Cédula digital (core firmado + foto) | Identidad que el guardia ve al escanear; la firma el Registro Civil | Teléfono del titular (`frontend/src/wallet.ts`); el backend del evento nunca recibe la foto |
| Clave del dispositivo (Ed25519) | Liga cada QR al teléfono donde se activó la entrada | Teléfono; el backend guarda solo la pública (`Ticket.device_public_key`) |
| Clave privada del evento (X25519) | Permite leer los QR del evento (foto, nombre, RUT) | Backend (`Event.qr_private_key`) y escáneres del personal (`GET /events/{id}/verifier`) |
| Sesión JWT | Autentica al usuario ante la API | `security.py::create_access_token` |
| Registro de auditoría | Evidencia de cada intento de acceso, concedido o no | `AccessLog` (`backend/app/models.py`) |
| Asignación de rol | Determina si alguien puede generar QR (cualquiera) o validar QR (guard/admin) | `Role` enum + `deps.py::require_roles` |

## 3. Actores y ataques considerados (dentro de alcance)

| # | Actor / capacidad asumida | Ataque | Mitigación implementada | Riesgo residual explícito |
|---|---|---|---|---|
| A1 | Observador oportunista que fotografía o captura de pantalla el QR mostrado por el titular | **Replay**: reutiliza la imagen capturada más tarde para ingresar en lugar del titular | Uso único por nonce (`QRUse`, `routers/qr.py::validate_qr`) + vigencia corta firmada por el dispositivo (`QR_TTL_SECONDS`, justificada en `docs/ttl-justification.md`). Además, el QR va cifrado: el observador no puede leer foto, nombre ni RUT (ADR-11) | Si el atacante escanea **antes** que el titular dentro de la ventana de TTL (reenvío en tiempo real a un cómplice), el sistema acepta el QR. Pero el escáner muestra la **foto firmada del titular**, no la del cómplice: una comparación visual correcta lo detiene (ADR-10). El riesgo residual es el error humano al comparar rostros. |
| A2 | Atacante en la red (on-path) entre el navegador y el backend | Intercepta la sesión o las consultas a la API | **Parcial.** El QR mismo va cifrado de extremo a extremo hacia el escáner (ADR-11) y la consulta en línea no lleva la foto. El resto de la API (login, JWT, claves del escáner en `GET /events/{id}/verifier`) depende de TLS, que es un requisito de despliegue; el entorno de desarrollo corre en HTTP plano | Sin TLS, un atacante en la red podría robar sesiones y la clave privada del evento que recibe el escáner. Se declara como **requisito no negociable de despliegue**. |
| A3 | Verificador (portero) cuya sesión JWT es robada o reutilizada | Valida tokens ajenos fabricando entradas de acceso falsas en el log | El log asocia `scanned_by_id` a cada evento (`AccessLog`); no hay endpoint para editar o borrar `AccessLog` desde la API | Alguien con acceso directo a la base de datos (fuera de la API) sí podría alterar el historial — esto es un problema de gobernanza de infraestructura, fuera del alcance de este control de aplicación. |
| A4 | Persona que se presenta como "portero" ante el titular sin serlo, y le pide mostrar/escanear el QR con un dispositivo no autorizado | **Suplantación del verificador**: el titular no tiene forma de confirmar que el dispositivo que escanea es el oficial del recinto | Ninguna. El backend autentica al verificador *ante sí mismo* (JWT con rol `guard`/`admin`), pero el titular no tiene ningún canal para autenticar al verificador *ante él* | Riesgo residual explícito y no mitigado. Es una limitación estructural de los esquemas QR "mostrar y escanear" sin canal de confianza mutuo (p. ej. verificación visual de una credencial física del guardia, fuera del alcance de este prototipo de software). |
| A5 | Falsificación de un QR sin poseer uno legítimo | Fabricar un QR válido para una entrada ajena | Un QR válido exige la firma Ed25519 del dispositivo ligado a esa entrada y la firma del emisor sobre la cédula de su titular; el servidor verifica ambas (`routers/qr.py::_signatures_ok`). Adivinarlas es computacionalmente inviable | No hay *rate limiting* sobre `POST /qr/validate` ni sobre `POST /auth/login` (sí sobre `POST /tickets/claim`, ver A7). Mejora futura no implementada, se declara explícitamente para no sobre-prometer. |
| A6 | Reutilización de un QR vencido | Presentar un QR cuya hora firmada ya salió de la ventana | La hora va firmada por el dispositivo; el servidor la compara con su propio reloj en cada validación (TTL + 5 s de tolerancia) y rechaza además los QR fechados en el futuro | Quien controla el teléfono del titular puede fechar un QR como quiera dentro de la tolerancia; no gana más que eso. |
| A7 | Tercero que conoce el RUT del titular (dato semi-público) | **Suplantación por dato público**: pide el QR de otra persona ingresando solo su RUT, o enumera qué RUT tienen entrada | Se exige RUT + código de entrada (ADR-7); el código solo existe hasheado; `POST /tickets/claim` responde un 401 idéntico ante cualquier fallo y tiene rate limit por IP (10/min, `deps.py::RateLimiter`) | El rate limit es en memoria y por IP (un proceso); un atacante distribuido podría intentar más. Con ~40 bits de código sigue siendo inviable a esa escala, pero en producción el límite va en el proxy. |
| A8 | Reventa o filtración de la entrada (captura del código), o copia del archivo de la cédula | Abrir la misma entrada en un segundo dispositivo | El primer claim fija la clave pública del dispositivo (`Ticket.device_public_key`); un segundo claim recibe 409 y solo un admin puede liberar la entrada (`POST /tickets/{id}/reset`). Un QR firmado con otra clave es `invalid`. Además, la cédula debe ser del titular de la entrada (el RUT del core firmado debe coincidir) | Si el atacante reclama **antes** que el titular, gana él; pero sus QR muestran la foto del titular, así que en la puerta lo delata la foto (ADR-10). El titular recupera la entrada en soporte con su carnet. |
| A9 | Asistente ya ingresado | **Pass-back**: genera un QR nuevo y se lo pasa a alguien fuera del recinto | El teléfono puede generar QR sin conexión, pero el servidor rechaza cualquier QR de una entrada ya admitida (`Ticket.admitted_at`, `already_admitted`) y el `INSERT` del nonce impide que dos filas concedan el mismo QR (ADR-8) | Ninguno relevante con la consulta en línea. Sin red, el escáner no puede saber si la entrada ya ingresó: lo avisa como verificación parcial. |
| A10 | Persona con **prohibición de ingreso** (p. ej. hincha sancionado, derecho de admisión) | **Evasión del filtro**: entra presentando la credencial de un tercero sin prohibición, porque el filtro revisa el RUT de la credencial presentada, no el de la persona | Lista de prohibición revisada en la puerta en cada escaneo, sin consumir el QR ni registrar ingreso (`routers/bans.py`, `qr.py::validate_qr`). La credencial dinámica no se puede copiar de antemano (A1, A6). Si un tercero coopera en tiempo real, el escáner muestra **la foto firmada del tercero**, no la del sancionado (ADR-10) | La evasión con cooperación pasa la validación automática; la detiene la comparación visual de la foto. El riesgo residual es el error humano al comparar rostros, sobre todo si el sancionado se parece al tercero. |
| A11 | Falsificador de cédulas | **Cédula falsa o foto cambiada**: fabrica una cédula con su foto y el RUT de otro, o cambia la foto de una cédula real | La firma Ed25519 del emisor cubre RUT, nombre y hash de la foto. El escáner rechaza una firma inválida o una foto que no calza con su hash; el backend verifica la firma al activar y en cada validación (`credential.py::check_identity`, `_signatures_ok`) | Ninguno dentro del modelo, mientras la clave privada del emisor no se filtre (fuera de alcance: compromiso del Registro Civil). |
| A12 | Quien obtiene un escáner del personal o su sesión | Lee los QR del evento con la clave privada del evento | La clave solo se entrega a personal autenticado (`GET /events/{id}/verifier`) y sirve para un solo evento | Puede **leer** foto, nombre y RUT de quienes muestren su QR en ese evento (privacidad), pero no puede **fabricar** QR: le faltan la clave del dispositivo y la firma del emisor. En producción la clave iría en un almacén seguro del escáner y rotaría por evento. |

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
- **Suplantación biométrica automática**: no aplica porque este prototipo, a diferencia del esquema
  colombiano, no hace reconocimiento facial (ver `security-guarantees.md §4`). La foto firmada la
  compara una persona; sus errores de comparación se declaran como riesgo residual (A1, A10).
- **Extracción de la clave del dispositivo** por malware: en el prototipo vive en `localStorage`;
  en una cédula real iría en el almacén seguro del teléfono.
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
comparando visualmente la foto de la tarjeta con la persona. Según información pública, ese QR
permite consultar la vigencia del documento en el Registro Civil, y su contenido es **fijo**
durante toda la vida del documento. *(Para la tesis: respaldar esta caracterización con la fuente
oficial del Registro Civil antes de trasladar la tabla al capítulo de Resultados.)*

La diferencia de fondo es qué prueba cada lectura:
- **QR estático:** prueba que *existe un documento vigente con ese número de serie*.
- **QR dinámico:** prueba que *quien lo muestra controla, en este momento, la credencial activada
  en su dispositivo*, y trae la foto firmada de su titular para compararla con la persona.

| Ataque | QR estático del carnet físico + verificación visual | QR dinámico (este prototipo) |
|---|---|---|
| **Copia del QR** (foto, fotocopia, captura) y reutilización posterior | **Funciona.** La copia se lee igual que el original: el QR no cambia ni se consume | **No funciona.** Expira en 45 s y se consume al primer escaneo (A1, A6) |
| **Carnet falsificado con el QR clonado de uno real** | **La lectura del QR pasa** (el documento clonado existe y está vigente). Solo queda la verificación visual del guardia, contra una foto que el falsificador controla | **No funciona.** Una cédula con otra foto o datos no tiene firma válida del emisor (A11) y un QR sin la clave del dispositivo es `invalid` (A5, A8) |
| **Cambio de foto** en una tarjeta real (robada o prestada) | La lectura del QR pasa. La detección depende de que el guardia note la adulteración | **No funciona.** La foto va firmada dentro del QR; cambiarla rompe la firma (A11) |
| **Uso de un documento ajeno** (prestado, robado) por alguien parecido | Pasa si el guardia no nota la diferencia | Requiere además el dispositivo desbloqueado con la entrada activada (A8). La comparación visual es contra la foto firmada, igual de exigente para el guardia |
| **Varias personas con copias del mismo documento** | Todas pasan la lectura del QR | Una sola: admisión única por entrada (A9) y consumo atómico (ADR-8) |
| **Persona con prohibición de ingreso usa la copia del QR de un tercero** (hincha sancionado) | **Funciona.** El filtro revisa el RUT del tercero, que no tiene prohibición; la verificación visual compara contra la foto del carnet falso | **No funciona.** La copia expiró; el sancionado necesitaría la cooperación del tercero en tiempo real (A10) |
| **Persona con prohibición de ingreso usa la credencial prestada por un tercero que coopera** | Pasa la lectura; la foto del carnet prestado es la del tercero (si no usa uno falso, ver fila anterior) | Pasa la validación automática, pero el escáner muestra **la foto firmada del tercero** y el tercero pierde su ingreso (A9, A10). Lo detiene una comparación visual correcta |
| **Reenvío en tiempo real** del QR a un cómplice en la puerta (*relay*) | No aplica (no hace falta: basta una copia) | Pasa la validación automática si el cómplice escanea antes que el titular, pero el escáner muestra **la foto del titular**. Lo detiene una comparación visual correcta (A1) |
| **Robo o pérdida** | Hay que bloquear el documento; mientras tanto, el QR sigue leyéndose | La sesión se revoca desde el servidor (`POST /tickets/{id}/reset`) y deja de funcionar al instante |
| **Caída de la red en el recinto** | La lectura se degrada a solo verificación visual | El escáner sigue verificando **localmente** cédula, foto y vigencia (ADR-11), pero no el uso único, la admisión ni las prohibiciones. Requiere un protocolo de contingencia |
| **Costo en la fila** | Línea base | +23 ms por persona en condiciones realistas, +3 % de espera en la punta (`queue-model.md`) |

**Verificación empírica:** [`attack-experiment.md`](attack-experiment.md) ejecuta estos ataques contra ambos modos sobre el backend real. En la validación automática, el QR estático cae en 4 de 5 ataques y el dinámico en 1 de 5 (solo el reenvío en tiempo real). Si además el guardia compara bien la foto, el estático sigue cayendo en 4 de 5 (el carnet falso lleva la foto del atacante) y el dinámico en 0 de 5. Para el filtro de personas con prohibición de ingreso: con el carnet, 2 de 2 evasiones pasan la lectura y 1 de 2 sobrevive a la comparación de la foto; con el QR dinámico, 1 de 2 y 0 de 2.

**Lectura para la tesis.** El QR dinámico elimina la clase de ataques más barata contra el carnet
físico: **copiar o clonar un QR estático**. El atacante ya no puede prepararse de antemano, tiene
que actuar en tiempo real (*relay*) y necesita un cómplice coordinado. Y como el QR trae la foto
firmada del titular, ese cómplice queda frente a un guardia que ve una cara que no es la suya.
La verificación visual sigue siendo el eslabón que vincula la credencial con la persona física en
ambos esquemas, pero en el dinámico la foto contra la que se compara es auténtica, no la que el
falsificador imprimió. Sin biometría automática (ADR-5), el límite es el error humano al comparar
rostros.
