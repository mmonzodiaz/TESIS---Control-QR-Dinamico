// Simulacro del piloto: sigue docs/piloto.md (guion del §4 y comprobaciones del §5) en un navegador, por la
// IP local, con HTTPS y bloqueando todo lo que no sea esa IP (sin internet). Usa datos temporales y levanta y
// detiene sus propios servicios. Escribe docs/results/simulacro.json. Ver e2e/README.md.
const path = require("path");
const { execSync } = require("child_process");
const c = require("./comun.cjs");

const PIN = "482913";
const results = [];
const problems = [];
const blocked = new Set();

async function step(id, description, expected, fn) {
  let observed;
  try {
    observed = await fn();
  } catch (err) {
    observed = `ERROR: ${String(err).split("\n")[0].slice(0, 150)}`;
  }
  const ok = expected instanceof RegExp ? expected.test(String(observed)) : String(observed) === String(expected);
  results.push({ id, description, expected: String(expected), observed: String(observed), ok });
  console.log(`${ok ? "OK   " : "FALLA"} ${id} ${description} -> ${observed}`);
}

async function context(browser, extra = {}) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, ...extra });
  ctx.setDefaultTimeout(30000); // sin esto, esperar un botón que no aparece cuelga el simulacro
  await ctx.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === c.IP) return route.continue();
    blocked.add(host);
    return route.abort();
  });
  return ctx;
}

function watch(page, label) {
  page.on("pageerror", (e) => problems.push(`${label} pageerror: ${String(e).slice(0, 180)}`));
}

async function typePin(page) {
  for (const d of PIN) await page.getByRole("button", { name: d, exact: true }).click();
}

async function activate(browser, rut, clave, tag) {
  const ctx = await context(browser);
  const page = await ctx.newPage();
  watch(page, `telefono-${tag}`);
  await page.goto(`${c.BASE}/mi-cedula`);
  await page.getByLabel("RUN").fill(rut);
  await page.getByLabel("Clave de activación").fill(clave);
  await page.getByRole("button", { name: "Obtener mi cédula digital" }).click();
  await page.getByText("Crea tu PIN de 6 dígitos").waitFor();
  await typePin(page);
  await page.getByText("Repite tu PIN").waitFor();
  await typePin(page);
  await page.getByRole("button", { name: /Mostrar mi QR/ }).waitFor({ timeout: 30000 });
  return page;
}

let qrCounter = 0;
/** Cerrar y volver a abrir genera un QR nuevo, como dice el guion. La app pide el PIN antes de cada QR. */
async function freshQr(phone, tag, scale = "css") {
  await phone.getByRole("button", { name: /Mostrar mi QR/ }).click();
  await phone.getByRole("dialog", { name: "Confirma tu PIN" }).waitFor();
  await typePin(phone);
  await phone.getByRole("dialog", { name: "Tu código QR" }).waitFor();
  const file = path.join(c.OUT, `qr-${tag}-${++qrCounter}.png`);
  await c.sleep(300);
  await phone.screenshot({ path: file, scale }); // la pantalla completa, con su margen blanco, como la ve una cámara
  await phone.getByRole("button", { name: "Cerrar QR" }).click();
  return file;
}

async function login(browser, email, password, gate, extra) {
  const ctx = await context(browser, { permissions: ["camera"], ...extra });
  const page = await ctx.newPage();
  watch(page, `escaner-${email}`);
  await page.goto(`${c.BASE}/login`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /ingresar|entrar/i }).click();
  await page.waitForURL("**/escanear");
  await page.getByText(/Apunta al QR|Descargando/).first().waitFor({ timeout: 30000 });
  await page.getByLabel("Fila").selectOption({ label: gate });
  return page;
}

const sheet = (page) => page.locator('[aria-live="assertive"]');

async function title(page) {
  await sheet(page).waitFor({ timeout: 30000 });
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    const text = (await sheet(page).locator("p").first().innerText()).trim();
    if (!/^(Verificando|Registrando)/.test(text)) return text;
    await c.sleep(100);
  }
  throw new Error("sin resultado");
}

async function present(page, file) {
  await page.getByTestId("leer-imagen").setInputFiles(file);
  return title(page);
}

async function clear(page) {
  const next = page.getByRole("button", { name: "Siguiente" });
  if (await next.count()) await next.click();
  await sheet(page).waitFor({ state: "detached", timeout: 6000 });
}

const reabrir = () =>
  execSync("uv run python scripts/piloto.py reabrir --evento 1", { cwd: c.BACKEND, env: process.env, encoding: "utf8" }).trim().split("\n").at(-1);

async function adminToken() {
  const res = await fetch(`${c.BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "username=admin%40demo.cl&password=admin-demo-2026",
  });
  return (await res.json()).access_token;
}

(async () => {
  const database = await c.startAll();
  console.log(`IP ${c.IP} · base ${database}`);
  const browser = await c.chromium().launch(c.launchOptions());

  // --- Preparación, como el día anterior ---
  const uno = await activate(browser, "11.111.111-1", "RCUNO234", "uno");
  const fotoVencida = await freshQr(uno, "foto-vencida");
  const tomada = Date.now();
  const dos = await activate(browser, "22.222.222-2", "RCDOS234", "dos");
  const tres = await activate(browser, "12.345.678-5", "RCTRES23", "tres");
  const headers = { Authorization: `Bearer ${await adminToken()}` };
  const tickets = await (await fetch(`${c.BASE}/api/events/1/tickets`, { headers })).json();
  const ticketTres = tickets.find((t) => t.document_id === "123456785");
  await fetch(`${c.BASE}/api/tickets/${ticketTres.id}`, { method: "DELETE", headers });

  const guard = await login(browser, "guardia@demo.cl", "guardia-demo-2026", "Fila cédula digital A");
  await step("0.1", "Contexto seguro por IP local", true, () => guard.evaluate(() => window.isSecureContext));
  await step("0.2", "Comparación facial apagada", 0, () => guard.getByRole("button", { name: /Comparar rostro/ }).count());

  // La foto del paso 3 tiene que tener más de 50 s, como pide el guion.
  await c.sleep(Math.max(0, 52000 - (Date.now() - tomada)));

  // --- Tres demostraciones seguidas del guion ---
  for (const n of [1, 2, 3]) {
    await step(`D${n}.3`, "Foto vencida del QR", "Código expirado", () => present(guard, fotoVencida));
    await clear(guard);
    const copia = await freshQr(uno, "copia");
    await step(`D${n}.4a`, "Otra persona con QR vigente: pide decidir", "Cédula válida y con entrada", () => present(guard, copia));
    await guard.getByRole("button", { name: /No coincide/ }).click();
    await step(`D${n}.4b`, "El guardia toca No coincide", "Rechazado: la foto no coincide", () => title(guard));
    await clear(guard);
    if (n === 1) {
      await step("D1.4c", "Si no se renueva el QR y se relee", "Código ya utilizado", () => present(guard, copia));
      await clear(guard);
    }
    const nuevo = await freshQr(uno, "ingreso");
    await step(`D${n}.5a`, "Titular con QR nuevo", "Cédula válida y con entrada", () => present(guard, nuevo));
    await guard.getByRole("button", { name: /Dejar pasar/ }).click();
    await step(`D${n}.5b`, "El guardia toca Dejar pasar", "Ingreso registrado", () => title(guard));
    await sheet(guard).waitFor({ state: "detached", timeout: 6000 });
    if (n === 1) {
      const sinReabrir = await freshQr(uno, "sin-reabrir");
      await step("D1.6", "Sin reabrir, otra demostración falla como avisa el guion", "Esta entrada ya ingresó", () => present(guard, sinReabrir));
      await clear(guard);
    }
    await step(`D${n}.7`, "piloto.py reabrir", /Reabiertas 1 entradas/, async () => reabrir());
  }

  // --- Comprobaciones técnicas (§5) ---
  const sinEntrada = await freshQr(tres, "tres");
  await step("T1", "RUT sin entrada", "Sin entrada para este evento", () => present(guard, sinEntrada));
  await clear(guard);

  const lossCtx = await context(browser);
  const loss = await lossCtx.newPage();
  await loss.goto(`${c.BASE}/mi-cedula`);
  await loss.getByRole("button", { name: /Perdiste tu teléfono/ }).click();
  await loss.getByLabel("RUN").fill("22.222.222-2");
  await loss.getByLabel("Clave de activación").fill("RCDOS234");
  await loss.getByRole("button", { name: "Desactivar mi cédula" }).click();
  await loss.getByText("Cédula desactivada").waitFor();
  await lossCtx.close();
  await c.sleep(31000);
  const perdido = await freshQr(dos, "perdido");
  await step("T2", "Teléfono reportado como perdido, tras 31 s", "Cédula revocada", () => present(guard, perdido));
  await clear(guard);

  // Cámara simulada con un video del QR: lee por el mismo camino que un teléfono.
  const qrCamara = await freshQr(uno, "camara", "device");
  const video = c.cameraVideo(path.join(c.OUT, "camara.mjpeg"), qrCamara);
  const browserCam = await c.chromium().launch(c.launchOptions([`--use-file-for-fake-video-capture=${video}`]));
  const cam = await login(browserCam, "guardia2@demo.cl", "guardia-demo-2026", "Fila normal B", { viewport: { width: 1280, height: 800 } });
  await step("T3", "QR leído por la cámara simulada", "Cédula válida y con entrada", () => title(cam));
  await cam.getByRole("button", { name: /No coincide/ }).click();
  await title(cam);
  await clear(cam);
  await c.sleep(6000);
  await step("T4", "La misma imagen sigue frente a la cámara tras Siguiente", "sin reaccion", async () =>
    (await sheet(cam).count()) === 0 ? "sin reaccion" : `aparece: ${await title(cam)}`,
  );
  await browserCam.close();

  // Caída de red: dos puertas con copia reciente, la misma persona por ambas.
  await guard.context().close();
  reabrir();
  const puertaA = await login(browser, "guardia@demo.cl", "guardia-demo-2026", "Fila cédula digital A");
  const puertaB = await login(browser, "guardia2@demo.cl", "guardia-demo-2026", "Fila normal B");
  await c.sleep(1500);
  const offA = await freshQr(uno, "sinred-a");
  const offB = await freshQr(uno, "sinred-b");
  c.stop(c.running.backend);
  await c.sleep(1500);
  await step("T5a", "Sin red, puerta A", "Sin conexión: cédula válida y con entrada", () => present(puertaA, offA));
  await puertaA.getByRole("button", { name: /Dejar pasar/ }).click();
  await step("T5b", "Decisión sin red, puerta A", "Ingreso registrado sin conexión", () => title(puertaA));
  await step("T5c", "Sin red, puerta B, misma persona", "Sin conexión: cédula válida y con entrada", () => present(puertaB, offB));
  await puertaB.getByRole("button", { name: /Dejar pasar/ }).click();
  await title(puertaB);
  c.service("backend", c.backendCmd, c.BACKEND);
  await c.waitUrl(`${c.BASE}/api/health`);
  await step("T6", "Al volver la red, sincronizan", "0", async () => {
    const end = Date.now() + 45000;
    let a = 1;
    let b = 1;
    while (Date.now() < end && (a || b)) {
      a = await puertaA.getByText(/por sincronizar/).count();
      b = await puertaB.getByText(/por sincronizar/).count();
      await c.sleep(1000);
    }
    return String(a + b);
  });
  const logs = await (await fetch(`${c.BASE}/api/logs?limit=500`, { headers: { Authorization: `Bearer ${await adminToken()}` } })).json();
  const offline = logs.filter((l) => l.offline);
  await step("T7", "Ingresos sin red en el historial", 2, () => offline.length);
  await step("T8", "Doble ingreso queda como alerta", "already_admitted", () => offline.find((l) => l.reason !== "ok")?.reason ?? "sin alerta");
  await step("T9", "El otro ingreso queda válido", "ok", () => offline.find((l) => l.reason === "ok")?.reason ?? "ninguno");

  await browser.close();

  const summary = {
    database,
    total: results.length,
    ok: results.filter((r) => r.ok).length,
    blocked_hosts: [...blocked],
    page_errors: problems,
    steps: results,
  };
  c.writeResult(database === "SQLite" ? "simulacro.json" : "simulacro-postgresql.json", summary);
  console.log(`\n${summary.ok} de ${summary.total} comprobaciones. Hosts bloqueados: ${summary.blocked_hosts.length}. Errores de página: ${problems.length}.`);
  if (summary.ok !== summary.total || problems.length) process.exitCode = 1;
})()
  .catch((err) => {
    console.log("ABORTADO", String(err).slice(0, 600), JSON.stringify({ problems }));
    process.exitCode = 1;
  })
  .finally(() => {
    c.stopAll();
    process.exit(process.exitCode ?? 0);
  });
