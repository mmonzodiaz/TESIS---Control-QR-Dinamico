# Despliegue en Railway

**Estado (2026-11-07): preparado, no desplegado.** Se despliega solo si el profesor guía lo aprueba. Hasta
entonces el piloto corre en red local con `uv run demo.py --red-local` (`docs/piloto.md`).

## Qué se despliega

Un proyecto de Railway con dos piezas:

| Pieza | Qué es | Qué guarda |
|---|---|---|
| Servicio **app** | Un contenedor (`Dockerfile`) con Caddy, el backend del recinto y el Registro Civil simulado | En el volumen `/data`: claves y padrón del emisor simulado |
| Base **Postgres** | PostgreSQL administrado por Railway | Personal, eventos, entradas, prohibiciones, usos de QR e historial |

Caddy recibe todo el tráfico en el puerto que asigna Railway (que ya pone HTTPS con un certificado válido),
sirve la app compilada y reenvía `/api` al backend y `/registro-civil` al emisor simulado. El navegador ve un
solo sitio, igual que en la demo.

**Por qué un contenedor y no tres servicios.** El backend lee las claves del emisor desde archivos, igual
que en la demo; con un contenedor y un volumen eso funciona sin cambiar el código. Separarlos exigiría un
mecanismo para entregar la clave de lectores al backend, que en un sistema real hace el Registro Civil y
que el prototipo no simula. El costo es que el emisor simulado corre junto al recinto; con un emisor real
quedaría fuera de este proyecto.

**Por qué PostgreSQL.** Con 2000 personas entrando por 32 filas a la vez, SQLite dejó a 18 sin entrar en el
primer intento (24 errores del servidor) y PostgreSQL a ninguna, con uno y con cuatro procesos. En ninguno
hubo un ingreso doble. Detalle en `docs/results/rush-test.md`. La suite completa del backend pasa contra
PostgreSQL (`TEST_DATABASE_URL`, ver «Antes de desplegar»).

## Pasos (el día que se apruebe)

1. **Proyecto.** En railway.com, *New Project* → *Deploy from GitHub repo* → `TESIS---Control-QR-Dinamico`.
   Elegir la rama que se va a mostrar (hoy `alinea-prototipo-informe`; después de unirla, `main`).
   Railway lee `railway.json` y construye con el `Dockerfile`. El primer intento va a fallar porque faltan las
   variables del paso 4: es normal.
2. **Base de datos.** En el proyecto, *+ New* → *Database* → *PostgreSQL*.
3. **Volumen.** En el servicio de la app: *Settings* → *Volumes* → montar uno en `/data`. Sin volumen, cada
   despliegue genera claves nuevas del emisor y todas las cédulas activadas dejan de servir.
4. **Variables** del servicio de la app (*Variables*):

   | Variable | Valor |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (referencia a la base del paso 2) |
   | `JWT_SECRET` | Una nueva: `python -c "import secrets; print(secrets.token_urlsafe(48))"` |
   | `DEMO_ADMIN_PASSWORD` | Contraseña del administrador demo, de 12 caracteres o más |
   | `DEMO_GUARD_PASSWORD` | Contraseña de los dos guardias demo, de 12 caracteres o más |
   | `ACCESO_CLAVE` | Contraseña para entrar al sitio (se le da a quien participe) |
   | `ACCESO_USUARIO` | Opcional; por defecto, `piloto` |

   Las contraseñas demo solo se fijan al crear las cuentas: después se cambian en «Personal».
5. **Dominio.** *Settings* → *Networking* → *Generate Domain*. Queda algo como
   `https://<nombre>.up.railway.app`.
6. **Comprobar** desde un teléfono con datos móviles:
   - el sitio pide usuario y contraseña (`ACCESO_USUARIO` y `ACCESO_CLAVE`);
   - `/mi-cedula` activa a «Asistente Uno» (RUN `11.111.111-1`, clave `RCUNO234`) y muestra el QR después del PIN;
   - en otro teléfono, `/login` con `guardia@demo.cl` y la contraseña de `DEMO_GUARD_PASSWORD` abre el escáner y la cámara;
   - el QR se lee y el ingreso queda en «Historial»;
   - en los registros del servicio (*Deployments* → *View logs*) no hay errores.

   Para revisar que los límites de intentos ven la IP de cada visitante y no la de Railway: equivocar la clave
   de activación 11 veces desde un teléfono y comprobar que otro teléfono todavía puede activar.

Si algo falla al construir o al arrancar, el registro lo dice; `deploy/start.sh` explica qué variable falta.

## Por qué el sitio lleva contraseña

Las claves de activación de las personas demo están en el repositorio, que es público. Sin una barrera,
cualquiera que encuentre la dirección podría activar a «Asistente Uno» en su teléfono, y eso revoca la cédula
del teléfono del piloto (una cédula por persona, ADR-14). `ACCESO_CLAVE` pone una contraseña a todo el sitio,
salvo `/api/health`, que Railway usa para saber si el servicio está vivo. Dejarlo abierto exige
`ACCESO_ABIERTO=1`, a propósito.

Tampoco se suben datos reales: las tres personas son ficticias y sus retratos, sintéticos.

## Antes de desplegar

Lo que se puede comprobar sin Railway:

```bash
cd backend
uv run python -m pytest -q                                   # suite con SQLite
TEST_DATABASE_URL=postgresql://.../tests uv run python -m pytest -q   # la misma suite con PostgreSQL
uv run python scripts/rush_test.py --database-url postgresql://.../carga --workers 4
cd ../e2e && E2E_DATABASE_URL=postgresql://.../e2e npm run simulacro
```

**No comprobado todavía:** la imagen de Docker no se ha construido (el PC del autor no tiene Docker) y la
configuración de Caddy no se ha validado con Caddy. Las dos cosas se prueban en el primer despliegue; si
fallan, el registro de construcción o de arranque lo muestra.

## Pendiente para un sistema en producción

El despliegue sirve para demostrar el prototipo, no para operar un evento real. Faltaría, como dice el
capítulo de desarrollo de la tesis:

- **Límites de intentos compartidos.** Viven en la memoria de cada proceso, por eso el backend corre con uno
  solo. Con varios, cada proceso contaría por su cuenta.
- **Almacén seguro para las claves** del emisor (hoy, archivos en un volumen).
- **Registro de seguridad centralizado** y plazo de conservación de los datos personales del historial.
- **Segundo factor** para el personal.
- **Un emisor real** en vez del simulado, que depende de que el Registro Civil publique su interfaz.
- **Respaldos de la base.** Railway permite programarlos; no están configurados.

## Bajarlo

*Settings* del proyecto → *Delete Project*. Borra el servicio, la base y el volumen, con todo lo que
guardaban.
