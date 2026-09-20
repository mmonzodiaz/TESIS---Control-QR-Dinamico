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
| A5 | Adivinación o fuerza bruta del identificador del token | Enumerar/adivinar tokens válidos sin poseer uno legítimo | El identificador es un UUID v4 (`models.py:41`), ~122 bits de entropía aleatoria — computacionalmente inviable de adivinar | No hay *rate limiting* implementado sobre `POST /qr/validate` ni sobre `POST /auth/login`; un atacante con acceso a la red podría intentar un volumen alto de solicitudes. Mejora futura no implementada, se declara explícitamente para no sobre-prometer. |
| A6 | Reutilización de un token ya expirado antes de que exista una tarea de limpieza | Enviar un token vencido esperando que la fila "residual" en la base de datos aún se acepte | Cada validación compara `expires_at` contra la hora actual en el momento de la solicitud (`routers/qr.py::validate_qr`), no depende de un job de limpieza | Ninguno relevante: el chequeo es sincrónico e independiente de si la fila fue purgada. |

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
