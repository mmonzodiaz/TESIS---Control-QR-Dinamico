// Auditoría de accesibilidad (axe-core: WCAG 2.0, 2.1 y 2.2 en los niveles A y AA, más buenas prácticas) de
// cada pantalla, y dos medidas que axe no cubre: objetivos táctiles menores de 24 px y título del documento.
// Datos temporales. Escribe docs/results/accesibilidad.json. Ver e2e/README.md.
const fs = require("fs");
const path = require("path");
const c = require("./comun.cjs");

const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const PIN = "482913";
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 };
const DESK = { viewport: { width: 1366, height: 860 }, deviceScaleFactor: 1 };
const report = [];

async function page(browser, opts) {
  // bypassCSP: solo para inyectar axe en la auditoría; la app sigue con su CSP en uso real.
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, bypassCSP: true, permissions: ["camera"], ...opts });
  ctx.setDefaultTimeout(30000);
  return ctx.newPage();
}

async function audit(p, screen) {
  await c.sleep(400);
  await p.evaluate(AXE);
  const violations = await p.evaluate(async () => {
    const r = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
    });
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      count: v.nodes.length,
      nodes: v.nodes.slice(0, 4).map((n) => `${n.target.join(" ")} :: ${(n.failureSummary || "").split("\n").slice(1, 2).join(" ").slice(0, 140)}`),
    }));
  });
  // WCAG 2.5.8 pide al menos 24 x 24 px (o espacio equivalente). Los enlaces dentro de un texto están exentos.
  const smallTargets = await p.evaluate(() =>
    [...document.querySelectorAll("button, a[href], input, select, label[aria-label]")]
      .filter((el) => el.offsetParent !== null || el.getClientRects().length)
      .map((el) => {
        const r = el.getBoundingClientRect();
        const name = (el.getAttribute("aria-label") || el.textContent || el.id || el.tagName).trim().replace(/\s+/g, " ").slice(0, 40);
        return { name, w: Math.round(r.width), h: Math.round(r.height) };
      })
      .filter((t) => t.w > 0 && t.h > 0 && (t.w < 24 || t.h < 24)),
  );
  report.push({ screen, title: await p.title(), violations, smallTargets });
}

async function typePin(p, pin = PIN) {
  for (const d of pin) await p.getByRole("button", { name: d, exact: true }).click();
}

async function login(browser, email, password, opts) {
  const p = await page(browser, opts);
  await p.goto(`${c.BASE}/login`);
  await p.locator('input[type="email"]').fill(email);
  await p.locator('input[type="password"]').fill(password);
  await p.getByRole("button", { name: "Ingresar" }).click();
  await p.waitForURL((u) => !u.pathname.endsWith("/login"));
  return p;
}

(async () => {
  const database = await c.startAll();
  const black = c.cameraVideo(path.join(c.OUT, "camara-negra.mjpeg"));
  const browser = await c.chromium().launch(c.launchOptions([`--use-file-for-fake-video-capture=${black}`]));

  // App de la cédula
  const p = await page(browser, PHONE);
  await p.goto(`${c.BASE}/mi-cedula`);
  await p.getByLabel("RUN").waitFor();
  await audit(p, "cédula: activar");
  await p.getByLabel("RUN").fill("11.111.111-2");
  await p.getByLabel("Clave de activación").fill("RCUNO234");
  await p.getByRole("button", { name: "Obtener mi cédula digital" }).click();
  await p.locator("#enroll-rut-error").waitFor();
  await audit(p, "cédula: error de RUN");
  await p.getByRole("button", { name: /Perdiste tu teléfono/ }).click();
  await p.getByRole("button", { name: "Desactivar mi cédula" }).waitFor();
  await audit(p, "cédula: reportar pérdida");
  await p.getByRole("button", { name: "Volver" }).click();
  await p.getByLabel("RUN").fill("11.111.111-1");
  await p.getByLabel("Clave de activación").fill("RCUNO234");
  await p.getByRole("button", { name: "Obtener mi cédula digital" }).click();
  await p.getByText("Crea tu PIN de 6 dígitos").waitFor();
  await audit(p, "cédula: crear PIN");
  await typePin(p);
  await p.getByText("Repite tu PIN").waitFor();
  await typePin(p);
  await p.getByRole("button", { name: "Dónde puedes usarla" }).click();
  await p.getByText("Concierto Demo - Estadio").waitFor();
  await audit(p, "cédula: vista");
  await p.getByRole("button", { name: /Mostrar mi QR/ }).click();
  await p.getByRole("dialog", { name: "Confirma tu PIN" }).waitFor();
  await audit(p, "cédula: confirmar PIN");
  await typePin(p, "000000");
  await p.getByText("PIN incorrecto. Inténtalo de nuevo.").waitFor();
  await c.sleep(500);
  await audit(p, "cédula: confirmar PIN (error)");
  await typePin(p);
  await p.getByRole("dialog", { name: "Tu código QR" }).waitFor();
  await audit(p, "cédula: QR");
  await c.sleep(400);
  const qr = path.join(c.OUT, "qr-auditoria.png");
  await p.screenshot({ path: qr });
  await p.getByRole("button", { name: "Cerrar QR" }).click();
  await p.getByRole("button", { name: "Bloquear" }).click();
  await p.getByText("Ingresa tu PIN").waitFor();
  await audit(p, "cédula: desbloquear");

  // Personal
  const lp = await page(browser, DESK);
  await lp.goto(`${c.BASE}/login`);
  await lp.getByLabel("Correo").waitFor();
  await audit(lp, "personal: ingreso");

  const g = await login(browser, "guardia@demo.cl", "guardia-demo-2026", PHONE);
  await g.getByText(/Apunta al QR/).waitFor();
  await audit(g, "escáner: espera");
  await g.getByTestId("leer-imagen").setInputFiles(qr);
  await g.getByText("¿Es la persona que tienes al frente?").waitFor();
  await audit(g, "escáner: decidir");
  await g.getByRole("button", { name: /No coincide/ }).click();
  await g.getByText("Rechazado: la foto no coincide").waitFor();
  await audit(g, "escáner: rechazo");

  const a = await login(browser, "admin@demo.cl", "admin-demo-2026", DESK);
  await a.getByText("Asistente Uno").first().waitFor();
  await audit(a, "administración: eventos");
  await a.goto(`${c.BASE}/prohibiciones`);
  await a.getByLabel("RUT").waitFor();
  await audit(a, "administración: prohibiciones");
  await a.goto(`${c.BASE}/usuarios`);
  await a.getByText("guardia@demo.cl").waitFor();
  await audit(a, "administración: personal");
  await a.goto(`${c.BASE}/historial`);
  await a.getByText("Actividad reciente").waitFor();
  await c.sleep(600);
  await audit(a, "administración: historial");
  const am = await login(browser, "admin@demo.cl", "admin-demo-2026", PHONE);
  await am.getByText("Asistente Uno").first().waitFor();
  await audit(am, "administración: eventos en teléfono");
  await am.getByRole("button", { name: "Abrir menú" }).click();
  await audit(am, "administración: menú en teléfono");
  await browser.close();

  const violations = report.reduce((n, s) => n + s.violations.reduce((m, v) => m + v.count, 0), 0);
  c.writeResult("accesibilidad.json", {
    database,
    axe_version: require("axe-core/package.json").version,
    screens: report.length,
    violations,
    report,
  });
  console.log(`PANTALLAS ${report.length} · INFRACCIONES ${violations}`);
  for (const s of report) for (const v of s.violations) console.log(`  [${v.impact}] ${s.screen} | ${v.id}: ${v.help}\n    ${v.nodes.join("\n    ")}`);
  for (const s of report) if (s.smallTargets.length) console.log(`  objetivo < 24 px · ${s.screen}: ${s.smallTargets.map((t) => `${t.name} ${t.w}x${t.h}`).join(", ")}`);
  if (violations) process.exitCode = 1;
})()
  .catch((err) => {
    console.log("ABORTADO", String(err).slice(0, 500));
    process.exitCode = 1;
  })
  .finally(() => {
    c.stopAll();
    process.exit(process.exitCode ?? 0);
  });
