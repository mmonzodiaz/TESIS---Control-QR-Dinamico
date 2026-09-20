# Handoff — `control-acceso-simple` (Prototipo de verificación por QR dinámico)

Este software es el **"Prototipo de verificación por código QR dinámico"** de la tesis de
Magíster en Ciencias de la Computación de Miguel Monzó Díaz (UChile/DCC, prof. guía Eduardo
Godoy, co-guía Alejandro Hevia) — ver `~/OneDrive/Escritorio/HANDOFF_tesis.md` para el estado de
la tesis en sí. Es un componente **independiente** del objetivo específico 5 (bosquejo conceptual
de aplicación), aunque lo demuestra aplicadamente. No interopera con el sistema real del Registro
Civil: sus claves de verificación no son públicas.

Pega este documento como primer mensaje de un chat nuevo si vas a seguir trabajando este
repositorio. No hace falta que subas nada más: el código y los `docs/` ya están en
`C:\Users\mmonz\Develop\Work\control-acceso-simple`.

---

## 1. Estado actual

Prototipo funcional, probado de punta a punta (backend por API con `curl`, frontend en
navegador con Chrome DevTools vía MCP). Compila limpio: `uv sync` sin errores, `npx tsc -b` sin
errores, `npm run build` sin errores (un solo warning de tamaño de chunk por `html5-qrcode`, no es
un problema funcional). **22/22 tests en verde** (`pytest` 12 + `vitest` 10), reverificado ahora.

Repositorio git local inicializado, **3 commits, working tree limpio, sin remoto** (ver §7):

```
05023fb Amplia cobertura de tests y endurece JWT_SECRET
4df6394 Agrega smoke tests de pytest y checklist de rigor al handoff
9ce478a Prototipo inicial de control de acceso con QR dinamico
```

**Documentación de rigor ya escrita** en `docs/` (esto es lo que un jurado de Magíster exige y
antes no existía):
- `docs/threat-model.md` — modelo de amenazas explícito (6 actores/ataques en alcance con
  mitigación y riesgo residual, más lo explícitamente fuera de alcance).
- `docs/ttl-justification.md` — deriva el TTL de 45s de dos cotas (usabilidad ajustada por
  arquetipos, exposición a *replay* anclada en RFC 6238), no es un número arbitrario.
- `docs/security-guarantees.md` — qué protege / qué NO protege + tabla comparativa explícita
  contra Colombia, Uruguay/Perú, ISO/IEC 18013-5, RFC 6238 y la app chilena real (según
  información pública).
- `docs/architecture.md` — diagramas Mermaid del flujo real (emisión, verificación, expiración,
  errores) + 6 ADRs justificando decisiones de diseño ya implementadas.
- `README.md §Documentacion de rigor` — tabla de trazabilidad que cruza cada doc/carpeta con el
  label de destino en la tesis (`sec:prototipo`, capítulo de Resultados) y cada arquetipo del
  Anexo A.2 con el elemento de interfaz que lo demuestra.

**Tests automatizados**: 12 en backend (`pytest`) + 10 en frontend (`vitest`) — ver detalle en
§6. No es cobertura exhaustiva (sin tests de render de componentes React), pero ya cubre flujo de
QR, `/users`, `/logs` y el contrato cliente-servidor de `api.ts`. Verificación previa a esto era
solo manual (`curl` + navegador).

### Checklist de los 7 requisitos de rigor pedidos originalmente

| # | Requisito | Estado | Dónde |
|---|---|---|---|
| 1 | Modelo de amenazas explícito | ✅ Hecho | `docs/threat-model.md` |
| 2 | Justificación del intervalo del QR | ✅ Hecho | `docs/ttl-justification.md` |
| 3 | Qué protege / qué NO protege | ✅ Hecho | `docs/security-guarantees.md §1-2` |
| 4 | Comparación con Colombia + estándares | ✅ Hecho | `docs/security-guarantees.md §3` (tabla) |
| 5 | Arquitectura end-to-end documentada | ✅ Hecho | `docs/architecture.md` (diagramas + ADRs) |
| 6 | Alimentarse de los arquetipos (n=338) | ✅ Hecho | `MyAccessPage.tsx` (2 paneles) + tabla en `README.md` |
| 7 | Responder a barreras reales (activación, aceptación institucional, desconocimiento) | ⚠️ Parcial | Activación y desconocimiento sí (paneles UX); aceptación institucional es una barrera de política pública, no de software — solo se documenta como tal en `docs/architecture.md §6`, no se "resuelve" con código |

No pendiente ningún punto de los 7 sin al menos una respuesta explícita — el único matiz es el
#7, donde la barrera de "aceptación institucional" es, por naturaleza, no resoluble desde este
repositorio (ver la recomendación de política pública ya escrita en `conclu.tex` sobre publicar
una interfaz de verificación abierta).

---

## 2. Decisiones ya tomadas — no volver a preguntarlas

1. **Encuadre objetivo 5 vs. prototipo**: se mantienen **independientes**, tal como ya declara
   `intro.tex` de la tesis (líneas 129–138). El prototipo demuestra aplicadamente las
   recomendaciones del Anexo A.2 (tabla en `README.md`), pero el bosquejo conceptual de objetivo 5
   sigue siendo un entregable propio y más amplio, a redactar aparte en Metodología. No fusionar
   ambos relatos.
2. **Token opaco, sin firma HMAC**: se evaluó agregar una firma HMAC sobre el payload del QR
   (para que fuera parcialmente autoverificable) y se descartó a propósito (ADR-1 en
   `docs/architecture.md`) — no cambia la clasificación de garantía del sistema y agrega
   superficie de implementación sin beneficio neto documentable. Si en el futuro se quiere
   reabrir esta decisión, hacerlo como una extensión explícita, no como "arreglo" de algo que
   esté mal — el diseño actual (UUID v4 verificado contra la base de datos) es intencional y está
   documentado como tal.
3. **TTL = 45 segundos** (antes 60s, arbitrario). Derivado en `docs/ttl-justification.md`. Si se
   quiere ajustar, hacerlo editando ese documento primero y luego `backend/app/config.py` /
   `.env` / `.env.example` en conjunto — los tres deben quedar sincronizados (ya está así ahora).
4. **No se buscó ni se usó una versión más actualizada del proyecto LaTeX de la tesis.** El
   usuario no compartió una versión más reciente cuando se le preguntó. La comparación en
   `docs/security-guarantees.md` se escribió con literatura propia (RFC 6238, ISO/IEC 18013-5) +
   las citas de Colombia/Uruguay/Perú que ya existían en `bibliografia.bib` del zip
   `Título_de_la_Memoria_Tesis.zip` (escritorio). **Ese zip está confirmado como desactualizado**
   (falta la sección `sec:qr-dinamico` en `estado_del_arte.tex`, referenciada pero rota — ver
   `HANDOFF_tesis.md §10`). Si el usuario trae una versión más nueva de la tesis, releer
   `estado_del_arte.tex` completo antes de tocar `docs/security-guarantees.md`, porque podría
   haber contenido ya redactado sobre la comparación con Colombia que no debe duplicarse ni
   contradecirse.
5. **Sin biometría, a propósito** (no es una omisión) — justificado en
   `docs/security-guarantees.md §4`: minimización de datos, alcance de prototipo, consistencia
   con el modelo de amenazas.
6. **No se integró el arquetipo "Joven desconectado" (17%)** a la interfaz — se documentó como
   brecha reconocida explícitamente en `docs/architecture.md §6` en vez de simular una integración
   falsa con "servicios que ya usa", porque eso excede lo que un prototipo standalone puede hacer
   honestamente.

---

## 3. Arquitectura del software (resumen técnico)

- **`backend/`**: FastAPI + SQLAlchemy + SQLite, `uv` para gestión de dependencias. JWT
  (`python-jose`) + bcrypt (`passlib`). Roles `admin` / `guard` / `resident`
  (`backend/app/models.py::Role`). Endpoints clave: `POST /qr/generate`, `POST /qr/validate`,
  `GET /logs` (ver `backend/app/routers/qr.py` y `logs.py`).
- **`frontend/`**: React + Vite + TypeScript + Tailwind CSS v4 + `lucide-react`. Paleta de marca
  de safest.cl (petróleo `#123f4a` + verde-teal `#0e806c`/`#18aa9c`, tipografía Manrope), tomada de
  la referencia de diseño `safeaccess-redesign` (otro proyecto, ya no se necesita volver a leerlo).
  Escaneo de QR con `html5-qrcode`, generación con `qrcode.react`.
- **Usuarios demo** (creados por `uv run python -m app.seed`):
  - `admin@demo.cl` / `admin123`
  - `guardia@demo.cl` / `guardia123`
  - `residente1@demo.cl` / `residente123`
  - `residente2@demo.cl` / `residente123`

## 4. Cómo levantar el proyecto

```bash
# Backend
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8000

# Frontend (otra terminal)
cd frontend
npm install
npm run dev
```

Abrir `http://localhost:5173`. Nota: si cambias `QR_TTL_SECONDS` en `.env`, hay que **reiniciar**
`uvicorn` — `pydantic-settings` lo lee una sola vez al arrancar, no hay hot-reload de config.

```bash
# Tests del backend (usan su propia base de datos temporal, no tocan control_acceso.db)
cd backend
uv run pytest tests/ -v
```

## 5. Bugs ya resueltos (no repetir el diagnóstico)

- `passlib` + `bcrypt>=4.1` son incompatibles (`ValueError: password cannot be longer than 72
  bytes...` al arrancar). Ya está fijado `bcrypt==4.0.1` en `backend/pyproject.toml` — no subir esa
  versión sin volver a probar login.
- Comparar `datetime` offset-aware vs. offset-naive rompía la validación de expiración en SQLite
  (SQLite no persiste `tzinfo`). Ya resuelto: todo el backend usa `models.py::utcnow()` (UTC
  naive) de forma consistente — no reintroducir `datetime.now(timezone.utc)` directo en ningún
  router nuevo.
- `Html5Qrcode.stop()` puede lanzar de forma síncrona si la cámara nunca llegó a iniciar (p. ej. no
  hay webcam), lo que rompía la página al desmontar `ScannerPage`. Ya está envuelto en
  `try/catch` anidado — no simplificar ese bloque sin volver a probar en una máquina sin cámara.
- Pydantic necesita `email-validator` instalado aparte para `EmailStr` — ya está en
  `pyproject.toml`.
- `email-validator` **rechaza dominios `.local`** por considerarlos de uso especial/reservado
  (error: "special-use or reserved name"). Si escribes datos de prueba con emails falsos, usa un
  TLD real como `.cl` o `.com` (los tests usan `@test.cl`), no `.local`/`.test`/`.invalid`.
- `JWT_SECRET` ya **no tiene valor por defecto** en `config.py` (antes era el string de ejemplo
  hardcodeado) — si falta en `.env`/entorno, el arranque falla ruidosamente en vez de servir con
  un secreto de ejemplo conocido públicamente. `.env` y `.env.example` ya lo traen seteado, no
  requiere acción salvo que borres esas líneas.

## 6. Tests (ampliados, ya no es solo el flujo de QR)

- **Backend** (`uv run pytest tests/ -v`, 12 tests): flujo de QR completo (`test_qr_flow.py`),
  CRUD y permisos de `/users` (`test_users.py`), permisos y contenido de `/logs`
  (`test_logs.py`). Helpers compartidos en `tests/helpers.py`. Usan una base SQLite temporal
  propia (`tests/test_control_acceso.db`, se borra sola al terminar), nunca la de desarrollo.
- **Frontend** (`npm run test`, 10 tests con Vitest): `src/api.test.ts` verifica el contrato con
  el backend (login como form-urlencoded no JSON, headers de `Authorization`, body JSON de
  `/qr/validate`, manejo de `ApiError`); `src/reasons.test.ts` evita que `ScannerPage.tsx` /
  `LogsPage.tsx` queden con motivos de QR sin etiqueta si el backend agrega uno nuevo.
- **Sigue sin cubrirse**: componentes React con render real (`MyAccessPage`, `ScannerPage`, etc. —
  requeriría `@testing-library/react` + jsdom, no se agregó por alcance) y los endpoints
  `/auth/me` y `PATCH /users/{id}` con payloads parciales más exóticos.

## 7. Pendientes / mejoras no implementadas (declaradas honestamente en la documentación, no ocultas)

- **TLS**: el servidor de desarrollo corre en HTTP plano. Es un requisito de *despliegue*, no del
  código (ver `docs/threat-model.md`, actor A2) — no hay nada que implementar en este repo, pero
  hay que recordarlo en el capítulo si se despliega la demo para el jurado.
- **Rate limiting**: no implementado en `/auth/login` ni `/qr/validate`. Declarado como mejora
  futura en `docs/security-guarantees.md §2.6`.
- **Autenticación mutua verificador↔titular**: no implementada ni planeada para este prototipo
  (actor A4 en `docs/threat-model.md`, riesgo residual explícito).
- **Firma HMAC del payload del QR**: evaluada y descartada a propósito (ver §2.2 arriba).
- **Repositorio git solo local**: no hay remoto configurado (ni GitHub ni otro), sin respaldo
  fuera de esta máquina. No se creó un remoto porque implica una acción de publicación que
  requiere confirmación explícita del usuario, no algo para decidir unilateralmente.

## 8. Qué llevar a un chat nuevo

1. Este handoff.
2. Si vas a seguir con la tesis en sí (no el software): `HANDOFF_tesis.md` +
   `Título_de_la_Memoria_Tesis.zip`, ambos en el escritorio — y recuerda que ese zip está
   desactualizado (falta `sec:qr-dinamico`).
3. Si vas a integrar el contenido de `docs/` al capítulo de Resultados: no hace falta traer nada
   más, los cuatro documentos son autocontenidos y están listos para transcribir/adaptar.
