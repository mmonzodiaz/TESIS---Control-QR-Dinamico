# Control de Acceso Simple — QR dinámico para eventos masivos

Prototipo de verificacion de identidad para el ingreso a **eventos masivos** (conciertos, estadios, festivales) con **QR dinamico de un solo uso**. Hoy en estos eventos se lee el QR **estatico** del carnet fisico y se verifica visualmente a la persona; ese QR se puede fotografiar, copiar o clonar en un carnet falso. La tesis propone un QR que genera el telefono cada 45 s, sirve para un solo ingreso y lleva **la foto, el nombre y el RUT firmados por el Registro Civil y cifrados**, por lo que una copia no sirve y el guardia compara a la persona con una foto autentica: **es mas dificil falsear una credencial digital dinamica que una fisica**. La comparacion ataque por ataque esta en [`docs/threat-model.md §6`](docs/threat-model.md) y se **ejecuta** en [`docs/attack-experiment.md`](docs/attack-experiment.md) (validacion automatica: QR estatico 4 de 5 ataques pasan, QR dinamico 1 de 5; con comparacion correcta de la foto: 4 de 5 vs. 0 de 5). No es solo robo de entradas: tambien dificulta evadir el **filtro de personas con prohibicion de ingreso** (p. ej. hinchas sancionados), que con el carnet se evade con una simple copia del QR de un tercero (seccion "Prohibiciones" del panel y `docs/attack-experiment.md §2.1`), y la medicion de que esto no alarga las filas en [`docs/queue-model.md`](docs/queue-model.md).

- `backend/`: API en FastAPI + SQLAlchemy + SQLite. JWT para el personal (el asistente no tiene cuenta). Firmas Ed25519 y cifrado X25519/ChaCha20-Poly1305 con `cryptography`.
- `frontend/`: React + Vite + TypeScript + Tailwind CSS v4 (lucide-react para iconos). Criptografia con `@noble/*`; lectura de QR con `html5-qrcode` + `barcode-detector` (ZXing-C++ en WebAssembly).
  
## Como funciona

1. **Cedula digital (como la app de Identificacion Digital)**: en `/mi-cedula` el telefono se enrola en el Registro Civil (aqui **simulado**, `backend/registro_civil/app.py`) con RUT + clave de activacion (simula la ClaveUnica) y recibe su cedula firmada con Ed25519 (nombre, RUT, foto y la clave publica del telefono). La guarda cifrada con un **PIN de 6 digitos**, que se pide cada vez que se abre. El sistema del evento solo conoce la clave publica del emisor.
2. **Entradas nominativas**: el admin crea el evento, sus filas (`digital`/`normal`) y la lista de RUT con entrada. No hay codigos ni activacion en el telefono: la cedula es de la persona, no del evento (ADR-13).
3. **Uso diario**: la persona abre su cedula con el PIN; no necesita red ni hablar con el recinto.
4. **QR dinamico, generado en el telefono sin conexion**: cada **45 segundos** (`QR_TTL_SECONDS`, justificado en [`docs/ttl-justification.md`](docs/ttl-justification.md)) el telefono arma un QR con la cedula firmada (foto incluida), lo firma con su clave y lo cifra para los lectores autorizados (ADR-10, ADR-11). Sirve en cualquier recinto.
5. **Ingreso**: el guardia abre "Escanear" en su celular (camara a pantalla completa) o en un PC con webcam o con una **pistola lectora 2D**: en modo teclado (`frontend/src/keyboardWedge.ts`, corrige sola la distribucion de teclado EE. UU./espanol) o por **puerto serie** con el boton USB del escaner (Web Serial, Chrome/Edge de escritorio, `frontend/src/serialScanner.ts`), elige evento + fila y escanea (o carga una imagen del QR). El escaner descifra y verifica la cedula localmente y **muestra la foto, el nombre y el RUT firmados**; el servidor coteja el RUT firmado con la lista de entradas y verifica, sin la foto, uso unico, admision y prohibiciones **sin registrar todavia el ingreso**. El guardia compara la foto con la persona y toca **"Dejar pasar"** (se registra) o **"No coincide"** (se rechaza sin quemar la entrada del titular) (ADR-12). Motivos de rechazo: `expired`, `already_used`, `invalid`, `revoked` (cedula revocada, ADR-14), `already_admitted` (anti pass-back), `no_ticket` (sin entrada para ese evento), `banned` y `photo_mismatch`.
6. **Revocacion (ADR-14)**: una persona tiene una sola cedula activa. Activarla en otro telefono revoca la anterior, y si se pierde el telefono se desactiva desde otro dispositivo con "¿Perdiste tu telefono?" (`POST /reportar-perdida`). El Registro Civil publica una lista firmada de revocadas (`GET /revocaciones`, solo hashes); el recinto la consulta y el telefono avisa si su cedula ya no vale.
7. **Sin conexion (ADR-15)**: mientras hay red, el escaner baja cada minuto una copia de contingencia del evento (`GET /events/{id}/contingencia`). Sin red decide con ella (revocadas, prohibiciones, entradas, ya ingresados) y el guardia compara la foto; lo decidido se envia a `POST /qr/sync` al volver la red, que lo reverifica y marca como alerta lo que no se habria permitido. Sin copia de los ultimos 10 min, no deja pasar: se deriva a la fila normal.
8. **Medicion**: "Historial" muestra por fila escaneos, concedidos, rechazos, escaneos/min y latencia p50/p95.
9. **Costo en la fila**: [`docs/queue-model.md`](docs/queue-model.md) mide la capacidad del servidor (`backend/scripts/load_test.py`: 0 dobles concesiones bajo carga, ~29 ingresos/s como minimo) y estima con teoria de colas (M/G/1 + ley de Little, validado por simulacion) cuanto alarga la espera la validacion en linea (`backend/scripts/queue_model.py`): **+3 % en la punta con latencia realista**. Tambien cuantifica una **fila de cedula digital** (preferente mientras pocos la tengan; el tramite no es mas rapido) como incentivo a la adopcion: ~4 s de espera en vez de 40 s, a cambio de 2-12 guardias extra para que la fila normal no empeore (`docs/queue-model.md §2.5`).

## Roles

- **admin**: eventos, filas, lista de RUT con entrada (agregar, quitar), prohibiciones de ingreso, personal e historial/metricas.
- **guard**: escanea en su fila y ve historial/metricas.
- **asistente** (sin cuenta): tiene su cedula digital (con PIN) y muestra su QR; su RUT figura en la lista de entradas.

## Levantar el backend

```bash
cd backend
uv sync
cp .env.example .env        # y completa JWT_SECRET: python -c "import secrets; print(secrets.token_urlsafe(48))"
uv run python -m app.seed   # crea personal, evento demo, filas, entradas y el padron del Registro Civil
uv run uvicorn app.main:app --port 8000 --no-server-header

# Registro Civil simulado (otra terminal): enrolamiento de la cedula digital
uv run uvicorn registro_civil.app:app --port 8001 --no-server-header
```

Tests (smoke test del flujo de QR, usa una base de datos temporal propia):

```bash
uv run python -m pytest tests/ -v
```

Datos demo (ver salida de `seed`):
- Personal: `admin@demo.cl` / `admin-demo-2026`, `guardia@demo.cl` / `guardia-demo-2026`, `guardia2@demo.cl` / `guardia-demo-2026`
- Cedula digital (activar en `/mi-cedula`, RUT + clave de activacion): `11.111.111-1` + `RCUNO234`, `22.222.222-2` + `RCDOS234`, `12.345.678-5` + `RCTRES23` (retratos sinteticos)
- Las tres personas tienen entrada para el "Concierto Demo - Estadio" (lista de RUT en Eventos).
- Para inscribirte con tu propia foto: `uv run python scripts/registro_civil_sim.py agregar --nombre "Ana Perez" --rut 12.345.678-5 --foto ana.jpg` (imprime tu clave de activacion)

La carpeta `backend/registro_civil_sim/` tiene la clave privada del emisor simulado: esta en `.gitignore` y no debe publicarse.

Si tienes una base `control_acceso.db` de una version anterior (residencial, o con el QR generado por el servidor), borrala antes de sembrar: el esquema cambio y `create_all` no migra.

## Levantar el frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Tests (Vitest, sin navegador — cubren el contrato con el backend en `api.ts`):

```bash
npm run test
```

Abre `http://localhost:5173`. El frontend llama a `/api` y Vite lo reenvia al backend (`vite.config.ts`), asi que solo hay que exponer Vite.

**Desde el celular** (misma red wifi): `npm run dev:celular` levanta Vite en la red con HTTPS autofirmado, porque el navegador del celular solo da acceso a la camara (escaner) en HTTPS. Abre la URL `Network` que imprime (p. ej. `https://192.168.1.81:5173`) y acepta la advertencia del certificado. El backend sigue en `localhost:8000`. Si no carga, revisa que el firewall de Windows permita conexiones entrantes a Node en redes privadas. Sin camara, en "Escanear" esta **"Leer QR desde una imagen"**.

## Seguridad de la aplicacion (OWASP Top 10)

Detalle y trazabilidad en `docs/security-guarantees.md` (seccion 1b); tests en `backend/tests/test_security.py`.

- **Inyeccion SQL**: todas las consultas van parametrizadas por SQLAlchemy; todo texto de entrada tiene largo maximo.
- **Contrasenas**: Argon2id, 12 a 128 caracteres; el login no revela si la cuenta existe.
- **Sesiones**: JWT (PyJWT) con secreto obligatorio de 32+ caracteres, algoritmo fijo, emisor y audiencia; se cierran al cambiar la contrasena, el rol o desactivar la cuenta. En el navegador, en `sessionStorage`.
- **HTTP**: cabeceras de seguridad y CSP, limite de 1 MB por solicitud, `/docs` apagado (`ENABLE_API_DOCS=1` para verlo), CORS acotado.
- **Auditoria**: registro de eventos de seguridad (logins, bloqueos, accesos denegados, cambios de usuarios) sin secretos.
- **Dependencias**: `pip-audit`, `npm audit` y `bandit` sin hallazgos.

## Limitaciones (a proposito, por ser "simplificado")

- Sin venta de entradas: el admin carga a mano la lista de RUT con entrada de cada evento.
- Sin red, el escaner decide con una copia de contingencia de hasta 10 min: no sabe quien entro por **otra** puerta durante la caida, asi que un doble ingreso se detecta al sincronizar, no se evita (ADR-15).
- Limite de intentos en memoria de un solo proceso (login 5/min por cuenta y 30/min por IP; 120 validaciones/min por guardia).
- El Registro Civil es simulado: una sola clave, sin certificados; la revocacion es una lista firmada simple (ADR-14) y la clave de activacion reemplaza a la ClaveUnica. La cedula y la clave del telefono se guardan cifradas con el PIN en `localStorage`, no en un almacen seguro.
- La foto la compara el guardia: no hay biometria automatica (ADR-5).
- Sin app movil nativa; el QR se muestra en el navegador.
- Base de datos SQLite (no pensado para produccion multi-usuario concurrente pesada).

## Documentacion de rigor (componente de tesis)

Este software es el **"Prototipo de verificacion por codigo QR dinamico"** de una tesis de
Magister en Ciencias de la Computacion (UChile/DCC) — un componente exploratorio adicional,
independiente del "bosquejo conceptual de aplicacion" del objetivo especifico 5 (ver
`docs/threat-model.md` para el detalle de esa distincion). La carpeta [`docs/`](docs/) contiene el
analisis que un jurado de Magister exige y que no vive en el codigo:

| Documento | Contenido | Destino sugerido en la tesis |
|---|---|---|
| [`docs/threat-model.md`](docs/threat-model.md) | Actores/ataques en alcance y fuera de alcance | Capitulo de Resultados, junto a la arquitectura del prototipo (`sec:prototipo`) |
| [`docs/ttl-justification.md`](docs/ttl-justification.md) | Derivacion del TTL de 45s (piso de usabilidad vs. techo de exposicion a *replay*) | Idem, subseccion de decisiones de diseno |
| [`docs/security-guarantees.md`](docs/security-guarantees.md) | Que protege / que NO protege, controles OWASP Top 10 + tabla comparativa con Colombia, Uruguay/Peru, ISO/IEC 18013-5, RFC 6238, y la app chilena "Identificacion Digital" (segun informacion publica) | Idem; la tabla es reutilizable directamente en el capitulo |
| [`docs/architecture.md`](docs/architecture.md) | Diagramas de secuencia (cedula y activacion, generacion del QR en el telefono, verificacion, errores) + registro de decisiones de diseno (ADR-1 a ADR-15) | Idem |

### Trazabilidad arquetipos (Anexo A.2) → interfaz

| Arquetipo (encuesta n=338) | % | Recomendacion de diseno (Anexo A.2) | Donde vive en este repo |
|---|---|---|---|
| Mayoria desinformada activa | 47 | Onboarding informativo que explique que es y para que sirve | Panel "Que es esto y para que sirve" en `CedulaView.tsx`, expandido la primera vez |
| Adoptante potencial informado | 25 | Onboarding exprés, errores claros, reintento sin reiniciar el proceso | Mensajes de error inline + reintento sin perder el estado de la pantalla en `CedulaPage.tsx` |
| Joven desconectado | 17 | Integrar en servicios que ya usa | **No implementado** — excede el alcance de un prototipo standalone; reconocido explicitamente como brecha en `docs/architecture.md §6` |
| Esceptico | 11 | Mensajeria comparativa explicita del valor unico | Panel "En que se diferencia de una clave o contrasena" en `CedulaView.tsx` |

Nota importante: por decision explicita ya documentada en `intro.tex` de la tesis, este prototipo
es un entregable **independiente** del objetivo especifico 5 (bosquejo conceptual de aplicacion).
La tabla anterior muestra que el prototipo **demuestra aplicadamente** las recomendaciones del
Anexo A.2, no que las reemplace — el bosquejo conceptual de objetivo 5 sigue siendo un entregable
propio y mas amplio a redactar en el capitulo de Metodologia.
