# /// script
# requires-python = ">=3.11"
# ///
"""Levanta la demo completa con un solo comando, en este PC o en cualquier otro.

    uv run demo.py               # prepara todo, levanta los servicios y abre el tunel publico
    uv run demo.py --local       # sin tunel: solo en este PC (http://localhost:4173)
    uv run demo.py --reiniciar   # borra la base de la demo y vuelve a crear los datos de ejemplo
    uv run demo.py --verificar   # levanta todo, comprueba que responda y se detiene (probar un PC nuevo)

En Windows tambien sirve doble clic en demo.cmd.

Requisitos: uv, Node.js 20+ y, para el tunel, cloudflared (ver README, "Demo en un solo comando").
Hace, en orden: instala dependencias si faltan, crea backend/.env con un JWT_SECRET aleatorio si no
existe, crea los datos demo (idempotente), compila el frontend, levanta el backend del evento
(8000), el Registro Civil simulado (8001) y la version de produccion del frontend (4173), abre un
tunel rapido de Cloudflare (URL https://<aleatorio>.trycloudflare.com, cambia cada vez) y muestra
las direcciones y cuentas. Ctrl+C lo detiene todo. Los registros de cada servicio quedan en
.demo-logs/.
"""

import argparse
import os
import queue
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
LOGS = ROOT / ".demo-logs"
WINDOWS = os.name == "nt"

PORTS = {"backend": 8000, "registro civil": 8001, "frontend": 4173}
TUNNEL_URL = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")

processes: list[subprocess.Popen] = []


def say(text: str = "") -> None:
    print(text, flush=True)


def fail(text: str) -> None:
    say(f"\n[ERROR] {text}")
    stop_all()
    sys.exit(1)


def find_tool(name: str, extra: list[Path] = ()) -> str | None:
    found = shutil.which(name)
    if found:
        return found
    for candidate in extra:
        if candidate.exists():
            return str(candidate)
    return None


def run(cmd: list[str], cwd: Path, what: str) -> None:
    say(f"  - {what}...")
    result = subprocess.run(
        cmd, cwd=cwd, stdin=subprocess.DEVNULL, capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    if result.returncode != 0:
        say(result.stdout[-2000:])
        say(result.stderr[-2000:])
        fail(f"fallo: {what}")


def start(name: str, cmd: list[str], cwd: Path) -> tuple[subprocess.Popen, Path]:
    log = LOGS / f"{name.replace(' ', '-')}.log"
    handle = open(log, "w", encoding="utf-8", errors="replace")
    kwargs = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if WINDOWS else {"start_new_session": True}
    # stdin=DEVNULL: los servicios no leen del teclado, y en Windows heredar la entrada estandar
    # mientras el hilo de comandos esta esperando una linea deja colgado el arranque del proceso.
    proc = subprocess.Popen(cmd, cwd=cwd, stdin=subprocess.DEVNULL, stdout=handle, stderr=subprocess.STDOUT, **kwargs)
    processes.append(proc)
    return proc, log


def kill_tree(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    try:
        if WINDOWS:
            # Termina el arbol completo: npx y uv dejan procesos hijos que si no seguirian
            # ocupando los puertos.
            subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
        else:
            os.killpg(proc.pid, signal.SIGTERM)
        proc.wait(timeout=10)
    except (OSError, ProcessLookupError, subprocess.TimeoutExpired):
        pass


def stop_all() -> None:
    for proc in reversed(processes):
        kill_tree(proc)
    processes.clear()


def port_busy(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0 or _ipv6_busy(port)


def _ipv6_busy(port: int) -> bool:
    try:
        with socket.socket(socket.AF_INET6) as s:
            s.settimeout(0.5)
            return s.connect_ex(("::1", port)) == 0
    except OSError:
        return False


def wait_http(url: str, what: str, proc: subprocess.Popen, log: Path, seconds: int = 60) -> None:
    deadline = time.time() + seconds
    while time.time() < deadline:
        if proc.poll() is not None:
            fail(f"{what} se detuvo al arrancar. Ultimas lineas de {log}:\n{tail(log)}")
        try:
            with urllib.request.urlopen(url, timeout=3) as res:
                if res.status < 500:
                    return
        except (urllib.error.URLError, OSError):
            pass
        time.sleep(1)
    fail(f"{what} no respondio en {seconds} s. Ultimas lineas de {log}:\n{tail(log)}")


def tail(log: Path, lines: int = 15) -> str:
    try:
        return "\n".join(log.read_text(encoding="utf-8", errors="replace").splitlines()[-lines:])
    except OSError:
        return "(sin registro)"


def ensure_env() -> None:
    env = BACKEND / ".env"
    if not env.exists():
        shutil.copy(BACKEND / ".env.example", env)
        say("  - backend/.env creado desde .env.example")
    text = env.read_text(encoding="utf-8")
    match = re.search(r"^JWT_SECRET=(.*)$", text, flags=re.M)
    current = match.group(1).strip() if match else ""
    if len(current) < 32 or current == "change-me-please-super-secret":
        line = f"JWT_SECRET={secrets.token_urlsafe(48)}"
        text = re.sub(r"^JWT_SECRET=.*$", line, text, flags=re.M) if match else text.rstrip("\n") + "\n" + line + "\n"
        env.write_text(text, encoding="utf-8")
        say("  - JWT_SECRET aleatorio generado en backend/.env")
    frontend_env = FRONTEND / ".env"
    if not frontend_env.exists() and (FRONTEND / ".env.example").exists():
        shutil.copy(FRONTEND / ".env.example", frontend_env)


def frontend_deps_stale() -> bool:
    """npm reescribe node_modules/.package-lock.json en cada instalacion: si package-lock.json es
    mas nuevo (p. ej. despues de un git pull que agrego dependencias), lo instalado esta vencido y
    el build fallaria con 'Cannot find module'."""
    installed = FRONTEND / "node_modules" / ".package-lock.json"
    if not installed.exists():
        return True
    return (FRONTEND / "package-lock.json").stat().st_mtime > installed.stat().st_mtime


def check_login(base: str) -> None:
    """Inicia sesion como guardia a traves del frontend (y del tunel si lo hay): prueba la cadena completa."""
    data = "username=guardia%40demo.cl&password=guardia-demo-2026".encode()
    req = urllib.request.Request(
        f"{base}/api/auth/login", data=data, headers={"Content-Type": "application/x-www-form-urlencoded"}
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            if res.status != 200:
                fail(f"el login de prueba respondio {res.status}")
    except urllib.error.HTTPError as exc:
        fail(f"el login de prueba respondio {exc.code} (si cambiaste la contrasena del guardia, es esperable)")
    say(f"  - login de prueba del guardia por {base}: correcto")


def main() -> None:
    parser = argparse.ArgumentParser(description="Levanta la demo de la cedula digital con QR dinamico.")
    parser.add_argument("--local", action="store_true", help="sin tunel: solo en este PC")
    parser.add_argument("--reiniciar", action="store_true", help="borra la base de la demo y recrea los datos de ejemplo")
    parser.add_argument("--verificar", action="store_true", help="levanta todo, comprueba que responda y se detiene")
    args = parser.parse_args()

    say("\n=== Demo: cedula digital con QR dinamico ===\n")
    say("1. Revisando herramientas")
    uv = find_tool("uv")
    npm = find_tool("npm.cmd" if WINDOWS else "npm")
    npx = find_tool("npx.cmd" if WINDOWS else "npx")
    cloudflared = find_tool(
        "cloudflared",
        [Path(r"C:\Program Files (x86)\cloudflared\cloudflared.exe"), Path(r"C:\Program Files\cloudflared\cloudflared.exe")],
    )
    if not uv:
        fail("falta uv: https://docs.astral.sh/uv/getting-started/installation/")
    if not npm or not npx:
        fail("falta Node.js (20 o superior): https://nodejs.org")
    use_tunnel = not args.local
    if use_tunnel and not cloudflared:
        say("  ! falta cloudflared: sigo sin tunel (solo en este PC).")
        say("    Para instalarlo: Windows 'winget install Cloudflare.cloudflared', macOS 'brew install cloudflared'.")
        use_tunnel = False

    busy = [f"{name} ({port})" for name, port in PORTS.items() if port_busy(port)]
    if busy:
        fail(
            "hay puertos ocupados: " + ", ".join(busy) + ". Probablemente la demo (u otro servidor) ya esta "
            "corriendo: cierrala antes. En Windows puedes ver quien lo ocupa con 'netstat -ano | findstr :8000'."
        )

    say("2. Preparando (la primera vez tarda unos minutos)")
    LOGS.mkdir(exist_ok=True)
    ensure_env()
    run([uv, "sync"], BACKEND, "dependencias del backend")
    if frontend_deps_stale():
        run([npm, "ci"], FRONTEND, "dependencias del frontend")
    if args.reiniciar:
        (BACKEND / "control_acceso.db").unlink(missing_ok=True)
        say("  - base de la demo borrada")
    run([uv, "run", "python", "-m", "app.seed"], BACKEND, "datos de ejemplo (personal, evento, entradas y padron)")
    run([npm, "run", "build"], FRONTEND, "compilando el frontend")

    say("3. Levantando servicios")
    backend_cmd = [uv, "run", "uvicorn", "app.main:app", "--port", "8000", "--no-server-header"]
    backend, log = start("backend", backend_cmd, BACKEND)
    wait_http("http://127.0.0.1:8000/health", "El backend", backend, log)
    say("  - backend del evento: listo (8000)")
    rc, log = start(
        "registro civil", [uv, "run", "uvicorn", "registro_civil.app:app", "--port", "8001", "--no-server-header"], BACKEND
    )
    wait_http("http://127.0.0.1:8001/health", "El Registro Civil simulado", rc, log)
    say("  - Registro Civil simulado: listo (8001)")
    web, log = start("frontend", [npx, "vite", "preview", "--port", "4173", "--strictPort"], FRONTEND)
    wait_http("http://localhost:4173/", "El frontend", web, log)
    say("  - frontend (version de produccion): listo (4173)")

    public_url = None
    if use_tunnel:
        say("4. Abriendo el tunel de Cloudflare")
        tunnel, log = start("tunel", [cloudflared, "tunnel", "--no-autoupdate", "--url", "http://localhost:4173"], FRONTEND)
        deadline = time.time() + 60
        while time.time() < deadline and public_url is None:
            if tunnel.poll() is not None:
                fail(f"el tunel se detuvo. Ultimas lineas de {log}:\n{tail(log)}")
            match = TUNNEL_URL.search(log.read_text(encoding="utf-8", errors="replace"))
            public_url = match.group(0) if match else None
            time.sleep(1)
        if public_url is None:
            fail(f"el tunel no entrego una URL. Ultimas lineas de {log}:\n{tail(log)}")
        wait_http(f"{public_url}/api/health", "El tunel", tunnel, log, seconds=90)

    say("\n" + "=" * 64)
    say("  DEMO LISTA")
    say("=" * 64)
    if public_url:
        say(f"  PC y celular (cualquier red):  {public_url}")
    say("  Solo en este PC:               http://localhost:4173")
    say("")
    say("  Guardia:  guardia@demo.cl  /  guardia-demo-2026")
    say("  Admin:    admin@demo.cl    /  admin-demo-2026")
    say("  Cedulas (en /mi-cedula, RUN + clave de activacion):")
    say("    11.111.111-1 + RCUNO234   22.222.222-2 + RCDOS234   12.345.678-5 + RCTRES23")
    say("")
    if public_url:
        say("  Mientras el tunel este abierto la app es publica: cierrala al terminar.")
    say("  Registros de cada servicio: .demo-logs/")
    say("")
    say("  Comandos (escribe la letra y Enter):")
    say("    c  simular caida de la red: detiene el backend (el escaner pasa a modo sin conexion)")
    say("    v  volver: levanta el backend otra vez (el escaner sincroniza lo pendiente)")
    say("    Ctrl+C  detener todo")
    say("=" * 64 + "\n")

    if args.verificar:
        check_login(public_url or "http://localhost:4173")
        say("Verificacion correcta: todo responde. Deteniendo la demo...")
        stop_all()
        return

    # Lee los comandos en un hilo aparte para que Ctrl+C siga funcionando en el hilo principal.
    commands: queue.Queue[str] = queue.Queue()

    def read_commands() -> None:
        for line in sys.stdin:
            commands.put(line.strip().lower())

    threading.Thread(target=read_commands, daemon=True).start()
    backend_down = False  # detenido a proposito con "c"
    backend_warned = False
    try:
        while True:
            try:
                command = commands.get(timeout=1)
            except queue.Empty:
                command = None
            if command == "c" and not backend_down:
                kill_tree(backend)
                backend_down = True
                say("Backend detenido: el escaner ahora opera sin conexion. Escribe 'v' para volver.")
            elif command == "v" and (backend_down or backend.poll() is not None):
                processes.remove(backend)
                backend, log = start("backend", backend_cmd, BACKEND)
                wait_http("http://127.0.0.1:8000/health", "El backend", backend, log)
                backend_down, backend_warned = False, False
                say("Backend de vuelta: el escaner sincroniza lo pendiente en unos 15 s.")
            elif command:
                say("Comandos: c (caida), v (volver), Ctrl+C (detener).")

            for proc in processes:
                if proc.poll() is None or proc is backend and backend_down:
                    continue
                if proc is backend:
                    if not backend_warned:
                        say("Aviso: el backend se detuvo solo. Escribe 'v' para levantarlo. Registro: .demo-logs/backend.log")
                        backend_warned = True
                    continue
                fail("un servicio se detuvo. Revisa los registros en .demo-logs/")
    except KeyboardInterrupt:
        say("\nDeteniendo la demo...")
        stop_all()
        say("Listo.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        stop_all()
