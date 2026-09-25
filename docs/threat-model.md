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
| Token QR vigente | Autoriza un único ingreso mientras no expire ni se use | `QRToken` (`backend/app/models.py`) |
| Sesión JWT | Autentica al usuario ante la API | `security.py::create_access_token` |
| Registro de auditoría | Evidencia de cada intento de acceso, concedido o no | `AccessLog` (`backend/app/models.py`) |
| Asignación de rol | Determina si alguien puede generar QR (cualquiera) o validar QR (guard/admin) | `Role` enum + `deps.py::require_roles` |

## 3. Actores y ataques considerados (dentro de alcance)

| # | Actor / capacidad asumida | Ataque | Mitigación implementada | Riesgo residual explícito |
|---|---|---|---|---|
| A1 | Observador oportunista que fotografía o captura de pantalla el QR mostrado por el titular | **Replay**: reutiliza la imagen capturada más tarde para ingresar en lugar del titular | Un solo uso (`QRToken.used`, `routers/qr.py::validate_qr`) + expiración corta (`QR_TTL_SECONDS`, justificada en `docs/ttl-justification.md`) | Si el atacante escanea **antes** que el titular legítimo dentro de la ventana de TTL ("ataque de carrera"/relay), el sistema no puede distinguir quién es el portador real — gana el primero en llegar al backend, y el titular legítimo recibe `already_used`. Este riesgo es inherente a cualquier esquema "mostrar y escanear" sin vínculo biométrico (ver comparación con Colombia en `security-guarantees.md`). |
| A2 | Atacante en la red (on-path) entre el navegador y el backend | Intercepta el token en tránsito durante `POST /qr/generate` o `POST /qr/validate` | **Ninguna a nivel de aplicación.** El transporte cifrado (TLS) es un requisito de despliegue, no algo que el código garantice — el entorno de desarrollo corre en HTTP plano | Sin TLS en producción, este ataque es completamente viable y anula el resto de las mitigaciones. Se declara como **requisito no negociable de despliegue**, no como trabajo pendiente del prototipo. |
| A3 | Verificador (portero) cuya sesión JWT es robada o reutilizada | Valida tokens ajenos fabricando entradas de acceso falsas en el log | El log asocia `scanned_by_id` a cada evento (`AccessLog`); no hay endpoint para editar o borrar `AccessLog` desde la API | Alguien con acceso directo a la base de datos (fuera de la API) sí podría alterar el historial — esto es un problema de gobernanza de infraestructura, fuera del alcance de este control de aplicación. |
| A4 | Persona que se presenta como "portero" ante el titular sin serlo, y le pide mostrar/escanear el QR con un dispositivo no autorizado | **Suplantación del verificador**: el titular no tiene forma de confirmar que el dispositivo que escanea es el oficial del recinto | Ninguna. El backend autentica al verificador *ante sí mismo* (JWT con rol `guard`/`admin`), pero el titular no tiene ningún canal para autenticar al verificador *ante él* | Riesgo residual explícito y no mitigado. Es una limitación estructural de los esquemas QR "mostrar y escanear" sin canal de confianza mutuo (p. ej. verificación visual de una credencial física del guardia, fuera del alcance de este prototipo de software). |
| A5 | Adivinación o fuerza bruta del identificador del token | Enumerar/adivinar tokens válidos sin poseer uno legítimo | El identificador es un UUID v4 (`models.py:41`), ~122 bits de entropía aleatoria — computacionalmente inviable de adivinar | No hay *rate limiting* sobre `POST /qr/validate` ni sobre `POST /auth/login` (sí sobre `POST /tickets/claim`, ver A7); un atacante con acceso a la red podría intentar un volumen alto de solicitudes. Mejora futura no implementada, se declara explícitamente para no sobre-prometer. |
| A6 | Reutilización de un token ya expirado antes de que exista una tarea de limpieza | Enviar un token vencido esperando que la fila "residual" en la base de datos aún se acepte | Cada validación compara `expires_at` contra la hora actual en el momento de la solicitud (`routers/qr.py::validate_qr`), no depende de un job de limpieza | Ninguno relevante: el chequeo es sincrónico e independiente de si la fila fue purgada. |
| A7 | Tercero que conoce el RUT del titular (dato semi-público) | **Suplantación por dato público**: pide el QR de otra persona ingresando solo su RUT, o enumera qué RUT tienen entrada | Se exige RUT + código de entrada (ADR-7); el código solo existe hasheado; `POST /tickets/claim` responde un 401 idéntico ante cualquier fallo y tiene rate limit por IP (10/min, `deps.py::RateLimiter`) | El rate limit es en memoria y por IP (un proceso); un atacante distribuido podría intentar más. Con ~40 bits de código sigue siendo inviable a esa escala, pero en producción el límite va en el proxy. |
| A8 | Reventa o filtración de la entrada (captura del código) | Abrir la misma entrada en un segundo dispositivo | Vínculo al dispositivo: el primer claim fija `Ticket.claim_session`; un segundo claim recibe 409 y solo un admin puede liberar la entrada (`POST /tickets/{id}/reset`) | Si el atacante reclama **antes** que el titular, gana él; el titular debe acudir a soporte con su carnet. Es el mismo problema de "quién llega primero" de A1, desplazado a la activación. |
| A9 | Asistente ya ingresado | **Pass-back**: genera un QR nuevo y se lo pasa a alguien fuera del recinto | `Ticket.admitted_at` bloquea nuevas emisiones (`already_admitted`) y el consumo atómico impide que dos filas concedan el mismo QR (ADR-8) | Ninguno relevante dentro del modelo online. En un modo offline futuro habría que sincronizar `admitted_at` entre filas. |
| A10 | Persona con **prohibición de ingreso** (p. ej. hincha sancionado, derecho de admisión) | **Evasión del filtro**: entra presentando la credencial de un tercero sin prohibición, porque el filtro revisa el RUT de la credencial presentada, no el de la persona | Lista de prohibición revisada en la puerta en cada escaneo, sin consumir el QR ni registrar ingreso (`routers/bans.py`, `qr.py::validate_qr`). La credencial dinámica no se puede copiar de antemano (A1, A6) | Si un tercero **coopera en tiempo real** (reenvía su QR o presta el teléfono), el filtro se evade igual que con un carnet prestado. El tercero pierde su propio ingreso (A9), lo que encarece el ataque. La mitigación de fondo es ADR-10: el guardia vería la foto oficial del tercero, no la del sancionado. |

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
- **Suplantación biométrica**: no aplica porque este prototipo, a diferencia del esquema
  colombiano, no implementa verificación biométrica (ver `security-guarantees.md §2` para la
  justificación de esa decisión de alcance).
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
  en su dispositivo*.

| Ataque | QR estático del carnet físico + verificación visual | QR dinámico (este prototipo) |
|---|---|---|
| **Copia del QR** (foto, fotocopia, captura) y reutilización posterior | **Funciona.** La copia se lee igual que el original: el QR no cambia ni se consume | **No funciona.** Expira en 45 s y se consume al primer escaneo (A1, A6) |
| **Carnet falsificado con el QR clonado de uno real** | **La lectura del QR pasa** (el documento clonado existe y está vigente). Solo queda la verificación visual del guardia, contra una foto que el falsificador controla | **No aplica.** No hay objeto físico que falsificar: el QR lo emite el servidor para la sesión activada |
| **Cambio de foto** en una tarjeta real (robada o prestada) | La lectura del QR pasa. La detección depende de que el guardia note la adulteración | No aplica al QR. Si se implementa ADR-10, la foto de referencia viene del servidor y no se puede adulterar |
| **Uso de un documento ajeno** (prestado, robado) por alguien parecido | Pasa si el guardia no nota la diferencia | Requiere además el dispositivo desbloqueado y la credencial activada del titular (A8). Con ADR-10, la comparación visual es contra la foto oficial |
| **Varias personas con copias del mismo documento** | Todas pasan la lectura del QR | Una sola: admisión única por entrada (A9) y consumo atómico (ADR-8) |
| **Persona con prohibición de ingreso usa la copia del QR de un tercero** (hincha sancionado) | **Funciona.** El filtro revisa el RUT del tercero, que no tiene prohibición; la verificación visual compara contra la foto del carnet falso | **No funciona.** La copia expiró; el sancionado necesitaría la cooperación del tercero en tiempo real (A10) |
| **Persona con prohibición de ingreso usa la credencial prestada por un tercero que coopera** | **Funciona** (carnet prestado + verificación visual) | **Funciona** (reenvío del QR o teléfono prestado), pero el tercero pierde su ingreso (A9). Con ADR-10 el guardia vería la foto del tercero |
| **Reenvío en tiempo real** del QR a un cómplice en la puerta (*relay*) | No aplica (no hace falta: basta una copia) | **Funciona si el cómplice escanea antes que el titular** dentro de los 45 s. Riesgo residual de A1 |
| **Robo o pérdida** | Hay que bloquear el documento; mientras tanto, el QR sigue leyéndose | La sesión se revoca desde el servidor (`POST /tickets/{id}/reset`) y deja de funcionar al instante |
| **Caída de la red en el recinto** | La lectura se degrada a solo verificación visual | **La fila QR se detiene** (validación en línea; ADR-1). Requiere plan de contingencia |
| **Costo en la fila** | Línea base | +24 ms por persona en condiciones realistas, +3 % de espera en la punta (`queue-model.md`) |

**Verificación empírica:** [`attack-experiment.md`](attack-experiment.md) ejecuta estos ataques contra ambos modos sobre el backend real: el QR estático cae en 4 de 5 ataques y el dinámico en 1 de 5 (solo el reenvío en tiempo real). Para el filtro de personas con prohibición de ingreso, el sancionado lo evade en 2 de 2 intentos con el carnet y en 1 de 2 con el QR dinámico (solo con un tercero que coopera en tiempo real).

**Lectura para la tesis.** El QR dinámico elimina la clase de ataques más barata contra el carnet
físico: **copiar o clonar un QR estático**. El atacante ya no puede prepararse de antemano, tiene
que actuar en tiempo real (*relay*) y necesita un cómplice coordinado. A cambio, el sistema pasa a
depender de la conectividad. La verificación visual sigue siendo el eslabón que vincula la
credencial con la persona física en ambos esquemas; ADR-10 propone reforzarla sin biometría
automática.
