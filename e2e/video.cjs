// Video explicativo y de demostración, para quienes no pueden ver el piloto en vivo (docs/piloto.md).
// Graba el sistema real funcionando: un navegador hace de teléfono (cédula digital) y otro de escáner del
// guardia, con la cámara simulada de Chromium leyendo el QR, igual que el simulacro. Usa datos temporales y
// levanta y detiene sus propios servicios. Narra con la voz en español de Windows (narrar.ps1) y monta todo
// con ffmpeg en video-salida/video-demo.mp4.
//
//   cd e2e && npm run video            # graba y monta
//   cd e2e && npm run video -- --montar  # vuelve a montar lo ya grabado (textos, voz, tiempos)
//   cd e2e && npm run video -- --guion   # imprime qué decir en cada tramo, para grabarlo con voz propia
//   cd e2e && npm run video -- --apuntador  # arma el video-apuntador: el mismo video, sin audio, con el
//                                           # texto arriba y las palabras encendiéndose al ritmo a leer
//
// Voz propia: deja un archivo de audio por tramo en e2e/voz-propia/ con el nombre del tramo
// (caratula-intro.m4a, clip-cedula.m4a, ...; sirve cualquier formato que lea ffmpeg) y vuelve a montar.
// Cada archivo reemplaza a la voz de Windows, y la escena se alarga o se acorta para calzar con él.
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
const VOZ_PROPIA = path.join(__dirname, "voz-propia");
const GUION = path.join(OUTV, "guion.json");
const FINAL = path.join(OUTV, "video-demo.mp4");
const W = 1280;
const H = 720;
const FPS = 30;
const FONDO = "0xf3f6fd"; // --color-paper de la app, el mismo fondo de las carátulas
const SOLO_MONTAR = process.argv.includes("--montar");
const SOLO_GUION = process.argv.includes("--guion");
const SOLO_APUNTADOR = process.argv.includes("--apuntador");

const avisos = [];

// --- Textos en pantalla ----------------------------------------------------------------------------

const CARATULAS = {
  intro: [
    "Cédula de identidad digital con QR dinámico",
    "Demostración del control de acceso a un evento masivo.",
  ],
  cierre: [
    "Qué cambia en la puerta",
    "",
  ],
};

const PIES = {
  cedula: "1. El teléfono y el PIN: ninguno de los dos sirve solo",
  qr: "2. Código nuevo cada 45 s, válido para un solo ingreso",
  ingreso: "3. Ingreso válido: el guardia compara con la foto firmada",
  vencido: "4. Pantallazo de hace más de 45 s: «Código expirado»",
  nocoincide: "5. Código auténtico, persona equivocada",
};

// --- Narración (los números van en palabras: la voz de Windows los lee mejor) -----------------------

const NARRACION = {
  "caratula-intro":
    "El código QR del carnet es siempre el mismo, así que una foto de ese código sirve igual que el " +
    "carnet. La app Identificación Digital del Registro Civil ya muestra un código que va cambiando, pero no " +
    "publica cómo verificarlo, y por eso nadie más lo puede comprobar por su cuenta. En mi tesis construí un " +
    "prototipo que simula esa app y agrega el verificador que falta. En este video les muestro cómo funciona " +
    "en la entrada de un evento, con personas y un Registro Civil de prueba.",
  "clip-cedula":
    "Lo primero es activar la cédula en el teléfono. El Registro Civil le manda a la persona su nombre, " +
    "su RUN y su foto, firmados digitalmente, así que nadie los puede cambiar sin que se note. Después " +
    "elige un PIN de seis dígitos. Para mostrar el código se necesita este teléfono y además ese PIN.",
  "clip-qr":
    "Cada vez que quiere mostrar su código, el teléfono le pide el PIN. El código se genera ahí mismo, " +
    "aunque no haya internet, y lleva la foto firmada adentro. Fíjense en la cuenta regresiva. A los " +
    "cuarenta y cinco segundos el código vence y aparece uno nuevo.",
  "clip-ingreso":
    "En la entrada, el guardia escanea el código y en pantalla le aparecen la foto, el nombre y el RUN de " +
    "la persona. Por detrás, el sistema revisa que tenga entrada y que ese código no se haya usado antes. " +
    "Pero el ingreso recién queda registrado cuando el guardia confirma que es la persona de la foto y " +
    "aprieta Dejar pasar.",
  "clip-vencido":
    "Ahora un intento de trampa. Alguien le sacó una foto al código hace más de cuarenta y cinco segundos " +
    "y trata de entrar con ella. Con el carnet esa foto habría funcionado. Acá el lector la rechaza, " +
    "porque el código ya venció.",
  "clip-nocoincide":
    "Otro intento. Esta vez el código es auténtico y está vigente, pero lo muestra otra persona, a quien " +
    "el titular se lo reenvió en vivo. El " +
    "sistema no tiene cómo saberlo y lo da por bueno. El que lo frena es el guardia, porque la foto que ve " +
    "en pantalla no es de quien tiene al frente, y rechaza el ingreso.",
  "caratula-cierre":
    "Resumiendo. Con el carnet basta una foto del código para pasar. Con el prototipo se necesita el " +
    "teléfono y el PIN, el código cambia cada cuarenta y cinco segundos y la foto viene firmada. Queda un " +
    "ataque que el sistema solo no detiene, que es reenviarle el código en vivo a un cómplice. Para eso " +
    "está el guardia, que compara la foto con la persona. El prototipo trae además una comparación de " +
    "rostro opcional. La diseñé apagada por defecto pensando en la nueva ley de datos personales, que " +
    "pide consentimiento expreso para usar datos biométricos. Gracias por ver.",
};

// --- Carátulas y pies, dibujados en el navegador ---------------------------------------------------

// Paleta y tipografía de la app («Azul confianza», frontend/src/index.css): fondo azul muy claro,
// superficies blancas con sombra suave y el azul de las acciones. El mismo fondo va de lienzo detrás de
// las escenas (FONDO). La Plus Jakarta Sans se incrusta desde el frontend, así que dibujar no pide red;
// si el frontend no tiene sus dependencias instaladas, cae a Segoe UI.
const TINTA = `
  --fondo: #f3f6fd; --superficie: #ffffff; --tinta: #142039; --tinta-2: #55617a; --tinta-3: #69758d;
  --linea: #dce3f0; --linea-suave: #e9eef7; --tenue: #e6edfd; --marca: #2f62e9; --marca-fuerte: #2450c4;
  --sombra: 0 1px 2px rgba(20,32,57,.06), 0 8px 24px rgba(20,32,57,.08);
`;

const FUENTE = (() => {
  const archivo = path.join(__dirname, "..", "frontend", "node_modules", "@fontsource-variable",
    "plus-jakarta-sans", "files", "plus-jakarta-sans-latin-wght-normal.woff2");
  if (!fs.existsSync(archivo)) return "";
  const datos = fs.readFileSync(archivo).toString("base64");
  return `@font-face{font-family:"Plus Jakarta Sans";font-weight:200 800;
    src:url(data:font/woff2;base64,${datos}) format("woff2")}`;
})();
const FAMILIA = `"Plus Jakarta Sans","Segoe UI",system-ui,sans-serif`;

const AUTORIA = [
  "Miguel Monzó Díaz",
  "Estudiante de Magíster en Ciencias, mención Computación",
  "Departamento de Ciencias de la Computación, Universidad de Chile",
  "Noviembre de 2026",
];

const PORTADA = (titulo, texto) => `<!doctype html><meta charset="utf-8"><style>
  ${FUENTE}
  :root{${TINTA}}
  html,body{margin:0;height:100%}
  body{background:var(--fondo);color:var(--tinta);font-family:${FAMILIA};
       display:flex;flex-direction:column;justify-content:space-between;padding:88px 104px 72px;box-sizing:border-box}
  .sello{display:inline-block;background:var(--tenue);color:var(--marca-fuerte);font-size:16px;font-weight:700;
         padding:7px 14px;border-radius:999px;margin-bottom:26px}
  h1{font-size:56px;line-height:1.12;margin:0;font-weight:800;letter-spacing:-.8px;max-width:24ch;text-wrap:balance}
  .bajada{font-size:25px;color:var(--tinta-2);margin:20px 0 0;line-height:1.45;font-weight:500}
  .pie{display:flex;justify-content:space-between;align-items:flex-end;gap:40px;
       border-top:1px solid var(--linea);padding-top:22px}
  .autoria{font-size:16px;color:var(--tinta-2);line-height:1.65;font-weight:500}
  .autoria b{font-size:19px;color:var(--tinta);font-weight:700}
  .aviso{font-size:14px;color:var(--tinta-3);text-align:right;max-width:42ch;line-height:1.5;font-weight:500}
</style>
<div>
  <span class="sello">Prototipo</span>
  <h1>${titulo}</h1>
  <p class="bajada">${texto}</p>
</div>
<div class="pie">
  <div class="autoria"><b>${AUTORIA[0]}</b><br>${AUTORIA.slice(1).join("<br>")}</div>
  <div class="aviso">Las personas, las fotografías y el Registro Civil son simulados para esta demostración.</div>
</div>`;

const FILAS_CIERRE = [
  ["Para mostrarlo", "Basta el plástico", "El teléfono y un PIN"],
  ["El código", "Siempre el mismo", "Nuevo cada 45 s, de un solo uso"],
  ["La fotografía", "Impresa en la tarjeta", "Firmada por el emisor"],
];

const CIERRE = (titulo) => `<!doctype html><meta charset="utf-8"><style>
  ${FUENTE}
  :root{${TINTA}}
  html,body{margin:0;height:100%}
  body{background:var(--fondo);color:var(--tinta);font-family:${FAMILIA};
       display:flex;flex-direction:column;justify-content:center;gap:30px;padding:56px 104px;box-sizing:border-box}
  h1{font-size:40px;font-weight:800;margin:0;letter-spacing:-.6px}
  .tarjeta{background:var(--superficie);border-radius:18px;box-shadow:var(--sombra);padding:8px 28px}
  table{border-collapse:collapse;width:100%}
  th,td{text-align:left;padding:17px 16px 17px 0;font-size:22px;vertical-align:top;font-weight:600}
  thead th{font-size:15px;color:var(--tinta-3);font-weight:700;border-bottom:1px solid var(--linea);padding:16px 16px 12px 0}
  thead th.digital{color:var(--marca)}
  tbody tr+tr td{border-top:1px solid var(--linea-suave)}
  td.que{color:var(--tinta-3);font-size:17px;width:22%;padding-top:20px;font-weight:600}
  td.carnet{width:33%;color:var(--tinta-2);font-weight:500}
  .nota{font-size:19px;color:var(--tinta-2);line-height:1.55;max-width:90ch;margin:0;font-weight:500}
</style>
<h1>${titulo}</h1>
<div class="tarjeta"><table>
  <thead><tr><th></th><th>Carnet físico</th><th class="digital">Prototipo con QR dinámico</th></tr></thead>
  <tbody>
    ${FILAS_CIERRE.map(([que, carnet, digital]) => `<tr>
      <td class="que">${que}</td><td class="carnet">${carnet}</td><td>${digital}</td></tr>`).join("")}
  </tbody>
</table></div>
<p class="nota">Queda un ataque que la validación automática no detiene: reenviar el código en vivo a un
  cómplice. A ese lo detiene el guardia, al comparar a la persona con la fotografía firmada.</p>`;

const GENERICA = (titulo, texto) => `<!doctype html><meta charset="utf-8"><style>
  ${FUENTE}
  :root{${TINTA}}
  html,body{margin:0;height:100%}
  body{background:var(--fondo);color:var(--tinta);font-family:${FAMILIA};
       display:flex;flex-direction:column;justify-content:center;padding:0 104px;box-sizing:border-box}
  h1{font-size:46px;line-height:1.15;margin:0 0 22px;font-weight:800}
  p{font-size:25px;line-height:1.5;margin:0;color:var(--tinta-2);max-width:1000px;font-weight:500}
</style><h1>${titulo}</h1><p>${texto}</p>`;

const PLANTILLAS = { intro: PORTADA, cierre: (titulo) => CIERRE(titulo) };
const caratulaHtml = (nombre, titulo, texto) => (PLANTILLAS[nombre] ?? GENERICA)(titulo, texto);

// El pie va en una superficie blanca como las tarjetas de la app, con el número en el azul de marca.
const pieHtml = (texto) => {
  const [, num, resto] = texto.match(/^(\d+)\.\s*(.*)$/) ?? [null, "", texto];
  return `<!doctype html><meta charset="utf-8"><style>
  ${FUENTE}
  html,body{margin:0;background:transparent}
  body{font-family:${FAMILIA};display:flex;justify-content:center;align-items:center;height:96px}
  span{background:#fff;color:#142039;font-size:23px;font-weight:600;padding:13px 26px;border-radius:14px;
       box-shadow:0 1px 2px rgba(20,32,57,.06),0 6px 18px rgba(20,32,57,.10)}
  b{color:#2f62e9;font-weight:800;margin-right:10px}
</style><span>${num ? `<b>${num}</b>` : ""}${resto}</span>`;
};

async function dibujar(browser) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  for (const [nombre, [titulo, texto]] of Object.entries(CARATULAS)) {
    await page.setContent(caratulaHtml(nombre, titulo, texto));
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(OUTV, `caratula-${nombre}.png`) });
  }
  await page.setViewportSize({ width: W, height: 96 });
  for (const [nombre, texto] of Object.entries(PIES)) {
    await page.setContent(pieHtml(texto));
    await page.evaluate(() => document.fonts.ready);
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

// `cwd` sirve para el filtro `ass`, que no acepta rutas de Windows dentro de sus opciones.
const ff = (args, cwd) =>
  execSync(`ffmpeg -y -hide_banner -loglevel error ${args}`, { stdio: "inherit", ...(cwd ? { cwd } : {}) });
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
  propias();
}

/**
 * Reemplaza la voz sintética por las grabaciones que haya en voz-propia/, una por tramo. Se convierten
 * a WAV con ffmpeg, así que sirve cualquier formato (el de la grabadora de Windows, entre otros).
 */
function propias() {
  if (!fs.existsSync(VOZ_PROPIA)) return;
  const usadas = [];
  for (const archivo of fs.readdirSync(VOZ_PROPIA)) {
    const id = archivo.replace(/\.[^.]+$/, "");
    if (!NARRACION[id]) {
      console.log(`  (se ignora ${archivo}: no hay un tramo que se llame "${id}")`);
      continue;
    }
    ff(`-i "${path.join(VOZ_PROPIA, archivo)}" -ac 1 -ar 48000 "${path.join(VOZ, `${id}.wav`)}"`);
    usadas.push(id);
  }
  if (usadas.length) console.log(`  voz propia en ${usadas.length} de ${Object.keys(NARRACION).length} tramos: ${usadas.join(", ")}`);
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
        `[0:v]scale=${W}:${H - 114}:force_original_aspect_ratio=decrease,` +
        `pad=iw+2:ih+2:1:1:color=0xdce3f0,pad=${W}:${H}:(ow-iw)/2:0:color=${FONDO}[b];` +
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
  // Siete tramos: portada, las cinco escenas y el cierre. Los títulos de sección viven en el pie de
  // cada escena, y no en carátulas propias, para que el video no se alargue con pantallas de texto.
  caratula("intro", 6);
  clip("cedula", clips.cedula);
  clip("qr", clips.qr);
  clip("ingreso", clips.ingreso);
  clip("vencido", clips.vencido);
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

/** Color de ASS: &HAABBGGRR. */
const ASS_ENCENDIDA = "&H00FFFFFF"; // la palabra que toca decir
const ASS_APAGADA = "&H00AA8D7C"; // las que faltan
const ASS_CAJA = "&HB426160E";

const reloj = (t) => {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const seg = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(seg).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};

/** Reparte la duración del tramo entre sus palabras, a prorrata del largo de cada una. */
function karaoke(texto, segundos) {
  const palabras = texto.split(/\s+/).filter(Boolean);
  const pesos = palabras.map((p) => p.length + 1);
  const total = pesos.reduce((a, b) => a + b, 0);
  let resto = Math.round(segundos * 100);
  return palabras
    .map((p, i) => {
      const cs = i === palabras.length - 1 ? resto : Math.max(8, Math.round((pesos[i] / total) * segundos * 100));
      resto -= cs;
      return `{\\k${cs}}${p} `;
    })
    .join("")
    .trim();
}

/**
 * Video apuntador: la misma imagen, sin audio, con la narración arriba y las palabras encendiéndose al
 * ritmo de la voz sintética. Sirve para leer encima y grabar la voz propia al mismo compás. Deja además
 * un recorte por tramo, para grabar de a poco y repetir solo el que salga mal.
 */
function apuntador(guion) {
  const tramos = guion.map((item, i) => ({
    id: item.id,
    archivo: path.join(PARTES, `${String(i).padStart(2, "0")}.mp4`),
  }));
  let t = 0;
  const lineas = [];
  const cortes = [];
  for (const tramo of tramos) {
    const dur = duracion(tramo.archivo);
    const texto = NARRACION[tramo.id];
    if (texto) {
      const wav = path.join(VOZ, `${tramo.id}.wav`);
      const hablado = fs.existsSync(wav) ? duracion(wav) : dur - 1.2;
      const desde = t + 0.35;
      lineas.push(
        `Dialogue: 0,${reloj(desde)},${reloj(desde + hablado)},Guion,,0,0,0,,${karaoke(texto, hablado)}`,
      );
    }
    cortes.push({ id: tramo.id, desde: t, dur });
    t += dur;
  }

  const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Guion,Segoe UI,33,${ASS_ENCENDIDA},${ASS_APAGADA},${ASS_CAJA},${ASS_CAJA},0,0,0,0,100,100,0,0,3,6,0,8,80,80,34,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${lineas.join("\n")}
`;
  const archivoAss = path.join(OUTV, "apuntador.ass");
  fs.writeFileSync(archivoAss, ass, "utf8");

  // El filtro `ass` no acepta rutas de Windows: los dos puntos de la unidad parten la opción. Se corre
  // ffmpeg desde la carpeta del archivo y se lo nombra a secas.
  const salida = path.join(OUTV, "video-apuntador.mp4");
  ff(`-i "${FINAL}" -vf "ass=apuntador.ass" ${VIDEO_ENC} -an "${salida}"`, OUTV);

  const porTramo = path.join(OUTV, "apuntador");
  fs.rmSync(porTramo, { recursive: true, force: true });
  fs.mkdirSync(porTramo, { recursive: true });
  for (const c of cortes) {
    if (!NARRACION[c.id]) continue;
    ff(`-ss ${c.desde.toFixed(2)} -t ${c.dur.toFixed(2)} -i "${salida}" ${VIDEO_ENC} -an "${path.join(porTramo, `${c.id}.mp4`)}"`);
  }
  console.log(`\nApuntador: ${salida}`);
  console.log(`Un recorte por tramo en ${porTramo}`);
}

function imprimeGuion() {
  console.log("Qué decir en cada tramo. Graba un archivo por tramo y déjalo en e2e/voz-propia/");
  console.log(`con el nombre del tramo (por ejemplo caratula-intro.m4a). Después: npm run video -- --montar\n`);
  for (const [id, texto] of Object.entries(NARRACION)) {
    const wav = path.join(VOZ, `${id}.wav`);
    const ref = fs.existsSync(wav) ? ` (la voz de Windows tarda ${duracion(wav).toFixed(0)} s)` : "";
    console.log(`── ${id}${ref}`);
    console.log(`${texto}\n`);
  }
}

(async () => {
  if (SOLO_GUION) {
    imprimeGuion();
    return;
  }
  if (SOLO_MONTAR || SOLO_APUNTADOR) {
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
    if (!SOLO_APUNTADOR) {
      console.log("- carátulas");
      const browser = await c.chromium().launch(c.launchOptions());
      await dibujar(browser);
      await browser.close();
      console.log("- narración");
      narrar();
    }
    secuencia(clips);
    if (SOLO_APUNTADOR) {
      console.log("- apuntador");
      apuntador(guion);
      return;
    }
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
    if (!SOLO_MONTAR && !SOLO_GUION && !SOLO_APUNTADOR) c.stopAll();
    process.exit(process.exitCode ?? 0);
  });
