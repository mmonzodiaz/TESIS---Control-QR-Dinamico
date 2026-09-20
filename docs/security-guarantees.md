# Qué protege este mecanismo y qué NO protege

> Complementa `metodologia.tex §Prototipo de verificación`, donde ya queda declarado: *"por sí
> solo, un código QR dinámico no constituye una prueba criptográfica de clave pública equivalente
> a la firma digital"*. Este documento desarrolla esa frase con precisión técnica y la contrasta
> contra sistemas reales.

## 1. Qué SÍ protege (con trazabilidad al código)

| Garantía | Mecanismo | Ubicación |
|---|---|---|
| El identificador del token no es adivinable | UUID v4, ~122 bits de entropía aleatoria | `backend/app/models.py:41` |
| Un código no se puede usar dos veces | Bandera `used` marcada atómicamente en la misma transacción que concede el acceso | `backend/app/routers/qr.py::validate_qr` |
| La ventana de reutilización por captura está acotada y justificada | `QR_TTL_SECONDS = 45`, derivado en `docs/ttl-justification.md`, no arbitrario | `backend/app/config.py` |
| Un código puede revocarse antes de tiempo | Generar un QR nuevo invalida cualquier QR anterior sin usar del mismo usuario | `backend/app/routers/qr.py::generate_qr` |
| Cada intento (concedido o no) queda auditado | Tabla `AccessLog` con motivo, usuario y verificador | `backend/app/models.py::AccessLog` |
| Solo roles autorizados pueden validar accesos | Verificación de rol `guard`/`admin` vía dependencia de FastAPI | `backend/app/deps.py::require_roles` |

## 2. Qué NO protege — declarado explícitamente para no inflar garantías

1. **No es una firma digital ni una prueba criptográfica de posesión de clave privada.** El token
   es un identificador aleatorio verificado contra el estado del servidor (una consulta a base de
   datos), no un objeto autoverificable. No hay PKI, no hay certificado, no hay operación de
   verificación de firma en ningún punto del flujo. Esto se declara sin ambigüedad porque es
   precisamente el punto que un jurado de Ciencias de la Computación exigirá que no se difumine.
2. **No vincula el código a la identidad biométrica de quien lo presenta.** Cualquiera con acceso
   al teléfono desbloqueado del titular durante la ventana de TTL puede mostrar un código válido;
   el sistema no verifica que quien lo presenta sea quien dice ser más allá de la sesión iniciada.
   Esto contrasta directamente con el esquema colombiano (§3).
3. **No es verificable sin conexión.** La validación requiere una consulta al backend en el
   momento del escaneo; no hay ningún dato en el QR que un verificador pueda comprobar
   criptográficamente de forma autónoma.
4. **No aporta no repudio ni equivalencia legal de firma.** No hay ningún efecto jurídico asociado
   a un evento de validación, a diferencia de una firma electrónica avanzada.
5. **La confidencialidad en tránsito depende enteramente del despliegue.** El código no impone
   TLS; es un requisito operacional externo al software (ver `threat-model.md`, actor A2).
6. **No hay control de tasa (*rate limiting*)** sobre los endpoints de autenticación ni de
   validación de QR. Mejora futura no implementada, declarada así para no sobre-prometer robustez
   ante abuso automatizado.
7. **No autentica al verificador ante el titular.** El titular no tiene forma de confirmar que
   quien escanea su código es efectivamente personal autorizado del recinto (ver `threat-model.md`,
   actor A4).

## 3. Comparación explícita con esquemas de referencia

| Dimensión | Este prototipo | Identificación Digital (Chile, según información pública) | Cédula Digital (Colombia) | Uruguay / Perú (documento con PKI) | ISO/IEC 18013-5 (mDL) | RFC 6238 (TOTP) |
|---|---|---|---|---|---|---|
| Revocable del lado del servidor | Sí | Desconocido (no público) | Sí (aplicación oficial) | Parcial (revocación de certificado) | Sí (mecanismos de estado de revocación) | N/A (expira solo) |
| Verificable sin conexión | No | Desconocido | No (requiere verificación en línea) | Sí (firma verificable con el certificado) | Sí (diseño explícito para verificación offline) | Sí (algoritmo determinista compartido) |
| Vinculado a biometría del portador | No (fuera de alcance, §4) | Sí (verificación facial declarada) | Sí (facial y dactilar) | No (PIN, no biometría) | Frecuente en implementaciones (foto/biometría) | No aplica |
| Autoverificable criptográficamente (firmado) | No (identificador opaco) | Desconocido | Parcial (arquitectura no pública) | Sí (PKI, certificado X.509) | Sí (firma del emisor sobre el documento) | Sí (HMAC compartido, no PKI) |
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

## 4. Por qué no se implementó biometría (justificación de alcance, no omisión accidental)

El esquema colombiano liga el QR a una comparación biométrica facial/dactilar en el momento de la
verificación. Este prototipo no lo replica, por tres razones documentadas:

1. **Principio de minimización de datos** ya declarado como valor metodológico de esta tesis
   (`metodologia.tex §Consideraciones éticas`): no recolectar datos sensibles que no sean
   estrictamente necesarios para el objetivo exploratorio del prototipo.
2. **Alcance de prototipo, no de sistema de producción**: implementar reconocimiento facial con
   garantías reales (anti-*spoofing*, precisión aceptable) es un problema de ingeniería aparte,
   fuera del objetivo específico que este componente atiende (demostrar el mecanismo de QR
   dinámico, no construir un sistema biométrico).
3. **Consistencia con el modelo de amenazas**: la suplantación biométrica se declara explícitamente
   fuera de alcance en `threat-model.md §4` precisamente porque no hay biometría que suplantar.

Esta ausencia es, en sí misma, la diferencia estructural más importante frente al esquema
colombiano y debe leerse como tal en la comparación, no como una limitación no reconocida.

## 5. Clasificación aproximada de nivel de garantía

Usando el marco de NIST SP 800-63-3 como herramienta analítica (no como certificación —Chile no es
jurisdicción NIST—), este prototipo se aproxima a **IAL1/AAL1**: baja garantía de identidad
subyacente (un factor: posesión de una sesión autenticada por contraseña), sin verificación de
identidad independiente en el momento de la transacción. El esquema colombiano, al incorporar
verificación biométrica activa en cada validación, se aproximaría a un nivel de garantía superior
(del orden de AAL2/IAL2). Esta clasificación es orientativa y sirve para ubicar honestamente dónde
se sitúa este prototipo en el espectro de rigor, no como una afirmación regulatoria.
