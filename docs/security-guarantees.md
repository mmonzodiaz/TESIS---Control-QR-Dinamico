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
| Foto, nombre y RUT que ve el guardia son auténticos | Firma Ed25519 del emisor (Registro Civil, simulado) sobre RUT, nombre y SHA-256 de la foto | `backend/app/credential.py::check_identity`, `frontend/src/credential.ts::checkIdentity` |
| Un QR no se puede fabricar para una entrada ajena | Cada QR lo firma la clave del dispositivo ligado a la entrada; el servidor verifica esa firma y la del emisor | `backend/app/routers/qr.py::_signatures_ok` |
| Quien fotografía el QR no puede leer los datos personales | Cifrado para la clave pública del evento (X25519 efímera + HKDF-SHA256 + ChaCha20-Poly1305) | `credential.py::build_qr` / `decode_qr` |
| La foto no pasa por el sistema del evento | El backend verifica la firma con el hash de la foto; ni la activación ni la validación envían la foto | `schemas.py::TicketClaimIn`, `QRValidateIn` |
| Un código no se puede usar dos veces | `INSERT` del nonce en `qr_uses` (clave primaria) en la misma transacción que concede el acceso | `backend/app/routers/qr.py::validate_qr` |
| La ventana de reutilización por captura está acotada y justificada | `QR_TTL_SECONDS = 45`, derivado en `docs/ttl-justification.md`, no arbitrario; la hora va firmada | `backend/app/config.py` |
| Todos los QR futuros de una entrada pueden revocarse | Liberar el dispositivo borra su clave pública; ningún QR firmado con ella vuelve a servir | `backend/app/routers/tickets.py::reset_ticket_device` |
| Cada intento (concedido o no) queda auditado | Tabla `AccessLog` con motivo, usuario y verificador | `backend/app/models.py::AccessLog` |
| Solo roles autorizados pueden validar accesos | Verificación de rol `guard`/`admin` vía dependencia de FastAPI | `backend/app/deps.py::require_roles` |

## 2. Qué NO protege — declarado explícitamente para no inflar garantías

1. **Las firmas son reales, pero la infraestructura del emisor es simulada.** Hay verificación de
   firma Ed25519 del emisor y del dispositivo en cada escaneo. Pero el "Registro Civil" es un
   script con una sola clave (`scripts/registro_civil_sim.py`): sin certificados X.509, sin cadena
   de confianza, sin lista de revocación ni rotación de claves. La clave del dispositivo vive en
   `localStorage`, no en un almacén seguro del teléfono. Esto se declara sin ambigüedad porque es
   precisamente el punto que un jurado de Ciencias de la Computación exigirá que no se difumine.
2. **No hay biometría automática.** El guardia compara a la persona con la foto firmada, como hoy
   con el carnet, y puede equivocarse. Cualquiera con el teléfono desbloqueado del titular puede
   mostrar un QR válido; lo que lo delata es que la foto no es la suya, si el guardia lo nota.
   Esto contrasta con el esquema colombiano, que compara biometría en la verificación (§3).
3. **Sin conexión, la verificación es parcial.** El escáner comprueba localmente la cédula (firma
   del emisor), la foto y la vigencia. El uso único, la admisión única y las prohibiciones de
   ingreso necesitan el servidor; sin red, el escáner lo avisa y no puede garantizarlos.
4. **No aporta no repudio ni equivalencia legal de firma.** No hay ningún efecto jurídico asociado
   a un evento de validación, a diferencia de una firma electrónica avanzada.
5. **La confidencialidad de la API depende del despliegue.** El QR va cifrado de extremo a extremo
   hacia el escáner, pero la sesión, las consultas y las claves que recibe el escáner viajan por la
   API, que no impone TLS; es un requisito operacional externo al software (`threat-model.md`, A2).
   Quien obtenga un escáner del personal puede leer los QR de ese evento (A12).
6. **El control de tasa (*rate limiting*) es parcial.** Solo `POST /tickets/claim` lo tiene
   (10 intentos/min por IP, en memoria y en un solo proceso, `deps.py::RateLimiter`), porque es
   donde se podría adivinar por fuerza bruta el código de entrada (A7 en `threat-model.md`). No hay
   límite en `POST /auth/login` ni en `POST /qr/validate` (A5); extenderlo es una mejora futura no
   implementada, declarada así para no sobre-prometer robustez ante abuso automatizado. En
   producción, el límite iría en el proxy o API gateway, no en memoria.
7. **No autentica al verificador ante el titular.** El titular no tiene forma de confirmar que
   quien escanea su código es efectivamente personal autorizado del recinto (ver `threat-model.md`,
   actor A4).

## 3. Comparación explícita con esquemas de referencia

| Dimensión | Este prototipo | Identificación Digital (Chile, según información pública) | Cédula Digital (Colombia) | Uruguay / Perú (documento con PKI) | ISO/IEC 18013-5 (mDL) | RFC 6238 (TOTP) |
|---|---|---|---|---|---|---|
| Revocable del lado del servidor | Sí | Desconocido (no público) | Sí (aplicación oficial) | Parcial (revocación de certificado) | Sí (mecanismos de estado de revocación) | N/A (expira solo) |
| Verificable sin conexión | Parcial: identidad, foto y vigencia sí; uso único y prohibiciones no | Desconocido | No (requiere verificación en línea) | Sí (firma verificable con el certificado) | Sí (diseño explícito para verificación offline) | Sí (algoritmo determinista compartido) |
| Vinculado a biometría del portador | Foto firmada para comparación humana; sin biometría automática (§4) | Sí (verificación facial declarada) | Sí (facial y dactilar) | No (PIN, no biometría) | Frecuente en implementaciones (foto/biometría) | No aplica |
| Autoverificable criptográficamente (firmado) | Sí (Ed25519 del emisor simulado + del dispositivo) | Desconocido | Parcial (arquitectura no pública) | Sí (PKI, certificado X.509) | Sí (firma del emisor sobre el documento) | Sí (HMAC compartido, no PKI) |
| Datos personales del QR protegidos ante terceros | Sí (cifrado para el evento) | Desconocido | Desconocido | No aplica | Sí (sesión cifrada entre dispositivo y lector) | No aplica |
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
