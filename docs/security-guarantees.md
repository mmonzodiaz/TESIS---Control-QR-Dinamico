# Qué protege este mecanismo y qué NO protege

> Complementa `metodologia.tex §Prototipo de verificación`, donde ya queda declarado: *"por sí
> solo, un código QR dinámico no constituye una prueba criptográfica de clave pública equivalente
> a la firma digital"*. Este documento desarrolla esa frase con precisión técnica y la contrasta
> contra sistemas reales. **Actualización (ADR-10, ADR-11):** el prototipo ahora sí usa firmas de
> clave pública (emisor y dispositivo) y cifrado; revisar la frase de `metodologia.tex` para que
> no contradiga esto. Sigue sin ser una firma electrónica con valor legal (§2.4).

## 1. Qué SÍ protege (con trazabilidad al código)

| Garantía | Mecanismo | Ubicación |
|---|---|---|
| Foto, nombre y RUT que ve el guardia son auténticos | Firma Ed25519 del emisor (Registro Civil, simulado) sobre RUT, nombre y SHA-256 de la foto | `backend/app/credential.py::check_qr`, `frontend/src/credential.ts::checkQr` |
| Un QR no se puede fabricar para otra persona | Cada QR lo firma el teléfono cuya clave pública va firmada dentro de la cédula; lector y servidor verifican ambas firmas | `backend/app/credential.py::check_signatures` |
| Quien fotografía el QR no puede leer los datos personales | Cifrado para la clave pública de lectores autorizados (X25519 efímera + HKDF-SHA256 + ChaCha20-Poly1305) | `credential.py::build_qr` / `decode_qr` |
| La foto no pasa por el sistema del recinto | El servidor verifica la firma con el hash de la foto; la consulta en línea no envía la foto | `schemas.py::QRValidateIn` |
| Un código no se puede usar dos veces | `INSERT` del nonce en `qr_uses` (clave primaria) en la misma transacción que concede el acceso | `backend/app/routers/qr.py::validate_qr` |
| La ventana de reutilización por captura está acotada y justificada | `QR_TTL_SECONDS = 45`, derivado en `docs/ttl-justification.md`, no arbitrario; la hora va firmada | `backend/app/config.py` |
| Solo entra quien tiene entrada | El RUT firmado de la cédula se coteja con la lista de entradas del evento (`no_ticket`) | `backend/app/routers/qr.py::_evaluate` |
| Una cédula revocada (teléfono perdido o cédula activada en otro teléfono) deja de servir | Lista de revocadas firmada por el emisor, verificada y en caché 30 s en el backend; motivo `revoked` (ADR-14) | `backend/app/revocation.py`, `backend/app/routers/qr.py::_evaluate`, `scripts/registro_civil_sim.py::enroll` / `report_loss` |
| Cada intento (concedido o no) queda auditado | Tabla `AccessLog` con motivo, usuario y verificador | `backend/app/models.py::AccessLog` |
| Lo que el guardia decide sin red también queda auditado y se contrasta con el servidor | Al volver la red, `/qr/sync` reverifica cada decisión a la hora del escaneo y marca como alerta lo que no se habría permitido (ADR-15) | `backend/app/routers/qr.py::sync_offline`, `frontend/src/offline.ts` |
| La fuerza bruta contra contraseñas y claves cortas está acotada | Límite de intentos: login 5/min por cuenta y 30/min por IP; validación 120/min por guardia; enrolamiento y reporte de pérdida 10/min por IP | `backend/app/ratelimit.py`, `routers/auth.py::login`, `routers/qr.py`, `registro_civil/app.py` |
| Solo roles autorizados pueden validar accesos | Verificación de rol `guard`/`admin` vía dependencia de FastAPI | `backend/app/deps.py::require_roles` |

## 1b. Seguridad de la aplicación web (OWASP Top 10 2021)

Además del protocolo de la cédula (§1), el backend y el frontend aplican los controles estándar de
una aplicación web. Cada fila tiene su test en `backend/tests/test_security.py` salvo que se indique
otro archivo. Las herramientas automáticas quedan sin hallazgos: `pip-audit` (dependencias de
Python), `npm audit` (frontend) y `bandit` (análisis estático; las contraseñas de las cuentas demo
van marcadas con `# nosec`).

| Riesgo OWASP | Control | Ubicación |
|---|---|---|
| A01 Control de acceso | Rol exigido en cada endpoint (`guard`/`admin`); un admin no puede quitarse sus permisos, desactivarse ni borrarse, y siempre queda al menos un admin activo | `app/deps.py::require_roles`, `routers/users.py` |
| A02 Fallas criptográficas | Contraseñas con Argon2id (primera opción de OWASP); los hashes bcrypt anteriores se aceptan y se actualizan al iniciar sesión. JWT HS256 con secreto de 32+ caracteres obligatorio: el backend no arranca con el secreto del ejemplo | `app/security.py`, `app/config.py::_strong_jwt_secret` |
| A03 Inyección | Todas las consultas van por SQLAlchemy con parámetros ligados (no hay SQL armado con texto); los payloads de inyección se guardan como texto literal. Todo texto de entrada tiene largo máximo y los campos del QR tienen formato y rango. React escapa todo lo que muestra (no hay `dangerouslySetInnerHTML`) | `app/schemas.py`, `test_sql_injection_*` |
| A04 Diseño inseguro | Límite de intentos en login, validación y enrolamiento; mensajes de error uniformes | `app/ratelimit.py` |
| A05 Configuración | Cabeceras de seguridad en toda respuesta (CSP, `nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cache-Control: no-store`, HSTS sobre HTTPS); documentación `/docs` apagada por defecto; límite de 1 MB por solicitud (413); CORS solo para los orígenes configurados y sin credenciales de navegador; errores sin rutas ni detalles internos; uvicorn con `--no-server-header`. En el frontend, CSP estricta en la versión de producción | `app/hardening.py`, `app/main.py`, `app/issuer.py`, `frontend/vite.config.ts` |
| A06 Componentes vulnerables | `python-jose` (con una vulnerabilidad conocida en `ecdsa`) y `passlib` (sin mantenimiento) se reemplazaron por PyJWT y argon2-cffi; versiones fijadas en `uv.lock` y `package-lock.json` | `backend/pyproject.toml` |
| A07 Autenticación | Política de contraseñas NIST SP 800-63B (12 a 128 caracteres, sin reglas de composición, rechaza las triviales); el login responde igual y tarda lo mismo exista o no la cuenta; JWT con `exp`, `iat`, `nbf`, `iss`, `aud` y algoritmo fijo (rechaza `alg: none`, firmas de otra clave, tokens vencidos o de otra audiencia); cambiar la contraseña, el rol o desactivar una cuenta cierra sus sesiones abiertas (claim `ver`); el frontend guarda el token en `sessionStorage` y vuelve al login ante cualquier 401 | `app/security.py`, `app/deps.py`, `frontend/src/auth/AuthContext.tsx` |
| A08 Integridad | Las cédulas, los QR y la lista de revocadas van firmados (§1); archivos de bloqueo de dependencias versionados | `app/credential.py` |
| A09 Registro y monitoreo | Registro de eventos de seguridad (login correcto y fallido, bloqueos por límite, accesos denegados, cambios de usuarios y prohibiciones, alertas sin conexión), sin contraseñas, tokens ni RUT completos, y sin permitir que un dato del usuario falsifique una línea | `app/audit.py` |
| A10 SSRF | El backend solo consulta la URL del Registro Civil fijada en la configuración; ninguna URL viene del usuario | `app/revocation.py` |

## 2. Qué NO protege — declarado explícitamente para no inflar garantías

1. **Las firmas son reales, pero la infraestructura del emisor es simulada.** Hay verificación de
   firma Ed25519 del emisor y del dispositivo en cada escaneo. Pero el "Registro Civil" es un
   servicio con una sola clave (`registro_civil/app.py`, `scripts/registro_civil_sim.py`): sin
   certificados X.509, sin cadena de confianza ni rotación de claves, y con una lista de revocación
   firmada simple (ADR-14) en vez de un servicio de estado estándar. El
   enrolamiento usa una clave de activación en vez de la ClaveÚnica. La cédula y la clave del
   dispositivo se guardan cifradas con un PIN en `localStorage`, no en un almacén seguro del
   teléfono: el límite de intentos de PIN lo aplica la página, no el hardware. Esto se declara sin ambigüedad porque es
   precisamente el punto que un jurado de Ciencias de la Computación exigirá que no se difumine.
2. **No hay biometría automática.** El guardia compara a la persona con la foto firmada, como hoy
   con el carnet, y puede equivocarse. Cualquiera con el teléfono desbloqueado del titular puede
   mostrar un QR válido; lo que lo delata es que la foto no es la suya, si el guardia lo nota.
   Esto contrasta con el esquema colombiano, que compara biometría en la verificación (§3).
3. **Sin conexión, la admisión única entre puertas no se garantiza, solo se detecta después.** El
   escáner comprueba localmente la cédula, la foto y la vigencia, y con su copia de contingencia
   (hasta 10 min de antigüedad) la revocación, la entrada, las prohibiciones y quién ya había
   ingresado (ADR-15). Lo que no puede saber es quién entró por **otra** puerta durante la caída:
   la misma persona, o un cómplice con un QR reenviado, podría entrar dos veces. El servidor lo
   marca como alerta al sincronizar, cuando ya ocurrió. Tampoco aplican las prohibiciones ni
   revocaciones posteriores a la última copia. Sin copia vigente, el lector no deja pasar a nadie.
4. **No aporta no repudio ni equivalencia legal de firma.** No hay ningún efecto jurídico asociado
   a un evento de validación, a diferencia de una firma electrónica avanzada.
5. **La confidencialidad de la API depende del despliegue.** El QR va cifrado de extremo a extremo
   hacia el escáner, pero la sesión, las consultas y las claves que recibe el escáner viajan por la
   API, que no impone TLS; es un requisito operacional externo al software (`threat-model.md`, A2).
   Quien obtenga un escáner del personal puede leer cualquier QR de cédula (A12).
6. **El control de tasa (*rate limiting*) es básico.** Está en el enrolamiento y el reporte de
   pérdida del Registro Civil simulado (10 intentos/min por IP), en `POST /auth/login` (5/min por
   cuenta y 30/min por IP, contando todos los intentos) y en `POST /qr/validate` y `/qr/sync`
   (120/min por guardia) (`app/ratelimit.py`, configurable en `app/config.py`). Vive en la memoria de
   un solo proceso: con varios procesos o réplicas cada uno contaría por separado, y reiniciar el
   servidor lo vacía. En producción iría en el proxy o API gateway, o en un almacén compartido. El
   límite por IP también agrupa a todos los que salen por la misma IP (por ejemplo, detrás del proxy
   de Vite en la demo).
7. **No autentica al verificador ante el titular.** El titular no tiene forma de confirmar que
   quien escanea su código es efectivamente personal autorizado del recinto (ver `threat-model.md`,
   actor A4).
8. **La revocación no es inmediata ni completa.** Revocar una cédula (reporte de pérdida o
   activación en otro teléfono, ADR-14) tarda hasta 30 s en aplicar en línea y hasta 60 s más en un
   escáner sin red. Si el Registro Civil no responde, el recinto sigue con la última lista válida;
   si nunca la obtuvo, no puede revocar nada. Las cédulas emitidas antes de ADR-14 no se pueden
   revocar hasta reactivarlas.
9. **La sesión del personal vive en el navegador.** El token va en `sessionStorage` (no en una
   cookie `HttpOnly`): un XSS podría leerlo. Lo mitigan la CSP estricta de la versión de producción,
   que React escape todo lo que muestra y que el token dure un turno (8 h) y se invalide al cambiar
   la contraseña. La CSP permite estilos en línea (`'unsafe-inline'` en `style-src`, necesarios para
   React y el lector de cámara), no scripts. El personal entra solo con contraseña: no hay segundo
   factor (MFA).
10. **El registro de seguridad va a la salida estándar del proceso**, no a un sistema central con
   retención y alertas (SIEM); en producción se recolectaría desde ahí.

## 3. Comparación explícita con esquemas de referencia

| Dimensión | Este prototipo | Identificación Digital (Chile, según información pública) | Cédula Digital (Colombia) | Uruguay / Perú (documento con PKI) | ISO/IEC 18013-5 (mDL) | RFC 6238 (TOTP) |
|---|---|---|---|---|---|---|
| Revocable del lado del servidor | Sí: la cédula, por lista firmada del emisor (ADR-14); cada QR además expira solo | Desconocido (no público) | Sí (aplicación oficial) | Parcial (revocación de certificado) | Sí (mecanismos de estado de revocación) | N/A (expira solo) |
| Verificable sin conexión | Parcial: identidad, foto y vigencia siempre; revocación, entrada y prohibiciones con una copia de hasta 10 min; el uso único entre puertas solo al sincronizar (ADR-15) | Desconocido | No (requiere verificación en línea) | Sí (firma verificable con el certificado) | Sí (diseño explícito para verificación offline) | Sí (algoritmo determinista compartido) |
| Vinculado a biometría del portador | Foto firmada para comparación humana; comparación automática decidida y aún no implementada (ADR-16, §4) | Sí, pero **para abrir la app y autorizar el compartir datos**, no para la verificación en la puerta: PIN, o *selfie* o huella si el móvil lo permite, con «detección de vida certificada por iBeta, conforme al estándar ISO 30107-3» (Res. Ex. 234/2026) | Sí (facial y dactilar) | No (PIN, no biometría) | Frecuente en implementaciones (foto/biometría) | No aplica |
| Autoverificable criptográficamente (firmado) | Sí (Ed25519 del emisor simulado + del dispositivo) | **Desconocido, y buscado**: ninguna fuente chilena menciona firma digital de la credencial, algoritmo, formato ni cadena de confianza; tampoco PKI del Estado. Sí declara OpenID Connect para autenticar usuarios (Res. Ex. 234/2026) | Parcial (arquitectura no pública) | Sí (PKI, certificado X.509) | Sí (firma del emisor sobre el documento) | Sí (HMAC compartido, no PKI) |
| Datos personales del QR protegidos ante terceros | Sí (cifrado para lectores autorizados) | Desconocido: no se sabe qué datos lleva el QR, así que tampoco si van protegidos. La Res. Ex. 234/2026 invoca ISO 18013-5 solo para compartir atributos **por Bluetooth**, no para el QR | Desconocido | No aplica | Sí (sesión cifrada entre dispositivo y lector) | No aplica |
| Ventana de exposición ante *replay* | ~45 s, justificada (`ttl-justification.md`) | **Existe por norma pero no está cuantificada**: Res. Ex. 234/2026 dice textual «Un código QR con vigencia limitada», y eso es todo. El intervalo no es público (las cifras de «6 segundos» o «2 horas» que circulan provienen de material comercial de terceros sin fuente) | No documentada públicamente | No aplica (no es un código rotativo) | No aplica (no es un código rotativo) | 30 s (parámetro estándar) |
| Equivalencia legal / no repudio | No | Declarada, pero con dos matices: **ninguna ley la crea** (la base es el art. 7 letra n) de la Ley 19.477, de 1996; la Ley 21.180 no se invoca), y la equivalencia aparece en un **considerando** de la Res. Ex. 234/2026 —«con la misma seguridad jurídica de la cédula física»— con la salvedad «en los casos que la respectiva normativa lo permita». No sirve como documento de viaje | Sí (misma validez que el documento físico) | Sí (Ley 18.600 Uruguay / IOFE Perú) | Depende de la jurisdicción emisora | No aplica (no es un documento de identidad) |
| Especificación técnica pública | Sí (este repositorio) | **No.** La Res. Ex. 234/2026 fija características y menciones, pero no especifica qué datos codifica el QR, ni el formato de credencial, ni la firma. No hay esquema, documentación de integración ni auditoría independiente publicada | Parcial (arquitectura general documentada, detalle criptográfico no público) | Parcial | Sí (estándar ISO publicado) | Sí (RFC publicado) |

Fuentes para Colombia: `registraduria_cedula_2024`, `redmas_cedula_2024`,
`registraduria_verificacion_2024` (ya presentes en `bibliografia.bib` de la tesis, sección
`estado_del_arte.tex §Colombia`). Fuentes para Uruguay/Perú: `agesic_cedulachip_2024`,
`agesic_firma_2024`, `reniec_dnie_2024`, `reniec_certificados_2024` (idem). Para RFC 6238 e
ISO/IEC 18013-5, son citas nuevas que deben incorporarse al `.bib` de la tesis si esta tabla se
traslada al capítulo de Resultados (no se modifica el proyecto LaTeX desde este repositorio).

**Fuente de la columna de Chile: `srcei_resolucion234_2026`** (Resolución Exenta 234 del Registro
Civil, Diario Oficial del 13 de mayo de 2026), que fija por primera vez las características de la
cédula digital. Es **posterior a toda la literatura secundaria** sobre el tema, así que las
caracterizaciones de prensa, de proveedores y de informes de 2024-2025 —incluido lo descrito en
`ttl-justification.md §4`— no la conocen; donde haya conflicto, manda la resolución. Dos
precisiones que la mayoría de las fuentes secundarias pierde:

- **ISO/IEC 18013-5 sí está invocado por norma chilena** —es la única norma del país que lo
  menciona— pero el alcance es acotado: «capacidad de compartir atributos del titular y del
  documento utilizando el estándar ISO 18013-5, tecnología inalámbrica bluetooth». El QR se lista
  aparte, como característica de seguridad. *Inferencia no verificada:* en ISO 18013-5 el QR
  cumple el rol de *device engagement* (clave efímera y parámetros de transporte, no los datos de
  identidad, que viajan por BLE). Si Chile implementa el estándar tal como está escrito, el QR no
  sería una credencial autocontenida — pero la resolución no lo dice y nadie lo ha verificado.
- **El QR oficial no puede llevar la fotografía** (medición propia, 2026-10-03). Escaneado con un
  lector genérico, el payload es base64 de 344 caracteres con relleno `==`, o sea **256 bytes
  exactos**; la foto del prototipo ocupa ~846 B por sí sola, más del triple. Es un token compacto, no una credencial autocontenida, así que el verificador necesita
  otro canal —el Bluetooth con ISO 18013-5 de la resolución, o una consulta en línea— para obtener
  la identidad. Eso convierte el ADR-10 de esta tesis en un punto de diseño **distinto** del
  oficial, no en una imitación: es el único de los dos que entrega una foto autenticada sin
  depender de un canal adicional. *Salvedades:* una muestra, una versión de la app, la cédula del
  propio autor, y el largo exacto conviene reverificarlo; no se publica el payload. Detalle y
  salvedades completas en `architecture.md` ADR-10.
- **No existe ecosistema de verificación.** Buscado activamente: no hay app verificadora del
  Registro Civil, ni SDK, ni API pública, ni registro de verificadores, ni figura jurídica de
  «autoridad de verificación» —término que aparece solo en la ficha comercial de la app, en ninguna
  norma—, ni *trust framework*. Tampoco hay auditoría independiente del QR: cero repositorios
  públicos que lo parseen, cero charlas en la agenda de la 8.8 de 2026, cero publicaciones
  académicas. La app operó unos 18 meses sin norma publicada que la definiera (diciembre de 2024 a
  mayo de 2026). Ese vacío es el hueco de investigación que este trabajo ocupa.

## 4. Biometría automática: de ausencia justificada a apoyo local de la decisión humana (ADR-16)

**Estado actual del código: no implementada.** Hoy el QR trae una **foto firmada** (ADR-10) que
compara una persona, igual que hoy con el carnet: no hay reconocimiento facial, ni plantillas
biométricas, y el sistema del evento no recibe ni guarda la foto. Todo lo que esta sección dice
sobre la comparación automática describe una decisión de diseño tomada (ADR-16), no una propiedad
que el prototipo ya tenga. Mientras no esté implementada y medida, la limitación 2 de §2.2 sigue
vigente tal cual.

**Posición original (ADR-5).** No hacer biometría automática se sostenía en tres razones:

1. **Principio de minimización de datos** ya declarado como valor metodológico de esta tesis
   (`metodologia.tex §Consideraciones éticas`): no recolectar datos sensibles que no sean
   estrictamente necesarios para el objetivo exploratorio del prototipo.
2. **Alcance de prototipo, no de sistema de producción**: implementar reconocimiento facial con
   garantías reales (anti-*spoofing*, precisión aceptable) es un problema de ingeniería aparte,
   fuera del objetivo específico que este componente atiende (demostrar el mecanismo de QR
   dinámico, no construir un sistema biométrico).
3. **Consistencia con el modelo de amenazas**: la suplantación biométrica automática se declara
   fuera de alcance en `threat-model.md §4` porque no hay un comparador automático que engañar. El
   error humano al comparar la foto sí se declara como riesgo residual (A1, A10).

**Qué cambió y qué sobrevive.** La revisión pidió incorporar la comparación automática, de modo que
las razones 2 y 3 caducan: pasa a haber un comparador y hay que modelar cómo se lo engaña. La razón
1 **no** caduca: se convierte en el requisito que da forma al diseño. De ahí las tres restricciones
de ADR-16, que son las que mantienen la minimización en pie:

- La comparación corre **en el dispositivo del guardia**, no en el teléfono del titular (si el
  portador calculara el parecido, un teléfono modificado podría mentir) ni en el servidor del
  recinto (que seguiría sin recibir la foto, pero recibiría el rostro en vivo).
- **No se persiste ninguna imagen ni ningún vector.** El fotograma y el *embedding* viven en memoria
  y se descartan; al historial va solo puntaje, umbral y decisión. Un *embedding* es dato
  biométrico: persistirlo sería guardar biometría con otro nombre.
- El resultado es **apoyo a la decisión del guardia**, no un veredicto que la reemplace. Esto no es
  cosmético: sin detección de ataques de presentación (ISO/IEC 30107-3), mostrarle a la cámara una
  foto del titular legítimo derrota al comparador (A15 en `threat-model.md`), y la presencia del
  guardia mirando a la persona es la única mitigación que el prototipo tiene frente a eso.
- Existe una **vía alternativa no biométrica**: quien no consienta entra por la verificación visual
  del guardia. Además de lo anterior, esto es exigencia legal — ver abajo.

**Diferencia que se mantiene frente al esquema colombiano.** Allí la biometría es una barrera
independiente y el sistema verificador trata el dato biométrico. Aquí, incluso implementada, no se
construye base de datos de rostros en el recinto: la referencia la aporta la credencial firmada por
el emisor y el cómputo no sobrevive al escaneo. Esa es la diferencia estructural que debe leerse en
la comparación de §3.

**Marco legal: `docs/ley-21719.md`.** Resumen de lo que condiciona el diseño: el rostro es dato
personal sensible y la verificación 1:1 está expresamente alcanzada; para biometría la ley admite
**solo consentimiento expreso**, sin las excepciones que valen para otros datos sensibles; y el art.
12 inc. 6° presume que el consentimiento no fue libre si la recolección no era necesaria para
prestar el servicio, lo que **obliga** a mantener la vía no biométrica. El diseño local y transitorio
se apoya en el art. 3° c) y en el art. 14 quáter, que lo vuelve deber de arquitectura y no buena
práctica. Dos cosas que esta sección **no** debe afirmar: que por no guardar nada la ley no aplica
—mientras el rostro vive en memoria hay tratamiento de dato sensible y hace falta consentimiento—,
ni que el puntaje queda fuera de la ley: sigue siendo dato personal, solo deja de ser sensible.

**Lo que el experimento ya respondió** (`docs/results/biometric-degradation.md`, 6000 pares): la
restricción de tamaño del QR cuesta **7,5 puntos de TAR** a FAR 1e-3 — 86,8 % con la foto de 72×96
en 900 B, contra 94,3 % de una plantilla calculada por el emisor desde el retrato original. Y
**5,2 de esos 7,5 puntos se recuperan cambiando la foto a 112×112** dentro del mismo presupuesto
(92,0 %, 888 B), porque es la entrada nativa del modelo. Por eso ADR-16 se implementará comparando
contra la foto del QR, sin plantilla firmada en el core.

**Lo que sigue pendiente, y por qué esta sección aún no afirma una mejora de garantía.** El número
anterior es una **cota inferior medida en condiciones favorables**: sin alineado por puntos
faciales, y con sondas que son fotos de archivo, no fotogramas de cámara en una fila con
contraluz, movimiento y ángulo. Falta además la medición de A15 (`threat-model.md`): cuánto resiste
el comparador a que le muestren una fotografía del titular. Hasta tener eso, lo afirmable es el
costo relativo de la compresión, no el rendimiento en la puerta.

## 5. Clasificación aproximada de nivel de garantía

Usando el marco de NIST SP 800-63-3 como herramienta analítica (no como certificación —Chile no es
jurisdicción NIST—), el **autenticador** se aproxima a **AAL1**: un factor de posesión (la clave
del dispositivo, en software y sin almacén seguro). La **identidad** mejora respecto de la
versión anterior: el guardia compara a la persona con una foto firmada por el emisor, no con una
foto que el portador controla. Pero con un emisor simulado no se puede afirmar un IAL; en un
despliegue real dependería del enrolamiento del Registro Civil. El esquema colombiano, con
biometría activa en cada validación, se aproximaría a un nivel superior (del orden de AAL2/IAL2).
Esta clasificación es orientativa y sirve para ubicar honestamente dónde se sitúa este prototipo
en el espectro de rigor, no como una afirmación regulatoria.

La comparación biométrica de ADR-16 acercaría esta brecha, pero **no se puede descontar todavía**:
mientras no esté implementada y no exista el número de precisión que ADR-16 manda medir, el nivel
de garantía es el descrito arriba. Y aun implementada, sin prueba de vida (ISO/IEC 30107-3) el
comparador no sostiene por sí solo un nivel superior: lo que aporta es reducir el error humano al
comparar rostros, documentado en `attack-experiment.md §4.1`.
