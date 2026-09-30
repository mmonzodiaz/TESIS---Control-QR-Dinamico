# Handoff — `control-acceso-simple` (Prototipo de verificación por QR dinámico)

Este software es el **"Prototipo de verificación por código QR dinámico"** de la tesis de
Magíster en Ciencias de la Computación de Miguel Monzó Díaz (UChile/DCC, prof. guía Eduardo
Godoy, co-guía Alejandro Hevia) — ver `~/OneDrive/Escritorio/HANDOFF_tesis.md` para el estado de
la tesis en sí. Es un componente **independiente** del objetivo específico 5 (bosquejo conceptual
de aplicación), aunque lo demuestra aplicadamente. No interopera con el sistema real del Registro
Civil: sus claves de verificación no son públicas.

Pega este documento como primer mensaje de un chat nuevo si vas a seguir trabajando este
repositorio. No hace falta que subas nada más: el código y los `docs/` ya están en
`C:\Users\mmonz\Develop\Tesis\control-acceso-simple`.

- **Remoto:** https://github.com/mmonzodiaz/TESIS---Control-QR-Dinamico, rama `main`.
- **Última actualización de este handoff:** 2026-09-29.

---

## 0. Encuadre y resultados (leer primero)

> **Estado al cerrar el 2026-09-29:** el prototipo está **completo** para la tesis. El autor decidió
> dejar el código aquí y dedicar el tiempo a redactar. Lo que queda es trabajo de tesis (§7, primeros
> tres puntos) y pruebas del piloto; lo demás son limitaciones declaradas. No empezar funcionalidades
> nuevas sin que el autor lo pida.

- **La cédula es de la persona, no del evento (ADR-13, 2026-09-29).** El autor pidió simular la app
  de Identificación Digital: el teléfono solo tiene la cédula (enrolamiento con el Registro Civil
  simulado, PIN y QR dinámico) y sirve ante cualquier lector autorizado. **No hay activación de
  entradas ni códigos en el teléfono.** El recinto tiene su lista de entradas nominativas por RUT y
  en la puerta coteja el RUT firmado de la cédula (`no_ticket` si no está).

- **Revocación, límite de intentos y contingencia sin conexión (ADR-14, ADR-15, 2026-09-29).**
  Activar la cédula en otro teléfono o reportar la pérdida ("¿Perdiste tu teléfono?") la revoca; el
  Registro Civil publica una lista firmada de revocadas y el recinto rechaza con `revoked`. Login y
  validación tienen límite de intentos. Sin red, el escáner decide con una copia de contingencia de
  hasta 10 min y sincroniza después; el doble ingreso por dos puertas sin red no se evita, se
  detecta como alerta al sincronizar. Sin copia vigente, se deriva a la fila normal.
- **Endurecimiento según OWASP Top 10 (2026-09-29, `docs/security-guarantees.md §1b`).**
  Argon2id, PyJWT con secreto obligatorio de 32+ caracteres, sesiones que se cierran al cambiar la
  contraseña, cabeceras de seguridad y CSP, límites de entrada, registro de seguridad y tests de
  inyección SQL. `pip-audit`, `npm audit` y `bandit` sin hallazgos. Las contraseñas demo cambiaron
  (§3).
- **Escáner del guardia en dos pasos (ADR-12)**, pensado para su celular a pantalla completa: el
  servidor verifica sin registrar, el guardia compara la foto y toca "Dejar pasar" o "No coincide".
  Así una foto que no coincide no quema la entrada del titular (en el experimento, el titular entra
  después del intento del cómplice).
- **Cambio de diseño del 2026-09-29 (ADR-10 y ADR-11, `docs/architecture.md`):** el QR ya no lo
  emite el servidor. Lo **genera el teléfono sin conexión** con la cédula digital (nombre, RUT y
  **foto**, firmados con Ed25519 por un Registro Civil **simulado**), lo firma con la clave del
  dispositivo (su clave pública va firmada dentro de la cédula) y lo **cifra para los lectores
  autorizados**. El escáner lo descifra, verifica y **muestra la foto
  firmada**; después consulta al servidor **sin la foto** (uso único, admisión, prohibiciones). Lo
  pidió el autor: la foto va cargada en el QR al generarlo y **no se sube a la red**, como en la
  cédula digital.
- **Caso de aplicación: eventos masivos** (conciertos, estadios, festivales). Hay `Event`, `Gate`
  (fila `digital`/`normal`) y `Ticket` nominativo (lista de RUT). El asistente no tiene cuenta: en
  `/mi-cedula` activa su cédula digital (RUT + clave de activación ante el Registro Civil simulado,
  luego un PIN de 6 dígitos) y la muestra en la puerta; uso único y anti pass-back (ADR-8).
- **Encuadre acordado con el autor:** el aporte es de **seguridad**. Hoy los eventos leen el QR
  *estático* del carnet físico + verificación visual; un QR dinámico no es reutilizable a partir
  de una copia. La velocidad **no** es el argumento; `docs/queue-model.md` demuestra que la
  validación en línea no alarga las filas (+3 % de espera con latencia realista). La comparación
  ataque por ataque está en `docs/threat-model.md §6`.
- **Fila de cédula digital como incentivo a la adopción** (`docs/queue-model.md §2.5`): es más
  corta porque hoy pocos tienen la cédula digital y se les da una fila preferente, **no** porque
  la verificación sea más rápida (mismo tiempo humano en ambas filas). Ventaja fuerte para quien
  la tiene (~4 s de espera en vez de 40 s), pero requiere 2-12 guardias extra para no perjudicar a
  la fila normal (equidad). Que motive la adopción es una hipótesis de comportamiento, no está
  demostrada. En la puerta, lo que mejora es la **calidad** de la verificación: el guardia mira
  información firmada, más difícil de falsear que el carnet físico.
- **Experimento de ataque** (`docs/attack-experiment.md`), dos niveles. Validación automática: el
  QR estático (emulado, `ENABLE_STATIC_BASELINE=1`) cae en 4 de 5 ataques y el dinámico en 1 de 5
  (reenvío en tiempo real). Con comparación correcta de la foto: 4 de 5 vs. **0 de 5** (el carnet
  falso lleva la foto del atacante; el QR trae la foto firmada del titular). Lo fija
  `tests/test_attack_experiment.py`.
- **Prohibiciones de ingreso** (`routers/bans.py`, A10): extiende el argumento al filtro de hinchas
  sancionados. Validación automática: carnet 2 de 2 evasiones, QR dinámico 1 de 2. Con comparación
  de la foto: 1 de 2 vs. **0 de 2**.
- **Supuesto optimista, ya respaldado con literatura (2026-09-30):** "comparación correcta de la
  foto" es un límite superior. `docs/attack-experiment.md §4.1` resume 18 fuentes verificadas
  (`docs/referencias-comparacion-rostros.bib`): errores del ~15 % aun con la persona en vivo y en
  oficiales de pasaportes, peor con impostores poco frecuentes, fotos antiguas o de baja
  resolución. A favor del sistema: la foto firmada es auténtica (obliga a un impostor parecido) y
  **a color**, mientras que la del carnet va grabada en blanco y negro, y la comparación
  gris/color sesga hacia aceptar al impostor (Bobak et al., 2019). Idea del autor: esa es una
  gracia de la foto de la identificación digital frente a la del carnet, junto con que el QR del
  carnet (URL de vigencia, sin firma ni foto) se puede mostrar en foto o adulterar.
- **Informar a los guías** del cambio (ADR-10 a ADR-15 y el endurecimiento OWASP): reabre dos
  decisiones que estaban cerradas (token opaco sin firma, ADR-1; sin biometría, ADR-5 → ahora foto
  firmada para comparación humana). Revisar la
  frase de `metodologia.tex` que dice que el QR dinámico no es una prueba criptográfica de clave
  pública: ahora hay firmas (ver `docs/security-guarantees.md`).
- **Supuestos no medidos:** el tiempo humano de servicio en la puerta (8 s) y la tasa de llegadas.
  El autor pidió **no invertir en el análisis numérico** (colas, tiempos): la tesis argumenta
  seguridad, no velocidad.
- **La clave de activación simula la ClaveÚnica.** La app real activa con ClaveÚnica más
  verificación facial con prueba de vida; el prototipo reemplaza ambos pasos por un código de 8
  caracteres por persona (hash en el padrón, 401 uniforme, 10 intentos/min). Declararlo en la tesis
  como sustituto simulado; verificar el trámite real en fuentes oficiales antes de describirlo.

## 1. Estado actual

Prototipo funcional. **134/134 tests en verde** (backend 85 + frontend 49), 2026-09-29 — detalle en
§6. Probado de punta a punta en Chrome y con el celular y la pistola lectora del autor: enrolamiento
con el Registro Civil simulado y PIN, QR generado en el teléfono, escáner en dos pasos (cámara,
imagen, pistola en modo teclado y por puerto serie), revocación ("Tu cédula ya no es válida"),
operación sin conexión con sincronización posterior, y la versión de producción con su CSP.

```
c013877 Endurece la aplicacion segun OWASP Top 10
e7d7199 Revocacion de cedulas, limite de intentos y contingencia sin conexion
98c3bbc Renombra la fila rapida a fila de cedula digital y encuadra el modelo de colas en seguridad
6251e98 Cedula digital centrada en la persona, pistola lectora y revision UX/UI
906eed3 Simula la app de cedula digital con PIN y agrega escaner del guardia en dos pasos
2edb92c Permite usar la demo desde el celular: proxy /api y modo HTTPS
a4fd01f Genera el QR en el telefono con la cedula firmada (foto incluida) y cifrada
7b08213 Actualiza nota del handoff tras recrear el .venv del backend
c26e03a Actualiza handoff al caso de eventos masivos y corrige rate limiting en garantias
47b31f8 Agrega experimento de ataque y filtro de prohibiciones de ingreso
1af1271 Modela fila preferente para portadores de cedula digital como incentivo
ccdb99a Agrega prueba de carga y modelo de colas; reencuadra la tesis hacia seguridad
bc71273 Update README to simplify frontend description
cf64894 Adapta el prototipo a eventos masivos con QR por RUT + codigo de entrada
7c2d1eb Actualiza handoff con estado de git y reverificacion de tests
05023fb Amplia cobertura de tests y endurece JWT_SECRET
4df6394 Agrega smoke tests de pytest y checklist de rigor al handoff
9ce478a Prototipo inicial de control de acceso con QR dinamico
```

**Documentación de rigor** en `docs/` (lo que un jurado de Magíster exige):
- `docs/threat-model.md` — modelo de amenazas explícito (actores/ataques A1–A14 con mitigación y
  riesgo residual, lo fuera de alcance y, en §6, la comparación QR estático vs. dinámico).
- `docs/ttl-justification.md` — deriva el TTL de 45 s de dos cotas (usabilidad ajustada por
  arquetipos, exposición a *replay* anclada en RFC 6238), no es un número arbitrario.
- `docs/security-guarantees.md` — qué protege / qué NO protege, controles OWASP Top 10 (§1b) +
  tabla comparativa contra Colombia,
  Uruguay/Perú, ISO/IEC 18013-5, RFC 6238 y la app chilena real (según información pública).
- `docs/architecture.md` — diagramas Mermaid del flujo (cédula y activación, QR en el teléfono,
  verificación, errores y contingencia sin conexión) + ADR-1 a ADR-15 (ADR-1 y ADR-2 reemplazados
  por ADR-11, ADR-7 por ADR-13).
- `docs/queue-model.md` — prueba de carga (`scripts/load_test.py`: 0 dobles concesiones, ~29
  ingresos/s como mínimo) + modelo M/G/1 y ley de Little validado por simulación
  (`scripts/queue_model.py`).
- `docs/attack-experiment.md` — experimento ejecutable de ataques (`scripts/attack_experiment.py`).
- `docs/results/` — salidas generadas (JSON + Markdown) de los tres scripts. Se regeneran corriendo
  los scripts; no editarlas a mano.
- `README.md §Documentacion de rigor` — trazabilidad de cada doc hacia la tesis (`sec:prototipo`,
  capítulo de Resultados) y de cada arquetipo del Anexo A.2 hacia la interfaz.

### Checklist de los 7 requisitos de rigor pedidos originalmente

| # | Requisito | Estado | Dónde |
|---|---|---|---|
| 1 | Modelo de amenazas explícito | ✅ Hecho | `docs/threat-model.md` |
| 2 | Justificación del intervalo del QR | ✅ Hecho | `docs/ttl-justification.md` |
| 3 | Qué protege / qué NO protege | ✅ Hecho | `docs/security-guarantees.md §1-2` |
| 4 | Comparación con Colombia + estándares | ✅ Hecho | `docs/security-guarantees.md §3` (tabla) |
| 5 | Arquitectura end-to-end documentada | ✅ Hecho | `docs/architecture.md` (diagramas + ADRs) |
| 6 | Alimentarse de los arquetipos (n=338) | ✅ Hecho | `CedulaView.tsx` (2 paneles; se muestra dentro de `CedulaPage.tsx` en `/mi-cedula`) + tabla en `README.md` |
| 7 | Responder a barreras reales (activación, aceptación institucional, desconocimiento) | ⚠️ Parcial | Activación y desconocimiento sí (paneles UX); aceptación institucional es una barrera de política pública, no de software — solo se documenta como tal en `docs/architecture.md §6`, no se "resuelve" con código |

El único matiz es el #7: la barrera de "aceptación institucional" no es resoluble desde este
repositorio (ver la recomendación de política pública en `conclu.tex` sobre publicar una interfaz
de verificación abierta).

---

## 2. Decisiones ya tomadas — no volver a preguntarlas

1. **Encuadre objetivo 5 vs. prototipo**: se mantienen **independientes**, tal como ya declara
   `intro.tex` de la tesis (líneas 129–138). El prototipo demuestra aplicadamente las
   recomendaciones del Anexo A.2 (tabla en `README.md`), pero el bosquejo conceptual de objetivo 5
   sigue siendo un entregable propio y más amplio, a redactar aparte en Metodología. No fusionar
   ambos relatos.
2. **REEMPLAZADA el 2026-09-29 — ~~Token opaco, sin firma HMAC (ADR-1)~~.** El autor reabrió la
   decisión: ahora el QR lleva la cédula firmada por el emisor, la firma del dispositivo y va
   cifrado para los lectores autorizados (ADR-11). No volver al token opaco.
3. **TTL = 45 segundos** (ADR-3). Derivado en `docs/ttl-justification.md`. Si se quiere ajustar,
   editar ese documento primero y luego `backend/app/config.py` / `.env` / `.env.example` en
   conjunto — los tres deben quedar sincronizados.
4. **No se buscó ni se usó una versión más actualizada del proyecto LaTeX de la tesis.** La
   comparación en `docs/security-guarantees.md` se escribió con literatura propia (RFC 6238,
   ISO/IEC 18013-5) + las citas de Colombia/Uruguay/Perú de `bibliografia.bib` del zip
   `Título_de_la_Memoria_Tesis.zip` (escritorio). **Ese zip está desactualizado** (falta la
   sección `sec:qr-dinamico` en `estado_del_arte.tex` — ver `HANDOFF_tesis.md §10`). Si el usuario
   trae una versión más nueva, releer `estado_del_arte.tex` completo antes de tocar
   `docs/security-guarantees.md`, para no duplicar ni contradecir lo ya redactado.
5. **Sin biometría automática** (ADR-5; `docs/security-guarantees.md §4`). **Sí hay foto** desde
   ADR-10, para que la compare el guardia. El autor lo dijo explícitamente: nada de biometría, y la
   foto **no se sube a la red ni la guarda el backend**; va firmada dentro del QR generado por el
   usuario y el escáner la decodifica. No reintroducir "foto servida por el backend".
6. **No se integró el arquetipo "Joven desconectado" (17 %)** a la interfaz — brecha reconocida
   en `docs/architecture.md §6` en vez de simular una integración falsa.
7. **Eventos masivos reemplazan al caso residencial** (commit `cf64894`). El rol `resident` y sus
   usuarios demo ya no existen; no reintroducirlos.
8. **La velocidad no es el argumento de la tesis**, la seguridad sí (commit `ccdb99a`). El modelo
   de colas solo demuestra que el QR dinámico no empeora las filas. La fila de cédula digital es
   corta por ser preferente para una minoría, no por un trámite más rápido; por eso se eliminó el
   escenario exploratorio que suponía una verificación acortada a 3 s y la fila se llama "Fila
   cédula digital" (antes "Fila rápida"). La verificación visual podría mejorar, pero lo que se
   sostiene es que la información que mira el guardia es más difícil de falsear.
9. **La línea base de QR estático es solo experimental**: `routers/static_baseline.py` se monta
   únicamente con `ENABLE_STATIC_BASELINE=1` y tiene la misma regla de admisión única que el modo
   dinámico, para aislar una sola variable. No es parte de la propuesta.
10. **La foto la firma un emisor, no la elige el usuario.** Si el usuario pudiera poner cualquier
    foto, el control no serviría. En el prototipo el emisor es `scripts/registro_civil_sim.py`
    (separado del backend del evento, que solo tiene la clave pública).
11. **Firmar y además cifrar**: la firma da autenticidad (nadie fabrica un QR con otra foto) y el
    cifrado da confidencialidad frente a quien fotografía el QR en la fila. Cifrar solo no basta.
12. **La cédula es de la persona, no del evento (ADR-13).** El teléfono simula la app de
    Identificación Digital (enrolamiento, PIN, QR). No reintroducir activación de entradas, códigos
    de entrada ni sesiones del recinto en el teléfono. El recinto coteja el RUT firmado con su
    lista de entradas nominativas.
13. **Escáner en dos pasos (ADR-12)**: el guardia confirma la foto antes de registrar el ingreso.
14. **Revocación por lista firmada del emisor (ADR-14).** Una persona tiene una sola cédula activa:
    activarla en otro teléfono revoca la anterior. La lista publica solo hashes de cada emisión, no
    RUT. Si el Registro Civil no responde, el recinto usa la última lista válida.
15. **Sin red, el escáner sigue operando con una copia de contingencia (ADR-15)**, y sin copia
    vigente (más de 10 min) no deja pasar a nadie: deriva a la fila normal. Lo decidido sin red se
    reverifica al sincronizar y queda como alerta si el servidor no lo habría permitido. El doble
    ingreso por dos puertas sin red es un riesgo residual declarado: se detecta, no se evita.
16. **Endurecimiento según OWASP Top 10** (`docs/security-guarantees.md §1b`). Argon2id y PyJWT en
    vez de passlib y python-jose (vulnerabilidad conocida en `ecdsa`); secreto JWT de 32+ caracteres
    obligatorio (el `.env` usaba el del ejemplo, que es público: se regeneró); sesiones que se cierran
    al cambiar contraseña, rol o estado; política de contraseñas de 12+ caracteres (por eso cambiaron
    las contraseñas demo); cabeceras de seguridad y CSP; límite de tamaño; `/docs` apagado; registro
    de eventos de seguridad. La inyección SQL ya estaba cubierta (todo va parametrizado por
    SQLAlchemy); ahora además hay tests que lo demuestran.

---

## 3. Arquitectura del software (resumen técnico)

- **`backend/`**: FastAPI + SQLAlchemy + SQLite, `uv` para dependencias. JWT con PyJWT
  (`app/security.py`: algoritmo fijo, `iss`/`aud`, claim `ver` = `User.session_version`) y
  contraseñas con Argon2id (`argon2-cffi`; los bcrypt heredados se verifican con `bcrypt` y se
  migran al iniciar sesión). `app/hardening.py`: cabeceras de seguridad y límite de 1 MB por
  solicitud (también en el Registro Civil). `app/audit.py`: registro de seguridad (logger
  `security`, a la salida estándar).
  - Modelos (`app/models.py`): `User` (roles `admin` / `guard`, `session_version`), `Event`, `Gate`, `Ticket` (RUT con
    entrada; sin códigos ni dispositivo), `QRUse` (nonces usados), `QRCheck` (verificaciones
    pendientes de confirmar), `AccessLog` (con `gate_id`, `latency_ms`, el RUT firmado y `offline`
    para lo sincronizado después de una caída), `BannedPerson`.
  - `app/credential.py`: formato de la cédula (v2, con la clave pública del teléfono dentro) y del QR
    (prefijo `CA2:`; Ed25519, X25519 + HKDF + ChaCha20-Poly1305, base45). El mismo formato está en
    `frontend/src/credential.ts`; lo fija `tests/vectors/qr-v2.json` (regenerar con
    `scripts/qr_test_vectors.py` solo si se cambia el formato a propósito).
  - Routers (`app/routers/`): `auth`, `users`, `events` (incluye `GET /events/{id}/verifier`, que
    entrega la clave de lectores autorizados y la pública del emisor, y `GET /events/{id}/contingencia`,
    la copia para operar sin red), `tickets` (lista de RUT), `qr` (`/qr/validate` y `/qr/sync`),
    `logs`, `metrics`, `bans` y `static_baseline` (opcional).
  - `app/revocation.py`: baja la lista de revocadas del Registro Civil (`REGISTRO_CIVIL_URL`),
    verifica la firma y la guarda 30 s. `app/ratelimit.py`: límite de intentos en memoria (login 5/min
    por cuenta y 30/min por IP; validación y sincronización 120/min por guardia; 0 = apagado).
  - Registro Civil simulado (`registro_civil/app.py`, puerto 8001): `POST /enrolar` (RUT + clave de
    activación + clave pública del teléfono → cédula firmada + clave de lectores + hora oficial; revoca
    la cédula anterior de esa persona), `POST /reportar-perdida` (RUT + clave → revoca la activa),
    `GET /revocaciones` (lista firmada) y `GET /hora`. Su padrón (que recuerda cada emisión) y sus
    claves viven en `backend/registro_civil_sim/` (fuera de git). Revocación administrativa:
    `uv run python scripts/registro_civil_sim.py revocar --rut ...`.
  - Flujo: el teléfono se enrola y crea un PIN → genera el QR solo cada 45 s, sin conexión → el
    escáner lo verifica localmente y hace `POST /qr/validate` sin la foto (`check`, luego `admit` o
    `reject`): firmas, revocación, entrada por RUT, vigencia, uso único, anti pass-back,
    prohibiciones. Sin red, decide con la copia de contingencia y envía lo decidido a `/qr/sync`.
  - Motivos de rechazo: `invalid`, `revoked`, `no_ticket`, `banned`, `expired`, `already_used`,
    `already_admitted`, `photo_mismatch`.
  - `app/rut.py`: validación y normalización de RUT (dígito verificador).
  - `scripts/`: `registro_civil_sim.py` (emisor simulado; claves y cédulas en
    `backend/registro_civil_sim/`, ignorado por git porque tiene la clave privada), `qr_clients.py`
    (emuladores de teléfono y escáner para tests y experimentos), `load_test.py`, `queue_model.py`,
    `attack_experiment.py` (escriben en `docs/results/`).
- **`frontend/`**: React + Vite + TypeScript + Tailwind CSS v4 + `lucide-react`. Paleta de marca de
  safest.cl (petróleo `#123f4a` + verde-teal `#0e806c`/`#18aa9c`, tipografía Manrope). Generación
  con `qrcode.react` (nivel L), escaneo con `html5-qrcode` + `BarcodeDetector` (polyfill
  `barcode-detector`, ZXing-C++ en WebAssembly servido localmente). Criptografía con `@noble/*`.
  `src/wallet.ts` guarda en el teléfono la cédula, la clave del dispositivo y la clave de lectores,
  cifradas con el PIN. `src/keyboardWedge.ts`: pistola lectora 2D en modo teclado.
  `src/offline.ts`: decisión sin red con la copia de contingencia y cola de decisiones pendientes
  (`localStorage`, clave `control-acceso-escaner-pendientes`). La sesión del personal va en
  `sessionStorage` (`auth/AuthContext.tsx`) y cualquier 401 devuelve al login (`api.ts`,
  evento `control-acceso:sesion-expirada`). `vite.config.ts`: cabeceras de seguridad y, en
  `preview` (versión de producción), la CSP.
  - Rutas: `/login`, `/mi-cedula` (pública, `CedulaPage` → `CedulaView`; `/mi-entrada` redirige),
    `/escanear` (guard/admin), `/eventos`, `/prohibiciones`, `/usuarios` (admin), `/historial`
    (admin/guard).
- **Datos demo** (creados por `uv run python -m app.seed`):
  - Personal: `admin@demo.cl` / `admin-demo-2026`, `guardia@demo.cl` / `guardia-demo-2026` (fila cédula digital),
    `guardia2@demo.cl` / `guardia-demo-2026` (fila normal).
  - Evento "Concierto Demo - Estadio" con filas "Fila cédula digital A" y "Fila normal B".
  - Las tres personas demo tienen entrada para el evento (lista de RUT, sin códigos).
  - Enrolamiento de la cédula (RUT + clave de activación): `11.111.111-1` + `RCUNO234`,
    `22.222.222-2` + `RCDOS234`, `12.345.678-5` + `RCTRES23`.

## 4. Cómo levantar el proyecto

**Lo más simple: `uv run demo.py`** desde la raíz (o doble clic en `demo.cmd` en Windows). Prepara
todo (dependencias, `backend/.env` con `JWT_SECRET` aleatorio, datos demo, build del frontend),
levanta backend (8000), Registro Civil (8001) y la versión de producción (4173), abre el túnel de
Cloudflare y muestra la URL y las cuentas. Mientras corre, `c` + Enter corta el backend (simula la
caída de la red) y `v` + Enter lo levanta; Ctrl+C lo detiene todo (mata los árboles de procesos, sin
huérfanos). Los servicios se lanzan con `stdin=DEVNULL`: en Windows, heredar la entrada estándar
mientras el hilo de comandos espera una línea colgaba el reinicio del backend. Opciones: `--local` (sin túnel), `--reiniciar` (base de la demo nueva), `--verificar`
(levanta, prueba un login por el túnel y se detiene; probado el 2026-09-29 en ambos modos).
Registros en `.demo-logs/`. Para otro PC: README, "Demo en un solo comando". A mano, paso a paso:

```bash
# Backend
cd backend
uv sync
cp .env.example .env
# En .env, JWT_SECRET es obligatorio (32+ caracteres; el backend no arranca con uno débil):
python -c "import secrets; print(secrets.token_urlsafe(48))"
uv run python -m app.seed
uv run uvicorn app.main:app --port 8000 --no-server-header

# Frontend (otra terminal)
cd frontend
npm install
cp .env.example .env
npm run dev
```

Abrir `http://localhost:5173`. Notas:
- Si cambias `QR_TTL_SECONDS` en `.env`, hay que **reiniciar** `uvicorn` — `pydantic-settings` lo
  lee una sola vez al arrancar.
- Son **tres procesos**: backend del evento (`uv run uvicorn app.main:app --port 8000
  --no-server-header`), Registro Civil simulado (`uv run uvicorn registro_civil.app:app --port 8001
  --no-server-header`) y Vite (`npm run dev`, o `npm run dev:celular`). El frontend llega a ambos por el
  proxy de Vite (`/api`, `/registro-civil`). El backend también consulta al Registro Civil (lista de
  revocadas); si no está arriba, sigue sin revocaciones y lo registra como advertencia.
- **Base de desarrollo creada antes del 2026-09-29:** la columna `access_logs.offline` se agregó a
  mano con `ALTER TABLE access_logs ADD COLUMN offline BOOLEAN NOT NULL DEFAULT 0`. Una base nueva
  (seed) ya la trae.
- **Base de desarrollo creada antes del endurecimiento OWASP:** la columna `users.session_version`
  se agregó con `ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0`, y las
  contraseñas demo se cambiaron a mano (Argon2id). Una base nueva (seed) ya trae todo.
- La documentación interactiva de la API (`/docs`) está apagada; para verla en desarrollo,
  `ENABLE_API_DOCS=1` en `.env`.
- La CSP del frontend solo se aplica en la versión de producción: `npm run build` y luego
  `npx vite preview --port 4173` (el servidor de desarrollo inyecta scripts en línea para recargar).
- El `.env` local del autor tiene un `JWT_SECRET` aleatorio generado el 2026-09-29 (el anterior era
  el público del ejemplo). Cambiarlo cierra todas las sesiones abiertas.
- Las cédulas activadas antes de ADR-14 no figuran en el padrón y no se pueden revocar: para probar
  la revocación, activar la cédula de nuevo en el teléfono.
- El límite de login es por IP: detrás del proxy de Vite todos comparten `127.0.0.1` (30/min).
- **Demo por internet (Cloudflare Tunnel, 2026-09-29):** con backend y Registro Civil arriba,
  `npm run demo` (compila y sirve la versión de producción en 4173, con CSP) y en otra terminal
  `npm run tunel`, que imprime una URL `https://<aleatorio>.trycloudflare.com`. Esa URL funciona
  desde cualquier red, con HTTPS real (sin advertencia de certificado en el celular). Es un túnel
  rápido: sin cuenta ni dominio, y **la URL cambia cada vez**. `cloudflared` se instaló con
  `winget install Cloudflare.cloudflared` (queda en `C:\Program Files (x86)\cloudflared\`).
  Vite acepta `*.trycloudflare.com` solo en `preview` (`allowedHosts`) y su proxy agrega
  `X-Forwarded-For` (`xfwd`), así el límite de intentos ve la IP real de cada visitante (uvicorn
  confía en ese encabezado cuando viene de 127.0.0.1). **Mientras el túnel está abierto, la app es
  pública** y las cuentas y claves demo están en el repositorio: abrirlo solo para presentar, o
  cambiar antes las contraseñas en "Usuarios". Para una URL fija haría falta una cuenta de
  Cloudflare con dominio propio (túnel con nombre). Si queda un `vite preview` viejo escuchando en
  4173 (proceso hijo que sobrevive), `npm run demo` falla con "Port 4173 is already in use":
  cerrar ese `node.exe`.
- **Desde el celular (misma wifi):** `npm run dev:celular` (Vite en la red con HTTPS autofirmado, necesario para
  la cámara). Si no carga, revisar el firewall de Windows para Node en redes privadas.
- Sin webcam: en "Escanear" usar "Leer QR desde una imagen" con una captura del QR.

```bash
# Tests del backend (base de datos temporal propia, no tocan control_acceso.db)
cd backend
uv run python -m pytest tests/ -v

# Tests del frontend
cd frontend
npm run test
```

Si alguna vez `uv run pytest` falla con "uv trampoline failed to canonicalize script path", es
porque el repo se movió de carpeta después de crear el `.venv`: recrearlo con
`rm -rf backend/.venv && uv sync` (ya se hizo el 2026-09-29 tras mover el repo desde
`Develop\Work\`).

### Interfaz (revisión UX/UI del 2026-09-29, skills `identidad-digital` y `artifact-design`)

- **App del ciudadano (`/mi-cedula`)**: marca propia "Mi cédula · Prototipo de tesis" (distinta del
  sistema del recinto, sin copiar la marca del Registro Civil real); pasos del enrolamiento
  (1 de 2, 2 de 2); PIN con puntos y teclado numérico (`components/PinPad.tsx`); la cédula como
  documento en proporción ID-1 con fondo de guilloche, NOMBRE / RUN / EMISIÓN
  (`components/CedulaCard.tsx`); "Mostrar mi QR" como acción principal y QR a pantalla completa con
  aviso de brillo y pantalla encendida (`pages/CedulaView.tsx`).
- **Escáner**: panel del resultado pintado según el veredicto (verde, rojo, azul pendiente, ámbar
  sin conexión), contador de ingresos y rechazos de la sesión, indicador de pistola conectada,
  barra superior en dos filas para celular. Sin red: aviso "Sin conexión · copia de hace N min" (o
  "sin copia vigente"), contador "N por sincronizar", decisión del guardia en ámbar y aviso al
  sincronizar con las alertas. El historial marca "Sin conexión" y "Alerta: ingresó".
- **Teléfono**: al abrir la cédula consulta si fue revocada ("Tu cédula ya no es válida en este
  teléfono"); la pantalla de activación ofrece "¿Perdiste tu teléfono? Desactiva tu cédula".
- **Ortografía**: toda la interfaz y los mensajes del backend con tildes y eñes (antes iban en
  ASCII). Textos del ciudadano en 13-16 px y grises con contraste AA.
- **Pendiente de la revisión**: la app real activa con ClaveÚnica + biometría facial con prueba de
  vida; aquí lo reemplaza la clave de activación (declararlo en la tesis). Faltan modo oscuro y
  pruebas con usuarios reales.

## 5. Bugs ya resueltos (no repetir el diagnóstico)

- `passlib` + `bcrypt>=4.1` eran incompatibles; se resolvió eliminando `passlib` (Argon2id con
  `argon2-cffi`; `bcrypt` 5 solo para verificar hashes heredados). Ya no hay versión fijada de
  `bcrypt`. No reintroducir `passlib` ni `python-jose` (este trae `ecdsa`, con vulnerabilidad
  conocida).
- Comparar `datetime` offset-aware vs. offset-naive rompía la validación de expiración en SQLite
  (SQLite no persiste `tzinfo`). Todo el backend usa `models.py::utcnow()` (UTC naive) — no
  reintroducir `datetime.now(timezone.utc)` directo en ningún router nuevo.
- `Html5Qrcode.stop()` puede lanzar de forma síncrona si la cámara nunca llegó a iniciar, lo que
  rompía la página al desmontar `ScannerPage`. Está envuelto en `try/catch` anidado — no
  simplificar ese bloque sin volver a probar en una máquina sin cámara.
- Pydantic necesita `email-validator` instalado aparte para `EmailStr` — ya está en
  `pyproject.toml`.
- `email-validator` **rechaza dominios `.local`** ("special-use or reserved name"). En datos de
  prueba usa un TLD real como `.cl` (los tests usan `@test.cl`).
- `JWT_SECRET` **no tiene valor por defecto** en `config.py` y se valida al arrancar (32+
  caracteres, nunca el del ejemplo): si falta o es débil, el backend no arranca. `.env.example` lo
  trae vacío con el comando para generarlo. Los tests usan su propio secreto (`conftest.py`).
- Un id enorme en la URL (`/events/99999999999999999999/...`) daba 500 (`OverflowError` de SQLite).
  `main.py` lo convierte en 422. Los campos del QR tienen rango (`schemas.py::UnixTime`,
  `PositiveId`): un `issued_at` de más de 32 bits rompía `struct.pack` al armar la firma.
- FastAPI convierte cualquier error al leer el cuerpo en un 400 genérico: por eso
  `MaxBodySizeMiddleware` responde el 413 él mismo y descarta lo que la app intente enviar después.
- La cabecera `server: uvicorn` la agrega uvicorn fuera de la app: se quita con `--no-server-header`.
- Carrera en `/qr/validate` con varias filas en paralelo: resuelto con un `INSERT` del nonce en
  `qr_uses` (clave primaria) con `ON CONFLICT DO NOTHING`, decidido por `rowcount` (ADR-8). No usar
  `begin_nested()`/SAVEPOINT: el driver `pysqlite` los maneja mal.
- **`html5-qrcode` no lee el QR con foto** (~1,4 KB, versión 21-22) con su decodificador de
  respaldo zxing-js, ni siquiera desde una imagen limpia. Chrome de Windows no tiene
  `BarcodeDetector`. Resuelto con el polyfill `barcode-detector` (`frontend/src/barcodeDetector.ts`)
  y `useBarCodeDetectorIfSupported: true`. No quitarlo.
- Bajo concurrencia alta la prueba de carga da algunos `database is locked` (SQLite, un escritor a
  la vez; ADR-4). Existía antes del cambio; 0 dobles concesiones.

- **`uvicorn --reload` no detectó cambios en esta máquina** (y deja procesos hijos de Python que
  siguen sirviendo el puerto aunque se mate el padre). Tras cambiar el backend, reiniciar los
  servidores a mano y verificar que no quede un `python.exe` hijo escuchando en 8000/8001.
- En el escáner, `{ kind: "final", ...seen }` pisaba el `kind` con el del estado anterior (el
  resultado se quedaba en "¿Es la persona?"). Siempre `{ ...seen, kind: ... }`.
- **Finales de línea:** muchos archivos usan CRLF y otros LF. `sed -i` en Git Bash convierte CRLF a
  LF: al editar con scripts, conservar el final de línea de cada archivo.
- **Pruebas en Chrome con la extensión:** en la versión de producción (`preview`), escribir con el
  teclado simulado a veces no llega a los campos del login; rellenarlos por JavaScript con el setter
  nativo de `value` y un evento `input`. No es un bug de la app.

- **Pistola lectora 2D por puerto serie (USB-COM/RS-232):** no tipea; el escaner la lee con Web
  Serial (boton USB, Chrome/Edge de escritorio, contexto seguro). `serialScanner.ts` arma cada
  lectura por fin de linea o, si no hay, tras 150 ms sin datos. Velocidad por defecto 9600
  (`SERIAL_BAUD_RATE`); las USB-COM suelen ignorarla, un RS-232 real debe coincidir.
- **Pistola lectora 2D (modo teclado):** tipea el QR (~1.400 caracteres) y Enter. Si emula teclado
  de EE. UU. en un Windows en espanol, `:` llega como `Ñ`, `/` como `-`, etc.
  `keyboardWedge.ts::normalizeScannedText` lo detecta por el prefijo `CA2Ñ` y lo corrige. Se escucha
  en fase de captura para que la rafaga no active botones (el espacio es parte de base45).

## 6. Tests

- **Backend** (`uv run python -m pytest tests/ -v`, 85 tests). Usan una base SQLite temporal propia
  y un emisor de prueba (`tests/.issuer/`), nunca los de desarrollo; helpers en `tests/helpers.py`
  y `tests/conftest.py` (reinicia los límites de intentos entre tests y hace que el backend lea las
  revocaciones del Registro Civil de prueba, en proceso y sin caché).
  - `test_qr_flow.py` (17): foto firmada y uso único, la misma cédula sirve en otro evento con
    entrada, cédula válida sin entrada (`no_ticket`), el QR no revela identidad, vencido y fechado
    en el futuro, varios QR vigentes pero un solo ingreso, emisor falso, foto cambiada, cédula
    copiada a otro teléfono, lector no autorizado, anti pass-back, escaneos concurrentes, permisos,
    y los dos pasos de ADR-12 (`check` no consume, "no coincide" no quema la entrada del titular,
    ventana de confirmación, vista previa).
  - `test_credential.py` (6): base45 (RFC 9285), vectores compartidos, alteraciones del QR.
  - `test_tickets.py` (3): RUT, lista de entradas del admin, permisos.
  - `test_queue_model.py` (6): fórmulas de colas (Pollaczek-Khinchine, Little), simulación y fila
    de cédula digital (preferente).
  - `test_logs.py` (5), `test_users.py` (4), `test_bans.py` (2).
  - `test_attack_experiment.py` (2): fija ambos niveles (4/5 vs. 1/5 automático; 4/5 vs. 0/5 con
    foto) y el filtro de prohibiciones.
  - `test_registro_civil.py` (3): enrolamiento (la clave del teléfono queda firmada en la cédula),
    respuesta uniforme, rate limit.
  - `test_revocation.py` (5): activar en otro teléfono revoca el anterior, reporte de pérdida,
    reporte con clave incorrecta, lista firmada a prueba de alteraciones, el backend conserva la
    última lista válida si el Registro Civil cae.
  - `test_offline.py` (7): copia de contingencia, ingreso sin red sincronizado (idempotente), un
    "Dejar pasar" que alcanzó a llegar no se duplica, doble ingreso por dos puertas marcado como
    alerta, prohibición posterior marcada como alerta, "no coincide" sin red, firmas y vencimiento
    reverificados.
  - `test_rate_limits.py` (2): login por cuenta, validaciones por guardia.
  - `test_security.py` (23): OWASP Top 10. Inyección SQL en login y formularios, parámetros fuera
    de rango, tokens falsificados (`alg: none`, otra clave, vencidos, otra audiencia, versión vieja),
    cierre de sesiones al cambiar la contraseña, login sin enumeración de cuentas, migración de
    bcrypt a Argon2id, política de contraseñas, auto-degradación del admin, cabeceras de seguridad,
    `/docs` apagado, límite de tamaño (con y sin `Content-Length`), secreto JWT débil y registro de
    seguridad sin secretos ni líneas falsificadas.
- **Frontend** (`npm run test`, 49 tests con Vitest, en 8 archivos; `serialScanner.test.ts`: pistola por puerto serie; `offline.test.ts`: decisión sin red y copia vencida): `credential.test.ts` (produce
  **el mismo QR byte a byte** que el backend con los vectores compartidos; detecta emisor falso,
  cédula copiada a otro teléfono, foto cambiada y lector no autorizado), `wallet.test.ts` (cédula
  cifrada con PIN, PIN incorrecto, bloqueo por intentos, cédula de otro teléfono),
  `keyboardWedge.test.ts` (pistola lectora), `api.test.ts` (contrato con el backend y mensajes de validación 422),
  `reasons.test.ts` (sin motivos de rechazo huérfanos), `rut.test.ts` (mismos casos que el backend).
- **Sigue sin cubrirse**: componentes React con render real (`CedulaPage`, `ScannerPage`, etc. —
  requeriría `@testing-library/react` + jsdom).

## 7. Pendientes / mejoras no implementadas (declaradas honestamente en la documentación)

- **Informar a los guías** de ADR-10 a ADR-15 y del endurecimiento OWASP, y ajustar
  `metodologia.tex` (ver §0).
- **Declarar en la tesis** que la clave de activación sustituye a ClaveÚnica + verificación facial
  (ver §0).
- **Respaldar con una fuente citable** dos hechos: que la app real de Identificación Digital muestra
  sobre el QR una foto a color y de buena calidad (hoy es observación directa del autor; sirve una
  captura propia o una fuente oficial) y el formato del QR del carnet (URL `docstatus` con RUN y
  serie; hoy viene de fuentes secundarias). Matiz ya documentado (`attack-experiment.md §4.1`): esa
  foto está en la pantalla del titular; lo confiable es la foto que el lector del guardia obtiene
  del QR firmado, como hace el prototipo. La literatura sobre comparación de rostros ya está
  (`docs/attack-experiment.md §4.1`).
- **Probar el escaneo con teléfonos reales**: el QR con foto es denso (versión 21-22). En pruebas
  sintéticas ZXing lo lee desde 3 px por módulo, pero falta medir distancia, brillo y tiempo de
  lectura en la puerta.
- **Medir los supuestos del modelo de colas**: tiempo humano de servicio (8 s) y tasa de llegadas.
  Prioridad baja: la tesis no argumenta velocidad. Más útil sería medir la **calidad** de la
  verificación (si el guardia detecta a un impostor con la foto firmada del escáner).
- **Doble ingreso sin conexión** (ADR-15, A13): dos puertas sin red pueden admitir a la misma
  persona; hoy solo se detecta al sincronizar. Mitigaciones posibles: sincronizar entre lectores
  por red local, o asignar cada RUT a una puerta durante la contingencia.
- **Copia de contingencia con RUT del evento** en la memoria del escáner (y decisiones pendientes en
  `localStorage`): costo de privacidad aceptado para operar sin red.
- **Almacén seguro**: la clave del dispositivo vive en `localStorage` y la clave privada del evento
  se entrega al escáner por la API; en producción irían en almacenes seguros.
- **TLS**: el servidor de desarrollo corre en HTTP plano. Es un requisito de *despliegue* (actor A2
  en `docs/threat-model.md`); recordarlo si se despliega la demo para el jurado.
- **Revocación**: lista completa y firmada (ADR-14), no un servicio de estado estándar (status list,
  OCSP); tarda hasta 30 s en línea y ~70 s sin red; las cédulas activadas antes de ADR-14 no se
  pueden revocar hasta reactivarlas.
- **Límites de intentos en memoria de un solo proceso** (`app/ratelimit.py`): con varias réplicas
  irían en el proxy o en Redis (`docs/security-guarantees.md §2.6`).
- **Autenticación mutua verificador↔titular**: no implementada ni planeada (actor A4, riesgo
  residual explícito).
- **Sesión del personal en `sessionStorage`**, no en cookie `HttpOnly`; sin segundo factor (MFA)
  para el personal; CSP con estilos en línea permitidos (`docs/security-guarantees.md §2.9`).
- **Registro de seguridad a la salida estándar**, sin retención ni alertas centralizadas (§2.10).
- **Tests de render de componentes React** (ver §6).

## 8. Qué llevar a un chat nuevo

1. Este handoff. Para retomar la demo: levantar los tres procesos (§4) y entrar con las cuentas de
   §3 (`guardia@demo.cl` / `guardia-demo-2026` en el PC; la cédula en el celular con
   `npm run dev:celular` y un RUT + clave de activación de §3).
2. Si vas a seguir con la tesis en sí (no el software): `HANDOFF_tesis.md` +
   `Título_de_la_Memoria_Tesis.zip`, ambos en el escritorio — y recuerda que ese zip está
   desactualizado (falta `sec:qr-dinamico`).
3. Si vas a integrar el contenido de `docs/` al capítulo de Resultados: no hace falta traer nada
   más, los documentos son autocontenidos.
