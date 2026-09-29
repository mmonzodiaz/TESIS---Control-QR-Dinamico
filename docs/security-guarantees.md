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

## 3. Comparación explícita con esquemas de referencia

| Dimensión | Este prototipo | Identificación Digital (Chile, según información pública) | Cédula Digital (Colombia) | Uruguay / Perú (documento con PKI) | ISO/IEC 18013-5 (mDL) | RFC 6238 (TOTP) |
|---|---|---|---|---|---|---|
| Revocable del lado del servidor | Sí: la cédula, por lista firmada del emisor (ADR-14); cada QR además expira solo | Desconocido (no público) | Sí (aplicación oficial) | Parcial (revocación de certificado) | Sí (mecanismos de estado de revocación) | N/A (expira solo) |
| Verificable sin conexión | Parcial: identidad, foto y vigencia siempre; revocación, entrada y prohibiciones con una copia de hasta 10 min; el uso único entre puertas solo al sincronizar (ADR-15) | Desconocido | No (requiere verificación en línea) | Sí (firma verificable con el certificado) | Sí (diseño explícito para verificación offline) | Sí (algoritmo determinista compartido) |
| Vinculado a biometría del portador | Foto firmada para comparación humana; sin biometría automática (§4) | Sí (verificación facial declarada) | Sí (facial y dactilar) | No (PIN, no biometría) | Frecuente en implementaciones (foto/biometría) | No aplica |
| Autoverificable criptográficamente (firmado) | Sí (Ed25519 del emisor simulado + del dispositivo) | Desconocido | Parcial (arquitectura no pública) | Sí (PKI, certificado X.509) | Sí (firma del emisor sobre el documento) | Sí (HMAC compartido, no PKI) |
| Datos personales del QR protegidos ante terceros | Sí (cifrado para lectores autorizados) | Desconocido | Desconocido | No aplica | Sí (sesión cifrada entre dispositivo y lector) | No aplica |
| Ventana de exposición ante *replay* | ~45 s, justificada (`ttl-justification.md`) | No documentada públicamente | No documentada públicamente | No aplica (no es un código rotativo) | No aplica (no es un código rotativo) | 30 s (parámetro estándar) |
| Equivalencia legal / no repudio | No | Sí (declarada por el marco legal chileno) | Sí (misma validez que el documento físico) | Sí (Ley 18.600 Uruguay / IOFE Perú) | Depende de la jurisdicción emisora | No aplica (no es un documento de identidad) |
| Especificación técnica pública | Sí (este repositorio) | No | Parcial (arquitectura general documentada, detalle criptográfico no público) | Parcial | Sí (estándar ISO publicado) | Sí (RFC publicado) |

Fuentes para Colombia: `registraduria_cedula_2024`, `redmas_cedula_2024`,
`registraduria_verificacion_2024` (ya presentes en `bibliografia.bib` de la tesis, sección
`estado_del_arte.tex §Colombia`). Fuentes para Uruguay/Perú: `agesic_cedulachip_2024`,
`agesic_firma_2024`, `reniec_dnie_2024`, `reniec_certificados_2024` (idem). Para Chile, la fila se
basa en la caracterización pública descrita en `docs/ttl-justification.md §4`; para RFC 6238 e
ISO/IEC 18013-5, son citas nuevas que deben incorporarse al `.bib` de la tesis si esta tabla se
traslada al capítulo de Resultados (no se modifica el proyecto LaTeX desde este repositorio).

## 4. Por qué no hay biometría automática (justificación de alcance, no omisión accidental)

El esquema colombiano liga el QR a una comparación biométrica facial/dactilar en el momento de la
verificación. Este prototipo no lo replica. Desde ADR-10 el QR sí trae una **foto firmada**, pero
la compara una persona, igual que hoy con el carnet: no hay reconocimiento facial, ni plantillas
biométricas, y el sistema del evento no recibe ni guarda la foto. No se hace biometría automática
por tres razones documentadas:

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

Esta ausencia es, en sí misma, la diferencia estructural más importante frente al esquema
colombiano y debe leerse como tal en la comparación, no como una limitación no reconocida.

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
