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

- **Caso de aplicación: eventos masivos** (conciertos, estadios, festivales). Hay `Event`, `Gate`
  (fila `rapida`/`normal`) y `Ticket` nominativo. El asistente no tiene cuenta: activa su QR en
  `/mi-entrada` con RUT + código de entrada (ADR-7), con vínculo al dispositivo, consumo atómico y
  anti pass-back (ADR-8).
- **Encuadre acordado con el autor:** el aporte es de **seguridad**. Hoy los eventos leen el QR
  *estático* del carnet físico + verificación visual; un QR dinámico no es reutilizable a partir
  de una copia. La velocidad **no** es el argumento; `docs/queue-model.md` demuestra que la
  validación en línea no alarga las filas (+3 % de espera con latencia realista). La comparación
  ataque por ataque está en `docs/threat-model.md §6`.
- **Fila preferente como incentivo a la adopción** (`docs/queue-model.md §2.5`): ventaja fuerte para
  quien tiene la cédula digital (~4 s de espera en vez de 40 s), pero requiere 2-12 guardias extra
  para no perjudicar a la fila normal (equidad). Que motive la adopción es una hipótesis de
  comportamiento, no está demostrada.
- **Experimento de ataque** (`docs/attack-experiment.md`): el QR estático (emulado,
  `ENABLE_STATIC_BASELINE=1`) cae en 4 de 5 ataques y el dinámico en 1 de 5 (reenvío en tiempo
  real). Lo fija `tests/test_attack_experiment.py`.
- **Prohibiciones de ingreso** (`routers/bans.py`, A10): extiende el argumento más allá del robo de
  entradas, al filtro de hinchas sancionados. Carnet: 2 de 2 evasiones; QR dinámico: 1 de 2 (solo
  con un tercero que coopera, que además pierde su ingreso). ADR-10 es lo que cerraría ese caso.
- **Pendiente de discutir con los guías:** ADR-10, la foto de referencia servida por el backend
  (tensiona la decisión #5 de §2).
- **Supuestos a medir:** el tiempo humano de servicio en la puerta (8 s) y la tasa de llegadas son
  supuestos, no mediciones.

## 1. Estado actual

Prototipo funcional. **52/52 tests en verde** (backend 35 + frontend 17), reverificado el
2026-09-29 — detalle en §6. Working tree limpio y sincronizado con el remoto.

```
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
- `docs/threat-model.md` — modelo de amenazas explícito (actores/ataques A1–A10 con mitigación y
  riesgo residual, lo fuera de alcance y, en §6, la comparación QR estático vs. dinámico).
- `docs/ttl-justification.md` — deriva el TTL de 45 s de dos cotas (usabilidad ajustada por
  arquetipos, exposición a *replay* anclada en RFC 6238), no es un número arbitrario.
- `docs/security-guarantees.md` — qué protege / qué NO protege + tabla comparativa contra Colombia,
  Uruguay/Perú, ISO/IEC 18013-5, RFC 6238 y la app chilena real (según información pública).
- `docs/architecture.md` — diagramas Mermaid del flujo (emisión, verificación, expiración, errores)
  + ADR-1 a ADR-9 implementados y ADR-10 como propuesta.
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
| 6 | Alimentarse de los arquetipos (n=338) | ✅ Hecho | `MyAccessPage.tsx` (2 paneles; se muestra dentro de `ClaimTicketPage.tsx` en `/mi-entrada`) + tabla en `README.md` |
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
2. **Token opaco, sin firma HMAC** (ADR-1): se evaluó firmar el payload del QR y se descartó a
   propósito — no cambia la clasificación de garantía y agrega superficie de implementación sin
   beneficio neto documentable. Si se reabre, hacerlo como extensión explícita, no como "arreglo":
   el diseño actual (UUID v4 verificado contra la base de datos) es intencional.
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
5. **Sin biometría, a propósito** (ADR-5; `docs/security-guarantees.md §4`): minimización de
   datos, alcance de prototipo, consistencia con el modelo de amenazas. ADR-10 (foto de referencia)
   tensiona esta decisión y por eso está como propuesta, no implementado.
6. **No se integró el arquetipo "Joven desconectado" (17 %)** a la interfaz — brecha reconocida
   en `docs/architecture.md §6` en vez de simular una integración falsa.
7. **Eventos masivos reemplazan al caso residencial** (commit `cf64894`). El rol `resident` y sus
   usuarios demo ya no existen; no reintroducirlos.
8. **La velocidad no es el argumento de la tesis**, la seguridad sí (commit `ccdb99a`). El modelo
   de colas solo demuestra que el QR dinámico no empeora las filas.
9. **La línea base de QR estático es solo experimental**: `routers/static_baseline.py` se monta
   únicamente con `ENABLE_STATIC_BASELINE=1` y tiene la misma regla de admisión única que el modo
   dinámico, para aislar una sola variable. No es parte de la propuesta.

---

## 3. Arquitectura del software (resumen técnico)

- **`backend/`**: FastAPI + SQLAlchemy + SQLite, `uv` para dependencias. JWT (`python-jose`) +
  bcrypt (`passlib`).
  - Modelos (`app/models.py`): `User` (roles `admin` / `guard`), `Event`, `Gate`, `Ticket`,
    `QRToken`, `AccessLog` (con `gate_id` y `latency_ms`), `BannedPerson`.
  - Routers (`app/routers/`): `auth`, `users`, `events`, `tickets`, `qr`, `logs`, `metrics`,
    `bans` y `static_baseline` (opcional).
  - Flujo del asistente: `POST /tickets/claim` (RUT + código, 401 uniforme, rate limit por IP,
    vínculo al dispositivo vía `sid` en el JWT) → `POST /qr/generate` (UUID, 45 s, invalida el
    anterior) → el guardia hace `POST /qr/validate` (consumo atómico, anti pass-back, revisa
    prohibiciones en la puerta). Soporte libera un dispositivo con `POST /tickets/{id}/reset`.
  - Motivos de rechazo: `invalid`, `wrong_event`, `banned`, `expired`, `already_used`,
    `already_admitted`.
  - `app/rut.py`: validación y normalización de RUT (dígito verificador).
  - `scripts/`: `load_test.py`, `queue_model.py`, `attack_experiment.py` (escriben en
    `docs/results/`).
- **`frontend/`**: React + Vite + TypeScript + Tailwind CSS v4 + `lucide-react`. Paleta de marca de
  safest.cl (petróleo `#123f4a` + verde-teal `#0e806c`/`#18aa9c`, tipografía Manrope). Escaneo con
  `html5-qrcode`, generación con `qrcode.react`.
  - Rutas: `/login`, `/mi-entrada` (pública, `ClaimTicketPage` → `MyAccessPage`), `/escanear`
    (guard/admin), `/eventos`, `/prohibiciones`, `/usuarios` (admin), `/historial` (admin/guard).
- **Datos demo** (creados por `uv run python -m app.seed`):
  - Personal: `admin@demo.cl` / `admin123`, `guardia@demo.cl` / `guardia123` (fila rápida),
    `guardia2@demo.cl` / `guardia123` (fila normal).
  - Evento "Concierto Demo - Estadio" con filas "Fila rapida A" y "Fila normal B".
  - Entradas (en `/mi-entrada`): `11.111.111-1` + `DEMO2345`, `22.222.222-2` + `DEMO6789`,
    `12.345.678-5` + `DEMOABCD`.

## 4. Cómo levantar el proyecto

```bash
# Backend
cd backend
uv sync
cp .env.example .env
uv run python -m app.seed
uv run uvicorn app.main:app --reload --port 8000

# Frontend (otra terminal)
cd frontend
npm install
cp .env.example .env
npm run dev
```

Abrir `http://localhost:5173`. Notas:
- Si cambias `QR_TTL_SECONDS` en `.env`, hay que **reiniciar** `uvicorn` — `pydantic-settings` lo
  lee una sola vez al arrancar.
- Si existe un `control_acceso.db` de la versión residencial, bórralo antes de sembrar: el esquema
  cambió y `create_all` no migra.
- Sin webcam, activa una entrada en `/mi-entrada` y escanéala desde el celular con
  `npm run dev -- --host`.

```bash
# Tests del backend (base de datos temporal propia, no tocan control_acceso.db)
cd backend
uv run python -m pytest tests/ -v

# Tests del frontend
cd frontend
npm run test
```

**Ojo:** `uv run pytest` (sin `python -m`) falla con "uv trampoline failed to canonicalize script
path" porque el `.venv` se creó cuando el repo estaba en `Develop\Work\`. Usar
`uv run python -m pytest`, o recrear el entorno (`rm -rf backend/.venv && uv sync`) para
arreglarlo de raíz.

## 5. Bugs ya resueltos (no repetir el diagnóstico)

- `passlib` + `bcrypt>=4.1` son incompatibles (`ValueError: password cannot be longer than 72
  bytes...` al arrancar). Está fijado `bcrypt==4.0.1` en `backend/pyproject.toml` — no subir esa
  versión sin volver a probar login.
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
- `JWT_SECRET` **no tiene valor por defecto** en `config.py`: si falta en `.env`/entorno, el
  arranque falla ruidosamente. `.env.example` ya lo trae.
- Carrera en `/qr/validate` con varias filas en paralelo (leer `used` y luego escribir): resuelto
  con `UPDATE ... WHERE used = 0 AND expires_at >= now` decidido por `rowcount` (ADR-8), cubierto
  por `test_concurrent_scans_grant_access_only_once`.

## 6. Tests

- **Backend** (`uv run python -m pytest tests/ -v`, 35 tests). Usan una base SQLite temporal propia,
  nunca la de desarrollo; helpers en `tests/helpers.py` y `tests/conftest.py`.
  - `test_qr_flow.py` (8): flujo completo, expiración, token desconocido, invalidación del QR
    anterior, anti pass-back, evento equivocado, escaneos concurrentes, separación de sesiones
    personal/asistente.
  - `test_tickets.py` (7): RUT, claim con RUT + código, RUT solo no basta y errores uniformes,
    segundo dispositivo, rate limit, creación de evento/fila/entrada, permisos.
  - `test_queue_model.py` (8): fórmulas de colas (Pollaczek-Khinchine, Little), simulación y plan
    de fila preferente.
  - `test_logs.py` (4), `test_users.py` (4), `test_bans.py` (2).
  - `test_attack_experiment.py` (2): fija los resultados 4/5 vs. 1/5 y el filtro de prohibiciones.
- **Frontend** (`npm run test`, 17 tests con Vitest, en 3 archivos): `api.test.ts` (contrato con el
  backend: login form-urlencoded, `Authorization`, body de `/qr/validate`, claim público,
  `ApiError`), `reasons.test.ts` (sin motivos de rechazo huérfanos), `rut.test.ts` (mismos casos
  que el backend).
- **Sigue sin cubrirse**: componentes React con render real (`MyAccessPage`, `ScannerPage`, etc. —
  requeriría `@testing-library/react` + jsdom).

## 7. Pendientes / mejoras no implementadas (declaradas honestamente en la documentación)

- **ADR-10 (foto de referencia servida por el backend)**: propuesta, a discutir con los guías antes
  de implementar (ver §0).
- **Medir los supuestos del modelo de colas**: tiempo humano de servicio (8 s) y tasa de llegadas.
- **TLS**: el servidor de desarrollo corre en HTTP plano. Es un requisito de *despliegue* (actor A2
  en `docs/threat-model.md`); recordarlo si se despliega la demo para el jurado.
- **Rate limiting parcial**: existe en `POST /tickets/claim` (10 intentos/min por IP, en memoria,
  `deps.py::RateLimiter`), pero no en `/auth/login` ni `/qr/validate`. Así lo declaran
  `docs/security-guarantees.md §2.6` y `docs/threat-model.md` (A5, A7).
- **Modo offline**: no existe; toda validación es en línea (ADR-1/ADR-9). El riesgo que queda es la
  conectividad del recinto, no la capacidad del servidor.
- **Autenticación mutua verificador↔titular**: no implementada ni planeada (actor A4, riesgo
  residual explícito).
- **Firma HMAC del payload del QR**: evaluada y descartada a propósito (ver §2.2).
- **Tests de render de componentes React** (ver §6).

## 8. Qué llevar a un chat nuevo

1. Este handoff.
2. Si vas a seguir con la tesis en sí (no el software): `HANDOFF_tesis.md` +
   `Título_de_la_Memoria_Tesis.zip`, ambos en el escritorio — y recuerda que ese zip está
   desactualizado (falta `sec:qr-dinamico`).
3. Si vas a integrar el contenido de `docs/` al capítulo de Resultados: no hace falta traer nada
   más, los documentos son autocontenidos.
