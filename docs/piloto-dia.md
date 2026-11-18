# Día del piloto: guía rápida

Resumen operativo de `docs/piloto.md` para el día de la sesión. Probado el 2026-11-18 desde un clon limpio:
modo túnel (`uv run demo.py --verificar`) y modo red local (`--red-local --verificar`) correctos, y simulacro
de `e2e/` en red local con 33 de 33 comprobaciones.

Con Claude Code abierto en la carpeta del repositorio basta decir **«inicia el prototipo»** (ver `CLAUDE.md`).
Lo que sigue es lo mismo, paso a paso, por si se hace a mano.

## Plan A y plan B

- **Plan A, túnel** (`uv run demo.py`): dirección `https://….trycloudflare.com` con certificado real, sin
  advertencias ni «No seguro» en el teléfono. Los teléfonos no necesitan estar en la misma red y no hay que
  tocar el firewall. Necesita internet en el PC y en los teléfonos. Mientras corre, la app es pública en esa
  dirección aleatoria: cambiar las contraseñas demo al empezar y cerrar la demo al terminar.
- **Plan B, red local** (`uv run demo.py --red-local`), si no hay internet: los teléfonos se conectan a la red
  del PC y muestran una advertencia de certificado.

Se prefiere el túnel porque la encuesta pregunta por la seguridad percibida, y un «No seguro» en la barra del
navegador durante la demostración podría sesgarla.

## Antes de salir

- **Ética y permiso:** confirmar con los guías si la encuesta necesita comité de ética, y pedir permiso a
  quien administra el lugar. Si no está resuelto, hacer solo el ensayo técnico, sin encuestar.
- **Formulario:** ya está creado en la cuenta de Google del autor (publicado, anónimo, orden aleatorio en la
  pregunta de motivación). El enlace y el QR para la mesa están en el artifact privado «Piloto en la
  universidad» y en el Escritorio; no se publican aquí porque el repositorio es público. Responderlo una vez de
  prueba y borrar esa respuesta.
- **Llevar:** cargador del PC, dos o más teléfonos de distinta gama con batería, un teléfono con datos para
  compartir internet, la pistola lectora si se usa, el QR del formulario impreso y unas copias del cuestionario
  en papel.

## 1. Preparar el PC (primera vez, con internet)

```bash
winget install astral-sh.uv
winget install OpenJS.NodeJS.LTS
winget install Git.Git
winget install Cloudflare.cloudflared
# terminal nueva
git clone https://github.com/mmonzodiaz/TESIS---Control-QR-Dinamico.git
cd TESIS---Control-QR-Dinamico
uv run demo.py --verificar
```

Sin permisos para `winget`: uv se instala sin administrador con
`powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`, Node.js tiene versión
portable (zip) en nodejs.org, cloudflared tiene ejecutable suelto en su página de GitHub y, en vez de Git,
sirve «Code → Download ZIP» en GitHub.

## 2. Arranque

**Plan A (túnel):**

1. PC y teléfonos con internet (Wi-Fi de la universidad, datos móviles o el punto de acceso de un teléfono).
2. `uv run demo.py`. Muestra la dirección pública («PC y celular (cualquier red)») y las cuentas.
3. En cada teléfono, abrir esa dirección (o escanear su QR, ver `CLAUDE.md`). No aparece ninguna advertencia.

**Plan B (red local, sin internet):**

1. Compartir internet desde un teléfono y conectar ahí el PC y los teléfonos de la demo. El Wi-Fi de la
   universidad suele aislar los equipos entre sí.
2. En Windows, marcar esa red como **Privada**.
3. `uv run demo.py --red-local`. Muestra la dirección para los teléfonos (`https://192.168.x.x:4173`).
4. Si Windows pregunta por el firewall, permitir **Node.js en redes privadas**.
5. En cada teléfono, abrir la dirección y aceptar la advertencia del certificado: en Android, «Configuración
   avanzada» → «Continuar a 192.168… (no seguro)»; en iPhone, «Mostrar detalles» → «visitar este sitio web».

## 3. Preparar la demostración

1. Cambiar las contraseñas demo (admin y guardia) en «Usuarios».
2. Activar la cédula en el teléfono del titular: «Mi cédula», RUN `11.111.111-1`, clave `RCUNO234`
   («Asistente Uno»), y crear el PIN. Lo activado en otro PC o en otra sesión de la demo no sirve aquí.
3. Escáner: otro teléfono o el PC con cámara, sesión de guardia y evento «Concierto Demo».
4. Foto del QR para el paso de la copia: tomarla con otro teléfono, con la pantalla entera y margen blanco,
   y esperar más de 50 s antes de usarla.
5. Subir el brillo del teléfono del titular.

## 4. Por persona

1. Parte 1 del formulario, sola, en su teléfono.
2. Demostración (guion en `docs/piloto.md` §4): presentación, foto vencida → «Código expirado», QR del
   titular con otra persona → «No coincide», QR nuevo (pide el PIN) → «Dejar pasar», límites.
3. Parte 2 del formulario. Apartarse mientras responde.
4. Reabrir la entrada para la siguiente persona:

```bash
cd backend
uv run python scripts/piloto.py reabrir --evento 1
```

Anotar en cada sesión: lugar, horario, cuántas personas declinaron, si el QR se lee en cada teléfono, el
tiempo por persona con cronómetro y cualquier problema (tabla completa en `docs/piloto.md` §5).

## 5. Al terminar

```bash
cd backend
uv run python scripts/piloto.py exportar --evento 1
```

Deja en `backend/piloto-datos/` un CSV sin RUT ni nombres: copiarlo a un pendrive o al correo. Detener la
demo (Ctrl+C), con lo que se cierra el túnel. Descargar las respuestas del formulario (Respuestas → tres
puntos → Descargar respuestas (.csv)). El análisis se corre en el repositorio del informe con
`analisis/piloto.py`.

## Si algo falla

- **El túnel no entrega dirección o se corta:** detener y levantar el plan B (`--red-local`).
- **En plan B los teléfonos no cargan:** misma red, perfil Privado y firewall con Node permitido. Sin
  permisos de administrador para el firewall, usar el notebook propio.
- **Falla Google Forms:** cuestionario en papel; después se traspasa al formulario.
