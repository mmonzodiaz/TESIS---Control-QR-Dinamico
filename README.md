# Control de Acceso Simple

Sistema de control de acceso muy simplificado, inspirado en la arquitectura de `SafestAccess` pero reducido a lo esencial: personas, un guardia que escanea en porteria, y **QR dinamico de un solo uso** como mecanismo de acceso.

- `backend/`: API en FastAPI + SQLAlchemy + SQLite. JWT para login.
- `frontend/`: Panel en React + Vite + TypeScript + Tailwind CSS v4 (lucide-react para iconos). Look & feel con la paleta de marca de [safest.cl](https://safest.cl) (petroleo `#123f4a` + verde-teal de acento `#0e806c`/`#18aa9c`, tipografia Manrope), tomada de la referencia de diseno en `safeaccess-redesign`.

## Como funciona el QR dinamico

Cada persona (residente, portero o admin) puede pedir un QR desde "Mi acceso". El backend genera un token aleatorio (UUID) valido por **45 segundos** (`QR_TTL_SECONDS`, valor derivado y justificado en [`docs/ttl-justification.md`](docs/ttl-justification.md), no arbitrario) y lo invalida automaticamente si:
- expira (`expired`),
- ya fue escaneado una vez (`already_used`), o
- no existe (`invalid`).

Al generar un QR nuevo, cualquier QR anterior sin usar de esa persona queda invalidado, para que solo exista un codigo vigente a la vez. El guardia escanea con la camara (pagina "Escanear") y el backend valida y registra el evento en el historial.

## Roles

- **admin**: gestiona usuarios (crear/activar/desactivar/eliminar) y ve el historial.
- **guard** (portero): escanea QRs en la puerta y ve el historial.
- **resident**: solo genera su propio QR de acceso.

## Levantar el backend

```bash
cd backend
uv sync
cp .env.example .env
uv run python -m app.seed   # crea admin/guardia/residentes demo
uv run uvicorn app.main:app --reload --port 8000
```

Usuarios demo (ver salida de `seed`):
- `admin@demo.cl` / `admin123`
- `guardia@demo.cl` / `guardia123`
- `residente1@demo.cl` / `residente123`
- `residente2@demo.cl` / `residente123`

## Levantar el frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Abre `http://localhost:5173`. El escaneo de QR requiere una camara (permiso del navegador); en desktop sin webcam se puede probar generando un QR desde una sesion de residente y escaneandolo desde el celular apuntando a `http://<ip-local>:5173` (usa `npm run dev -- --host`).

## Limitaciones (a proposito, por ser "simplificado")

- Sin zonas/contratos/vehiculos como en SafestAccess real, solo acceso al recinto.
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
| [`docs/security-guarantees.md`](docs/security-guarantees.md) | Que protege / que NO protege + tabla comparativa con Colombia, Uruguay/Peru, ISO/IEC 18013-5, RFC 6238, y la app chilena "Identificacion Digital" (segun informacion publica) | Idem; la tabla es reutilizable directamente en el capitulo |
| [`docs/architecture.md`](docs/architecture.md) | Diagramas de secuencia (emision, verificacion, expiracion, errores) + registro de decisiones de diseno (ADR) | Idem |

### Trazabilidad arquetipos (Anexo A.2) → interfaz

| Arquetipo (encuesta n=338) | % | Recomendacion de diseno (Anexo A.2) | Donde vive en este repo |
|---|---|---|---|
| Mayoria desinformada activa | 47 | Onboarding informativo que explique que es y para que sirve | Panel "Que es esto y para que sirve" en `MyAccessPage.tsx`, expandido la primera vez |
| Adoptante potencial informado | 25 | Onboarding exprés, errores claros, reintento sin reiniciar el proceso | Mensajes de error inline + boton "Reintentar" en `MyAccessPage.tsx`, sin perder el estado de la pantalla |
| Joven desconectado | 17 | Integrar en servicios que ya usa | **No implementado** — excede el alcance de un prototipo standalone; reconocido explicitamente como brecha en `docs/architecture.md §6` |
| Esceptico | 11 | Mensajeria comparativa explicita del valor unico | Panel "En que se diferencia de una clave o contrasena" en `MyAccessPage.tsx` |

Nota importante: por decision explicita ya documentada en `intro.tex` de la tesis, este prototipo
es un entregable **independiente** del objetivo especifico 5 (bosquejo conceptual de aplicacion).
La tabla anterior muestra que el prototipo **demuestra aplicadamente** las recomendaciones del
Anexo A.2, no que las reemplace — el bosquejo conceptual de objetivo 5 sigue siendo un entregable
propio y mas amplio a redactar en el capitulo de Metodologia.
