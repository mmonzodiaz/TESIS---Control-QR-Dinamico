# Control de Acceso Simple — QR dinámico para eventos masivos

Prototipo de control de ingreso a **eventos masivos** (conciertos, estadios, festivales) con **QR dinamico de un solo uso**. La propuesta: sacar la verificacion de identidad *fuera de la fila*. La persona demuestra antes que la entrada es suya (RUT + codigo de entrada) y en la puerta solo se escanea un QR que rota cada 45 s, en una **fila rapida** separada de la fila normal.

- `backend/`: API en FastAPI + SQLAlchemy + SQLite. JWT para el personal y para la sesion del asistente.
- `frontend/`: React + Vite + TypeScript + Tailwind CSS v4 (lucide-react para iconos).
  
## Como funciona

1. **Emision**: el admin crea el evento, sus filas (`rapida`/`normal`) y las entradas nominativas (titular + RUT). Cada entrada tiene un codigo de 8 caracteres que se muestra una sola vez y queda hasheado.
2. **Activacion** (`/mi-entrada`, publica): el asistente ingresa **RUT + codigo de entrada**. No basta el RUT: cualquiera que lo conozca podria sacar el QR de otra persona (ADR-7 en [`docs/architecture.md`](docs/architecture.md)). La entrada queda ligada a ese dispositivo.
3. **QR dinamico**: una vez activado, el QR se renueva solo cada **45 segundos** (`QR_TTL_SECONDS`, justificado en [`docs/ttl-justification.md`](docs/ttl-justification.md)). Cada QR nuevo invalida el anterior.
4. **Ingreso**: el guardia elige evento + fila en "Escanear" y escanea. Motivos de rechazo: `expired`, `already_used`, `invalid`, `already_admitted` (esa entrada ya ingreso: anti pass-back) y `wrong_event`.
5. **Medicion**: "Historial" muestra por fila escaneos, concedidos, rechazos, escaneos/min y latencia p50/p95: la base empirica para discutir el largo de las filas.

## Roles

- **admin**: eventos, filas, entradas (emitir, liberar dispositivo), personal e historial/metricas.
- **guard**: escanea en su fila y ve historial/metricas.
- **asistente** (sin cuenta): solo activa su entrada y muestra su QR.

## Levantar el backend

```bash
cd backend
uv sync
cp .env.example .env
uv run python -m app.seed   # crea personal, evento demo, filas y entradas
uv run uvicorn app.main:app --reload --port 8000
```

Tests (smoke test del flujo de QR, usa una base de datos temporal propia):

```bash
uv run python -m pytest tests/ -v
```

Datos demo (ver salida de `seed`):
- Personal: `admin@demo.cl` / `admin123`, `guardia@demo.cl` / `guardia123`, `guardia2@demo.cl` / `guardia123`
- Entradas del "Concierto Demo - Estadio" (en `/mi-entrada`): `11.111.111-1` + `DEMO2345`, `22.222.222-2` + `DEMO6789`, `12.345.678-5` + `DEMOABCD`

Si tienes una base `control_acceso.db` de la version residencial anterior, borrala antes de sembrar: el esquema cambio y `create_all` no migra.

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

Abre `http://localhost:5173`. El escaneo de QR requiere una camara (permiso del navegador); en desktop sin webcam se puede probar activando una entrada en `/mi-entrada` y escaneandolo desde el celular apuntando a `http://<ip-local>:5173` (usa `npm run dev -- --host`).

## Limitaciones (a proposito, por ser "simplificado")

- Sin venta de entradas ni envio de codigos: el admin las emite y entrega el codigo manualmente.
- Validacion online (cada escaneo consulta el servidor); sin modo offline todavia (ver ADR-1/ADR-9).
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
