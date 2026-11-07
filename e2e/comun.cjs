// Preparación compartida del simulacro y de la auditoría: datos temporales (nunca la base ni el padrón
// de la demo), compilación del cliente en modo celular, servicios en la IP local con HTTPS y cierre ordenado.
// Ver e2e/README.md.
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { spawn, execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const BACKEND = path.join(ROOT, "backend");
const FRONTEND = path.join(ROOT, "frontend");
const RESULTS = path.join(ROOT, "docs", "results");
const OUT = path.join(__dirname, "salida");
const FORWARDED = '--forwarded-allow-ips "127.0.0.1,::1"';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function lanIp() {
  const all = Object.values(os.networkInterfaces()).flat().filter((i) => i.family === "IPv4" && !i.internal);
  const ip = (all.find((i) => i.address.startsWith("192.168.")) ?? all[0])?.address;
  if (!ip) throw new Error("No hay una IP de red local: el simulacro necesita una (los teléfonos entran por ella).");
  return ip;
}

const IP = lanIp();
const BASE = `https://${IP}:4173`;

/** Variables de entorno de los servicios: todo en salida/, con un secreto nuevo en cada corrida. */
function prepareEnv() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, "registro_civil"), { recursive: true });
  const rc = path.join(OUT, "registro_civil");
  const databaseUrl = process.env.E2E_DATABASE_URL || `sqlite:///${path.join(OUT, "e2e.db").replace(/\\/g, "/")}`;
  if (databaseUrl.includes("control_acceso.db")) throw new Error("E2E_DATABASE_URL apunta a la base de la demo: usa otra.");
  Object.assign(process.env, {
    DATABASE_URL: databaseUrl,
    JWT_SECRET: crypto.randomBytes(36).toString("base64url"),
    REGISTRO_CIVIL_DIR: rc,
    ISSUER_PUBLIC_KEY_FILE: path.join(rc, "issuer_public.key"),
    VERIFIER_PRIVATE_KEY_FILE: path.join(rc, "verifier_private.key"),
  });
  return databaseUrl.startsWith("sqlite") ? "SQLite" : "PostgreSQL";
}

/** Base vacía y datos demo. Con PostgreSQL borra las tablas de esa base. */
function seed() {
  if (!process.env.DATABASE_URL.startsWith("sqlite")) {
    execSync(
      'uv run python -c "from app.database import Base, engine; import app.models; Base.metadata.drop_all(engine)"',
      { cwd: BACKEND, env: process.env, stdio: "ignore" },
    );
  }
  execSync("uv run python -m app.seed", { cwd: BACKEND, env: process.env, stdio: "ignore" });
}

function build() {
  execSync(`npx vite build --mode celular --outDir "${path.join(OUT, "dist")}" --emptyOutDir`, {
    cwd: FRONTEND,
    env: process.env,
    stdio: "ignore",
  });
}

const running = {};

function service(name, command, cwd) {
  const log = fs.openSync(path.join(OUT, `${name}.log`), "w");
  // En Linux y macOS, un grupo propio para poder cerrar el árbol entero (process.kill(-pid)).
  const detached = process.platform !== "win32";
  running[name] = spawn(command, { cwd, shell: true, detached, stdio: ["ignore", log, log], env: process.env });
  return running[name];
}

function stop(proc) {
  try {
    if (process.platform === "win32") execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: "ignore" });
    else process.kill(-proc.pid);
  } catch {}
}

const backendCmd = `uv run uvicorn app.main:app --port 8000 --no-server-header ${FORWARDED}`;

async function waitUrl(url, seconds = 60) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // solo este PC: certificado autofirmado del modo celular
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`no responde ${url}`);
}

/** Prepara todo y levanta backend, Registro Civil simulado y la versión de producción del cliente. */
async function startAll() {
  const database = prepareEnv();
  seed();
  build();
  service("backend", backendCmd, BACKEND);
  service("rc", `uv run uvicorn registro_civil.app:app --port 8001 --no-server-header ${FORWARDED}`, BACKEND);
  service("front", `npx vite preview --mode celular --host --port 4173 --strictPort --outDir "${path.join(OUT, "dist")}"`, FRONTEND);
  await waitUrl(`${BASE}/api/health`);
  await waitUrl(`${BASE}/registro-civil/health`);
  return database;
}

function stopAll() {
  for (const proc of Object.values(running)) stop(proc);
}

/** Chromium de Playwright; CHROME_PATH permite usar otro ya instalado. */
function chromium() {
  return require("playwright-core").chromium;
}
const launchOptions = (args = []) => ({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", ...args],
});

/** Video MJPEG para la cámara simulada de Chromium: el QR (si se da) o una imagen negra. */
function cameraVideo(target, qrImage) {
  const script = path.join(__dirname, "camara_mjpeg.py");
  execSync(`uv run python "${script}" "${target}" ${qrImage ? `"${qrImage}"` : ""}`, { cwd: BACKEND, env: process.env, stdio: "ignore" });
  return target;
}

function writeResult(name, data) {
  fs.mkdirSync(RESULTS, { recursive: true });
  const meta = { generated_at: new Date().toISOString().slice(0, 19) + "Z", platform: `${os.type()} ${os.release()} / Node ${process.version}` };
  fs.writeFileSync(path.join(RESULTS, name), JSON.stringify({ meta, ...data }, null, 2));
}

module.exports = {
  BACKEND,
  BASE,
  IP,
  OUT,
  backendCmd,
  cameraVideo,
  chromium,
  launchOptions,
  running,
  service,
  sleep,
  startAll,
  stop,
  stopAll,
  waitUrl,
  writeResult,
};
