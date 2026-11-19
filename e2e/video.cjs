// Video explicativo y de demostración, para quienes no pueden ver el piloto en vivo (docs/piloto.md).
// Graba el sistema real funcionando: un navegador hace de teléfono (cédula digital) y otro de escáner del
// guardia, con la cámara simulada de Chromium leyendo el QR, igual que el simulacro. Usa datos temporales y
// levanta y detiene sus propios servicios. Narra con la voz en español de Windows (narrar.ps1) y monta todo
// con ffmpeg en video-salida/video-demo.mp4.
//
//   cd e2e && npm run video            # graba y monta
//   cd e2e && npm run video -- --montar  # vuelve a montar lo ya grabado (textos, voz, tiempos)
//
// Las carátulas y la narración no afirman nada que la tesis no sostenga: en particular, dicen que el
// reenvío del QR en tiempo real a un cómplice lo detiene el guardia y no la verificación automática.
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");
const c = require("./comun.cjs");

const PIN = "482913";
const FILA = "Fila cédula digital A";
// Fuera de salida/, que comun.cjs borra al empezar cada corrida.
const OUTV = path.join(__dirname, "video-salida");
const CLIPS = path.join(OUTV, "clips");
const PARTES = path.join(OUTV, "partes");
const VOZ = path.join(OUTV, "voz");
const GUION = path.join(OUTV, "guion.json");
const FINAL = path.join(OUTV, "video-demo.mp4");
const W = 1280;
const H = 720;
const FPS = 30;
const FONDO = "0x142039"; // --color-ink del sistema visual «Azul confianza»
const SOLO_MONTAR = process.argv.includes("--montar");

const avisos = [];

// --- Textos en pantalla ----------------------------------------------------------------------------

const CARATULAS = {
  intro: [
    "Cédula de identidad digital con QR dinámico",
    "Demostración del prototipo de control de acceso a un evento masivo. Es el sistema real " +
      "funcionando; las personas, las fotografías y el Registro Civil son simulados.",
  ],
  diferencias: [
    "Qué cambia respecto del carnet",
    "Hoy en la puerta se lee el QR impreso del carnet. Está siempre igual, así que una fotografía suya " +
      "sirve tanto como el documento. Lo que viene cambia tres cosas: hace falta el teléfono y un PIN; " +
      "el código se renueva cada 45 segundos y sirve una sola vez; y el guardia ve una fotografía " +
      "firmada por el emisor, no una impresa en un plástico.",
  ],
  cedula: [
    "1. La cédula vive en el teléfono, detrás de un PIN",
    "El teléfono se enrola en el Registro Civil con el RUN y una clave de activación, y recibe su " +
      "cédula firmada: nombre, RUN y fotografía. Queda guardada cifrada con un PIN de seis dígitos. " +
      "Para mostrar el código hacen falta las dos cosas: este teléfono y ese PIN. Ninguna sirve sola.",
  ],
  qr: [
    "2. El código se renueva cada 45 segundos",
    "El teléfono arma el código sin conexión y sin avisarle al recinto, y vuelve a pedir el PIN antes " +
      "de cada uno. Lleva la fotografía firmada, va cifrado para los lectores autorizados y sirve para " +
      "un solo ingreso: un pantallazo deja de valer apenas vence.",
  ],
  ingreso: [
    "3. En la puerta: un ingreso válido",
    "El lector descifra el código y muestra la fotografía, el nombre y el RUN firmados; el servidor " +
      "comprueba la entrada, el uso único y las prohibiciones de ingreso. El guardia compara a la " +
      "persona con la fotografía firmada y decide.",
  ],
  vencido: [
    "4. Un pantallazo ya no funciona",
    "Este es el mismo código, fotografiado hace más de 45 segundos: exactamente la copia que hoy basta " +
      "para reutilizar el QR del carnet. El lector lo reconoce y lo rechaza, porque expiró.",
  ],
  nocoincide: [
    "5. Y si el código es de otra persona",
    "El código está vigente y tiene entrada, así que la verificación automática lo acepta. Lo que " +
      "detiene el fraude es la fotografía firmada: el guardia rechaza el ingreso, y la entrada del " +
      "titular no se gasta.",
  ],
  cierre: [
    "Las tres diferencias, en resumen",
    "Con el carnet basta una fotografía del QR impreso. Aquí hacen falta el teléfono y el PIN; el " +
      "código cambia cada 45 segundos y sirve una sola vez, así que una copia caduca; y la fotografía " +
      "que ve el guardia viene firmada por el emisor. Queda un ataque que la verificación automática " +
      "no detiene: reenviar el código en tiempo real a un cómplice. Ese solo lo detiene el guardia, al " +
      "comparar a la persona con la fotografía.",
  ],
};

const PIES = {
  cedula: "Hacen falta las dos cosas: el teléfono y el PIN",
  qr: "El código se renueva cada 45 s y sirve una sola vez",
  ingreso: "El guardia compara con la fotografía firmada y deja pasar",
  vencido: "Pantallazo de hace más de 45 s: «Código expirado»",
  nocoincide: "Código auténtico, persona equivocada: decide la fotografía",
};

// --- Narración (los números van en palabras: la voz de Windows los lee mejor) -----------------------

const NARRACION = {
  "caratula-intro":
    "Esta es una demostración del prototipo de control de acceso con cédula de identidad digital y " +
    "código QR dinámico, el componente aplicado de una tesis de magíster. Lo que vas a ver es el " +
    "sistema real funcionando. Las personas, las fotografías y el Registro Civil son simulados.",
  "caratula-diferencias":
    "Conviene mirar esto pensando en lo que pasa hoy. En la puerta de un evento se lee el código QR " +
    "impreso del carnet, que está siempre igual: una fotografía de ese código sirve tanto como el " +
    "documento. El prototipo cambia tres cosas. Hace falta el teléfono y un PIN. El código se renueva " +
    "cada cuarenta y cinco segundos y sirve una sola vez. Y el guardia ve una fotografía firmada por " +
    "el emisor.",
  "caratula-cedula": "Primero: la cédula vive en el teléfono, detrás de un PIN.",
  "clip-cedula":
    "El teléfono recibe del Registro Civil la cédula firmada, con el nombre, el RUN y la fotografía, y " +
    "la guarda cifrada con un PIN de seis dígitos. Desde aquí, mostrar el código exige las dos cosas a " +
    "la vez: este teléfono y ese PIN. Quien tome el teléfono prestado no puede abrirla.",
  "caratula-qr": "Segundo: el código se renueva cada cuarenta y cinco segundos.",
  "clip-qr":
    "Antes de cada código, la aplicación vuelve a pedir el PIN. El teléfono lo arma solo, sin conexión, " +
    "con la fotografía firmada adentro, cifrado y para un único ingreso. Mira la cuenta regresiva: a " +
    "los cuarenta y cinco segundos caduca y el teléfono genera otro distinto.",
  "caratula-ingreso": "Tercero: en la puerta, un ingreso válido.",
  "clip-ingreso":
    "El guardia escanea. El lector descifra el código y muestra la fotografía, el nombre y el RUN " +
    "firmados por el emisor. El servidor comprueba la entrada, el uso único y las prohibiciones de " +
    "ingreso, pero todavía no registra nada. El guardia compara a la persona con la fotografía y toca " +
    "Dejar pasar. Ahí queda registrado el ingreso.",
  "caratula-vencido": "Cuarto: un pantallazo ya no funciona.",
  "clip-vencido":
    "Este es el mismo código, fotografiado hace más de cuarenta y cinco segundos. Con el carnet, una " +
    "copia así sirve igual que el original. Aquí el lector la reconoce y la rechaza: expiró.",
  "caratula-nocoincide": "Quinto: y si el código es de otra persona.",
  "clip-nocoincide":
    "El código está vigente y tiene entrada, así que la verificación automática lo acepta. Lo que " +
    "detiene el fraude es la fotografía firmada: el guardia ve que no es la persona que tiene al " +
    "frente y rechaza el ingreso. La entrada del titular no se gasta.",
  "caratula-cierre":
    "En resumen. Con el carnet basta una fotografía del código impreso. Aquí hacen falta el teléfono y " +
    "el PIN; el código cambia cada cuarenta y cinco segundos y sirve una sola vez, así que una copia " +
    "caduca; y la fotografía que ve el guardia viene firmada por el emisor. Queda un ataque que la " +
    "verificación automática no detiene: reenviar el código en tiempo real a un cómplice. Ese solo lo " +
    "detiene el guardia, al comparar a la persona con la fotografía.",
};

// --- Carátulas y pies, dibujados en el navegador ---------------------------------------------------

const caratulaHtml = (titulo, texto) => `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;height:100%}
  body{background:#142039;color:#fff;font-family:"Segoe UI",system-ui,sans-serif;
       display:flex;flex-direction:column;justify-content:center;padding:0 110px;box-sizing:border-box}
  .barra{width:76px;height:6px;border-radius:3px;background:#2f62e9;margin-bottom:34px}
  h1{font-size:50px;line-height:1.12;margin:0 0 26px;font-weight:650;letter-spacing:-0.5px}
  p{font-size:27px;line-height:1.5;margin:0;color:#c6d2ea;max-width:1000px}
</style><div class="barra"></div><h1>${titulo}</h1><p>${texto}</p>`;

const pieHtml = (texto) => `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;background:transparent}
  body{font-family:"Segoe UI",system-ui,sans-serif;display:flex;justify-content:center;align-items:center;height:96px}
  span{background:rgba(20,32,57,.93);color:#fff;font-size:25px;padding:16px 30px;border-radius:14px;
       border:1px solid rgba(143,180,255,.45)}
</style><span>${texto}</span>`;

async function dibujar(browser) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  for (const [nombre, [titulo, texto]] of Object.entries(CARATULAS)) {
    await page.setContent(caratulaHtml(titulo, texto));
    await page.screenshot({ path: path.join(OUTV, `caratula-${nombre}.png`) });
  }
  await page.setViewportSize({ width: W, height: 96 });
  for (const [nombre, texto] of Object.entries(PIES)) {
    await page.setContent(pieHtml(texto));
    await page.screenshot({ path: path.join(OUTV, `pie-${nombre}.png`), omitBackground: true });
  }
  await ctx.close();
}

// --- Helpers de la aplicación (los mismos pasos que simulacro.cjs) ---------------------------------

const sheet = (page) => page.locator('[aria-live="assertive"]');

async function resultado(page) {
  await sheet(page).waitFor({ timeout: 30000 });
  const fin = Date.now() + 30000;
  while (Date.now() < fin) {
    const texto = (await sheet(page).locator("p").first().innerText()).trim();
    if (!/^(Verificando|Registrando)/.test(texto)) return texto;
    await c.sleep(100);
  }
  throw new Error("sin resultado");
}

async function teclearPin(page) {
  for (const d of PIN) await page.getByRole("button", { name: d, exact: true }).click();
}

/** Cerrar y volver a abrir el QR genera uno nuevo; la app pide el PIN antes de cada uno. */
let n = 0;
async function nuevoQr(phone, etiqueta) {
  await phone.getByRole("button", { name: /Mostrar mi QR/ }).click();
  await phone.getByRole("dialog", { name: "Confirma tu PIN" }).waitFor();
  await teclearPin(phone);
  await phone.getByRole("dialog", { name: "Tu código QR" }).waitFor();
  await c.sleep(400);
  const archivo = path.join(OUTV, `qr-${etiqueta}-${++n}.png`);
  await phone.screenshot({ path: archivo, scale: "device" }); // la pantalla entera, como la ve una cámara
  return archivo;
}

/** Escena del escáner: la cámara simulada muestra `qr` y `accion` decide qué hace el guardia. */
async function escenaEscaner(etiqueta, qr, accion) {
  const mjpeg = c.cameraVideo(path.join(OUTV, `camara-${etiqueta}.mjpeg`), qr);
  const browser = await c.chromium().launch(c.launchOptions([`--use-file-for-fake-video-capture=${mjpeg}`]));
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    permissions: ["camera"],
    viewport: { width: 1040, height: 760 },
    recordVideo: { dir: CLIPS, size: { width: 1040, height: 760 } },
  });
  ctx.setDefaultTimeout(30000);
  const page = await ctx.newPage();
  const video = page.video();
  const t0 = Date.now();
  await page.goto(`${c.BASE}/login`);
  await page.locator('input[type="email"]').fill("guardia@demo.cl");
  await page.locator('input[type="password"]').fill("guardia-demo-2026");
  await page.getByRole("button", { name: /ingresar|entrar/i }).click();
  await page.waitForURL("**/escanear");
  await page.getByText(/Apunta al QR|Descargando/).first().waitFor({ timeout: 30000 });
  await page.getByLabel("Fila").selectOption({ label: FILA });
  const desde = Date.now() - t0;
  // «Ingreso registrado» se cierra solo a los 1,8 s (GRANTED_DISMISS_MS), así que el rato largo va antes
  // de decidir, mirando la cédula con la fotografía, que es lo que la narración describe.
  const mirar = async (reserva) => {
    const falta = objetivo(`clip-${etiqueta}`) * 1000 * 1.12 - reserva * 1000 - (Date.now() - t0 - desde);
    if (falta > 0) await c.sleep(falta);
  };
  const visto = await accion(page, mirar);
  await c.sleep(1800); // el resultado, en pantalla
  // El clip tiene que durar al menos lo que su narración: se deja la aplicación a la vista en vez de
  // congelar el último cuadro en el montaje.
  const falta = objetivo(`clip-${etiqueta}`) * 1000 - (Date.now() - t0 - desde);
  if (falta > 0) await c.sleep(falta);
  const hasta = Date.now() - t0;
  await ctx.close();
  await browser.close();
  const archivo = await video.path();
  return { archivo, desde: cabeza(archivo, desde, hasta), hasta: duracion(archivo) * 1000, visto };
}

/**
 * Playwright descarta cuadros cuando el equipo va cargado, así que el reloj del guion y el del video no
 * coinciden. Cada escena se graba en su propio archivo y se usa entero, salvo la entrada del guardia, que
 * hay que dejar fuera: para eso basta situar ese instante dentro del archivo, y se corre un poco hacia
 * atrás a propósito (ver un resto de la pantalla de ingreso no molesta; cortar la escena, sí).
 */
function cabeza(archivo, marcaReal, finReal) {
  const k = Math.min(1, (duracion(archivo) * 1000) / finReal);
  return marcaReal * k * 0.95;
}

function comprueba(etiqueta, visto, esperado) {
  if (visto !== esperado) avisos.push(`${etiqueta}: la app dijo «${visto}» y se esperaba «${esperado}»`);
}

const reabrir = () =>
  execSync("uv run python scripts/piloto.py reabrir --evento 1", { cwd: c.BACKEND, env: process.env, stdio: "ignore" });

// --- Montaje con ffmpeg ----------------------------------------------------------------------------

const ff = (args) => execSync(`ffmpeg -y -hide_banner -loglevel error ${args}`, { stdio: "inherit" });
const duracion = (archivo) =>
  Number(
    execSync(`ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "${archivo}"`, {
      encoding: "utf8",
    }).trim(),
  );

const VIDEO_ENC = `-r ${FPS} -c:v libx264 -preset veryfast -crf 22 -pix_fmt yuv420p`;
const AUDIO_ENC = "-c:a aac -b:a 128k -ar 48000 -ac 2";
const NORMALIZA_AUDIO = "adelay=350|350,apad,aformat=sample_rates=48000:channel_layouts=stereo";

/** Genera la narración de cada tramo con la voz de Windows. */
function narrar() {
  const json = path.join(OUTV, "narracion.json");
  fs.writeFileSync(json, JSON.stringify(NARRACION, null, 2), "utf8");
  const script = path.join(__dirname, "narrar.ps1");
  const salida = execSync(
    `powershell -NoProfile -ExecutionPolicy Bypass -File "${script}" -Json "${json}" -Dir "${VOZ}"`,
    { encoding: "utf8" },
  ).trim();
  console.log(`  ${salida}`);
}

/** Lo que dura la narración de un tramo, con un respiro al final. 0 si no tiene voz. */
function objetivo(id) {
  const wav = path.join(VOZ, `${id}.wav`);
  return fs.existsSync(wav) ? duracion(wav) + 1.2 : 0;
}

function montar(guion) {
  fs.rmSync(PARTES, { recursive: true, force: true });
  fs.mkdirSync(PARTES, { recursive: true });
  const partes = [];
  guion.forEach((item, i) => {
    const salida = path.join(PARTES, `${String(i).padStart(2, "0")}.mp4`);
    const voz = path.join(VOZ, `${item.id}.wav`);
    const hayVoz = fs.existsSync(voz);
    const dicho = hayVoz ? duracion(voz) + 1.2 : 0;
    if (item.tipo === "caratula") {
      const dur = Math.max(item.minimo, dicho).toFixed(2);
      const entradaAudio = hayVoz ? `-i "${voz}"` : `-f lavfi -i anullsrc=r=48000:cl=stereo`;
      ff(
        `-loop 1 -t ${dur} -i "${item.imagen}" ${entradaAudio} ` +
          `-filter_complex "[0:v]scale=${W}:${H}[v];[1:a]${NORMALIZA_AUDIO}[a]" ` +
          `-map "[v]" -map "[a]" -t ${dur} ${VIDEO_ENC} ${AUDIO_ENC} "${salida}"`,
      );
    } else {
      // El clip se encaja en el lienzo sin recortar (el teléfono es vertical) y lleva su pie abajo. Si la
      // narración dura más que la escena, se congela el último cuadro para que no quede voz sin imagen.
      const clip = (item.hasta - item.desde) / 1000;
      const dur = Math.max(clip, dicho);
      const extra = Math.max(0, dur - clip).toFixed(2);
      const entradaAudio = hayVoz ? `-i "${voz}"` : `-f lavfi -i anullsrc=r=48000:cl=stereo`;
      const filtro =
        `[0:v]scale=${W}:${H - 112}:force_original_aspect_ratio=decrease,` +
        `pad=${W}:${H}:(ow-iw)/2:0:color=${FONDO}[b];` +
        `[b][1:v]overlay=0:H-h-8[o];` +
        `[o]tpad=stop_mode=clone:stop_duration=${extra},format=yuv420p[v];` +
        `[2:a]${NORMALIZA_AUDIO}[a]`;
      ff(
        `-ss ${(item.desde / 1000).toFixed(2)} -t ${clip.toFixed(2)} -i "${item.archivo}" ` +
          `-i "${item.pie}" ${entradaAudio} -filter_complex "${filtro}" ` +
          `-map "[v]" -map "[a]" -t ${dur.toFixed(2)} ${VIDEO_ENC} ${AUDIO_ENC} "${salida}"`,
      );
    }
    partes.push(salida);
  });
  const lista = path.join(PARTES, "lista.txt");
  fs.writeFileSync(lista, partes.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n"));
  ff(`-f concat -safe 0 -i "${lista}" -c copy "${FINAL}"`);
}

// --- Guion -----------------------------------------------------------------------------------------

const guion = [];
const caratula = (nombre, minimo = 4) =>
  guion.push({ id: `caratula-${nombre}`, tipo: "caratula", imagen: path.join(OUTV, `caratula-${nombre}.png`), minimo });
const clip = (nombre, { archivo, desde, hasta }) =>
  guion.push({ id: `clip-${nombre}`, tipo: "clip", archivo, desde, hasta, pie: path.join(OUTV, `pie-${nombre}.png`) });

/** Un teléfono: `estado` trae la cédula ya activada (vive en localStorage). */
function telefono(browser, estado, grabando) {
  return browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 420, height: 880 },
    deviceScaleFactor: 2,
    ...(estado ? { storageState: estado } : {}),
    ...(grabando ? { recordVideo: { dir: CLIPS, size: { width: 420, height: 880 } } } : {}),
  });
}

/** Abre la cédula ya activada: al entrar, la aplicación pide el PIN. */
async function abrirCedula(page, pausa = 0) {
  await page.goto(`${c.BASE}/mi-cedula`);
  await page.getByText("Ingresa tu PIN").waitFor();
  if (pausa) await c.sleep(pausa);
  await teclearPin(page);
  await page.getByRole("button", { name: /Mostrar mi QR/ }).waitFor({ timeout: 30000 });
}

/**
 * Deja la escena corriendo hasta que cubra su narración. Se pide un poco más de tiempo real que el que
 * dura la voz, porque el video grabado sale más corto (ver cabeza()).
 */
async function esperaVoz(desdeReal, id) {
  const falta = objetivo(id) * 1000 * 1.12 - (Date.now() - desdeReal);
  if (falta > 0) await c.sleep(falta);
}

/**
 * El orden del video. Se arma igual al grabar y al remontar (`--montar`), para que cambiar los textos o
 * agregar una caratula no obligue a volver a grabar la aplicacion.
 */
const metraje = {};
function secuencia(clips) {
  Object.assign(metraje, clips);
  caratula("intro", 6);
  caratula("diferencias", 6);
  caratula("cedula");
  clip("cedula", clips.cedula);
  caratula("qr");
  clip("qr", clips.qr);
  caratula("ingreso");
  clip("ingreso", clips.ingreso);
  caratula("vencido");
  clip("vencido", clips.vencido);
  caratula("nocoincide");
  clip("nocoincide", clips.nocoincide);
  caratula("cierre", 6);
}


async function grabar() {
  // La comparación biométrica va apagada (ADR-16): es opcional, está apagada por defecto y la Ley 21.719
  // pide consentimiento expreso para usarla. El escáner del video no debe ofrecerla. Se comprueba abajo.
  process.env.VITE_BIOMETRIA = "0";
  const base = await c.startAll();
  console.log(`IP ${c.IP} · base ${base}`);
  const browser = await c.chromium().launch(c.launchOptions());

  console.log("- carátulas");
  await dibujar(browser);

  // Cada escena del teléfono se graba en su propio contexto, para que el clip sea el archivo entero y no
  // haya que calzar relojes. La cédula viaja de uno a otro en el estado del navegador (localStorage), así
  // que se activa una sola vez: activarla de nuevo revocaría la anterior.
  console.log("- escena 1: la persona obtiene su cédula");
  const ctx1 = await telefono(browser, null, true);
  ctx1.setDefaultTimeout(30000);
  const tel1 = await ctx1.newPage();
  const video1 = tel1.video();
  const t1 = Date.now();
  await tel1.goto(`${c.BASE}/mi-cedula`);
  await c.sleep(1200);
  const tel = tel1; // los pasos de la activación son los mismos
  await tel.getByLabel("RUN").fill("11.111.111-1");
  await c.sleep(1100); // pausas para que se alcance a leer lo que pasa
  await tel.getByLabel("Clave de activación").fill("RCUNO234");
  await c.sleep(1100);
  await tel.getByRole("button", { name: "Obtener mi cédula digital" }).click();
  await tel.getByText("Crea tu PIN de 6 dígitos").waitFor();
  await c.sleep(1400);
  await teclearPin(tel);
  await tel.getByText("Repite tu PIN").waitFor();
  await c.sleep(900);
  await teclearPin(tel);
  await tel.getByRole("button", { name: /Mostrar mi QR/ }).waitFor({ timeout: 30000 });
  await esperaVoz(t1, "clip-cedula");
  const cedula = await ctx1.storageState(); // la cédula activada, para los contextos siguientes
  await ctx1.close();
  const archivoCedula = await video1.path();

  console.log("- escena 2: el QR dinámico");
  const ctx2 = await telefono(browser, cedula, true);
  ctx2.setDefaultTimeout(30000);
  const tel2 = await ctx2.newPage();
  const video2 = tel2.video();
  const t2 = Date.now();
  await abrirCedula(tel2, 900); // al abrirla pide el PIN, como dice la narración
  await c.sleep(900);
  const qrViejo = await nuevoQr(tel2, "viejo"); // se usará vencido en la escena 4
  const tomadoEn = Date.now();
  await esperaVoz(t2, "clip-qr"); // el QR en pantalla, con su cuenta de 45 s corriendo
  await ctx2.close();
  const archivoQr = await video2.path();

  // Teléfono de trabajo, sin grabar: solo genera los QR que leerá el escáner.
  const ctxTel = await telefono(browser, cedula, false);
  ctxTel.setDefaultTimeout(30000);
  const tel3 = await ctxTel.newPage();
  await abrirCedula(tel3);

  console.log("- escena 3: ingreso válido");
  const qrIngreso = await nuevoQr(tel3, "ingreso");
  await tel3.getByRole("button", { name: "Cerrar QR" }).click();
  const ingreso = await escenaEscaner("ingreso", qrIngreso, async (page, mirar) => {
    comprueba("escena 3 (lectura)", await resultado(page), "Cédula válida y con entrada");
    comprueba("biometría apagada", String(await page.getByRole("button", { name: /Comparar rostro/ }).count()), "0");
    await mirar(4); // el guardia compara a la persona con la fotografía antes de decidir
    await page.getByRole("button", { name: /Dejar pasar/ }).click();
    return resultado(page);
  });
  comprueba("escena 3 (decisión)", ingreso.visto, "Ingreso registrado");
  reabrir();

  console.log("- escena 4: foto vencida del QR");
  await c.sleep(Math.max(0, 50000 - (Date.now() - tomadoEn))); // el QR de la escena 2 tiene que haber vencido
  const vencido = await escenaEscaner("vencido", qrViejo, (page) => resultado(page));
  comprueba("escena 4", vencido.visto, "Código expirado");

  console.log("- escena 5: el QR de otra persona");
  const qrOtro = await nuevoQr(tel3, "otro");
  await tel3.getByRole("button", { name: "Cerrar QR" }).click();
  const nocoincide = await escenaEscaner("nocoincide", qrOtro, async (page, mirar) => {
    comprueba("escena 5 (lectura)", await resultado(page), "Cédula válida y con entrada");
    await mirar(6); // se ve la fotografía firmada, que es lo que delata el fraude
    await page.getByRole("button", { name: /No coincide/ }).click();
    return resultado(page);
  });
  comprueba("escena 5 (decisión)", nocoincide.visto, "Rechazado: la foto no coincide");

  await ctxTel.close();
  await browser.close();

  secuencia({
    cedula: { archivo: archivoCedula, desde: 0, hasta: duracion(archivoCedula) * 1000 },
    qr: { archivo: archivoQr, desde: 0, hasta: duracion(archivoQr) * 1000 },
    ingreso,
    vencido,
    nocoincide,
  });
  fs.writeFileSync(GUION, JSON.stringify({ avisos, clips: metraje }, null, 2), "utf8");
}

(async () => {
  if (SOLO_MONTAR) {
    const previo = JSON.parse(fs.readFileSync(GUION, "utf8"));
    avisos.push(...previo.avisos);
    // Guiones de versiones anteriores guardaban la secuencia entera; de ahí se saca el metraje.
    const clips =
      previo.clips ??
      Object.fromEntries(
        previo.guion
          .filter((i) => i.tipo === "clip")
          .map(({ id, archivo, desde, hasta }) => [id.replace("clip-", ""), { archivo, desde, hasta }]),
      );
    console.log("- carátulas");
    const browser = await c.chromium().launch(c.launchOptions());
    await dibujar(browser);
    await browser.close();
    console.log("- narración");
    narrar();
    secuencia(clips);
    console.log(`- remontando ${guion.length} tramos con el metraje ya grabado`);
  } else {
    fs.rmSync(OUTV, { recursive: true, force: true });
    fs.mkdirSync(CLIPS, { recursive: true });
    console.log("- narración"); // primero: su duración marca cuánto dura cada escena
    narrar();
    await grabar();
  }

  console.log("- montaje");
  montar(guion);

  console.log(`\nVideo: ${FINAL} (${Math.round(duracion(FINAL))} s)`);
  if (avisos.length) {
    console.log("AVISOS (el video puede no mostrar lo que dice la carátula):");
    for (const a of avisos) console.log(`  - ${a}`);
    process.exitCode = 1;
  } else {
    console.log("Las cinco escenas mostraron lo esperado.");
  }
})()
  .catch((err) => {
    console.log("ABORTADO", String(err).slice(0, 600));
    process.exitCode = 1;
  })
  .finally(() => {
    if (!SOLO_MONTAR) c.stopAll();
    process.exit(process.exitCode ?? 0);
  });
