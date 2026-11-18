# Control de acceso con QR dinámico (prototipo de tesis)

Prototipo de la tesis de Miguel Monzó Díaz (DCC, U. de Chile) sobre la cédula de identidad digital chilena.
Responde siempre en español. El contexto técnico completo está en `HANDOFF.md`; qué se puede afirmar en la
tesis, en `docs/guia-tesis.md`.

## «Inicia el prototipo» (piloto en terreno)

Cuando Miguel diga «inicia el prototipo», «levanta la demo» o algo equivalente, quiere el sistema corriendo
para el piloto (`docs/piloto.md`; guía del día en `docs/piloto-dia.md`).

**Plan A: túnel de Cloudflare** (`uv run demo.py`). Da una dirección `https://….trycloudflare.com` con
certificado real: los teléfonos no muestran advertencias ni «No seguro» (importa porque la encuesta pregunta
por la seguridad percibida), no necesitan estar en la misma red y no hay que tocar el firewall. Necesita
internet en el PC y en los teléfonos. Mientras corre, la app es pública en esa dirección aleatoria; se usó
el 2026-11-18 desde un clon limpio y funcionó.

**Plan B: red local** (`uv run demo.py --red-local`), si no hay internet. Los teléfonos muestran una
advertencia de certificado.

Haz esto:

1. **Herramientas.** Comprueba `uv --version`, `node --version` (20 o superior), `git --version` y
   `cloudflared --version`. Si falta alguna, dile qué instalar (en Windows: `winget install astral-sh.uv`,
   `winget install OpenJS.NodeJS.LTS`, `winget install Git.Git`, `winget install Cloudflare.cloudflared`) y
   espera a que lo haga; después hay que abrir una terminal nueva.
2. **Primera vez en este PC** (no existe `frontend/dist/` o `backend/.venv/`): corre
   `uv run demo.py --verificar`. Necesita internet y tarda unos minutos. Debe terminar con
   «Verificacion correcta: todo responde».
3. **Levantar:** corre `uv run demo.py` **en segundo plano** (sigue corriendo hasta que se detenga). Lee su
   salida y muéstrale a Miguel:
   - la dirección pública (línea «PC y celular (cualquier red)»);
   - las cuentas de guardia y admin, y las cédulas demo (RUN + clave de activación).
   Si el túnel falla o no hay internet, detén ese proceso y levanta el plan B: `uv run demo.py --red-local`
   (línea «Telefonos (misma red)»), con los recordatorios de red del final de esta sección.
4. **QR de la dirección**, para que los teléfonos entren escaneando en vez de escribirla: genera
   `.demo-logs/qr-telefonos.png` con
   `uv run --with "qrcode[pil]" python -c "import qrcode; qrcode.make('<dirección>').save('.demo-logs/qr-telefonos.png')"`
   y ábrelo (`start .demo-logs\qr-telefonos.png` en Windows). La dirección del túnel cambia cada vez que se
   levanta: si se reinicia la demo, genera el QR de nuevo.
5. **Recuérdale, en una lista corta:**
   - **cambiar ya las contraseñas demo** (admin y guardia) en «Usuarios»: el repositorio es público y la app
     está abierta por internet;
   - activar «Asistente Uno» en el teléfono del titular: las cédulas activadas en otro PC o en otra sesión
     de la demo no sirven aquí;
   - abrir el escáner (sesión de guardia, evento «Concierto Demo») en el otro teléfono;
   - cerrar la demo al terminar («detén»).

Recordatorios solo para el plan B (red local): PC y teléfonos en la **misma red propia** (punto de acceso de
un teléfono), no el Wi-Fi de la universidad; red marcada como **Privada** en Windows; firewall permitiendo
**Node.js en redes privadas**; aceptar la advertencia del certificado en cada teléfono. Si no cargan,
revisar red, perfil Privado y firewall, en ese orden.

**Las personas del piloto no usan su propio celular para el sistema**, salvo como escáner si quieren: solo
escanean el QR del formulario. Prueban la demostración en los teléfonos de Miguel, ya preparados (uno con la
cédula activada y otro con el escáner abierto). Las cédulas demo son tres y cada una queda ligada a un solo
teléfono: activarla en otro celular la desactiva en el de Miguel.

### Durante el piloto

| Miguel dice | Haz |
|---|---|
| «reabre» / «siguiente persona» | `cd backend && uv run python scripts/piloto.py reabrir --evento 1` |
| «exporta» / «terminamos» | `cd backend && uv run python scripts/piloto.py exportar --evento 1` y dile dónde quedó el CSV (`backend/piloto-datos/`), para copiarlo a un pendrive o a su correo |
| «detén» / «apaga» | detén el proceso de la demo que dejaste en segundo plano; con eso se cierra el túnel |
| «simula caída de red» | la demo en segundo plano no recibe las teclas `c` y `v`. Para esa prueba, detén la demo y pídele que la levante él en una terminal (`uv run demo.py`) y use `c` + Enter y luego `v` + Enter |

### Qué no hacer

- **No** despliegues (Railway ni otro): está preparado (`docs/despliegue.md`), pero falta el visto bueno del
  profesor guía. El túnel no es un despliegue: es temporal y se cierra al detener la demo.
- **No** dejes el túnel abierto cuando Miguel diga que terminó.
- **No** pidas ni uses fotos o RUT reales: la demostración usa solo las personas demo.
- **No** hagas `git push` salvo que Miguel lo pida en ese momento.

El formulario de Google y su QR **no** están en este repositorio (es público): Miguel los tiene en su artifact
privado «Piloto en la universidad» y en su Escritorio.
