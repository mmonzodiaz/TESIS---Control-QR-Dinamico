# Simulacro del piloto y auditoría de accesibilidad

Dos pruebas de punta a punta en un navegador real (Chromium), con la versión de producción del cliente, por
la IP local y con HTTPS, como la usarían los teléfonos del piloto. Cada una prepara sus propios datos en
`e2e/salida/` (nunca toca la base ni el padrón de la demo), levanta los servicios y los cierra al terminar.

| Prueba | Qué comprueba | Resultado |
|---|---|---|
| `simulacro.cjs` | El guion de `docs/piloto.md` (§4), tres veces seguidas, y las comprobaciones del §5: foto vencida, QR reenviado, PIN antes de cada QR, sin entrada, teléfono perdido, lectura por cámara, caída de red y doble ingreso sin red | `docs/results/simulacro.json` (con PostgreSQL, `simulacro-postgresql.json`) |
| `auditoria.cjs` | Cada pantalla con axe-core (WCAG 2.0, 2.1 y 2.2, niveles A y AA, más buenas prácticas), objetivos táctiles menores de 24 px y título del documento | `docs/results/accesibilidad.json` |

## Cómo correrlas

Requisitos: lo mismo que la demo (`uv` y Node), con los puertos 8000, 8001 y 4173 libres, y una red local
(las pruebas entran por la IP del PC, no por `localhost`).

```bash
cd e2e
npm install
npm run navegador          # una vez: descarga el Chromium de Playwright
npm run simulacro          # unos 5 minutos
npm run auditoria          # unos 2 minutos
```

Contra PostgreSQL, la base del despliegue (se borran sus tablas al empezar: usar una base solo para esto):

```bash
E2E_DATABASE_URL=postgresql://usuario:clave@host:5432/e2e npm run simulacro
```

`CHROME_PATH` permite usar un Chromium ya instalado en vez del de Playwright.

Ambas terminan con código distinto de cero si algo falla, y dejan en `e2e/salida/` los registros de los
servicios y las capturas de cada QR.

## Prueba de punta (muchas personas a la vez)

Está en `backend/scripts/rush_test.py`, porque no usa navegador: 2000 personas por 32 filas en paralelo, con
el flujo de dos pasos y dos intentos de fraude simultáneos. Ver su encabezado y `docs/results/rush-test.md`.

## Video de demostración

`video.cjs` graba el sistema real funcionando y arma con eso un video de unos dos minutos, pensado para
quien no pueda ver el piloto en vivo. Un navegador hace de teléfono y otro de escáner, con la misma cámara
simulada del simulacro; encima van carátulas y un pie por escena, y la narración. Monta con **ffmpeg**.

```bash
cd e2e
npm run video                 # graba y monta (unos 7 minutos)
npm run video -- --montar     # rearma con otros textos o con otra voz, sin volver a grabar
npm run video -- --guion      # imprime qué decir en cada tramo
npm run video -- --apuntador  # arma el video sin audio con el texto arriba, para leer encima
```

El resultado queda en `video-salida/video-demo.mp4`. Esa carpeta se borra al empezar cada grabación: la
copia estable va en `video-respaldo/`. **Ninguna de las dos se versiona**, así que en otro computador hay
que volver a generar el video.

**Grabarlo con voz propia.** Por omisión narra la voz en español de Windows. Para poner la propia se deja
un archivo de audio por tramo en `voz-propia/` y se vuelve a montar; el detalle está en
[`voz-propia/LEEME.md`](voz-propia/LEEME.md). El apuntador (`--apuntador`) deja además un recorte por
tramo en `video-salida/apuntador/`, con las palabras encendiéndose al ritmo a leer, que es lo cómodo para
grabar de a poco.

**Qué hace falta en otro computador**, además de lo de la demo (uv y Node):

- `npm install` y `npm run navegador` en esta carpeta, para el Chromium de Playwright.
- **ffmpeg** en el `PATH` (`winget install Gyan.FFmpeg`).
- Una **voz en español** instalada en Windows, solo si se quiere la narración sintética
  (Configuración → Hora e idioma → Voz). Con voz propia en `voz-propia/` no hace falta.

El guion comprueba cada escena antes de montar y termina con error si alguna no muestra lo que dice su
carátula. La comparación facial se fuerza apagada durante la grabación, porque es opcional y la
Ley 21.719 exige consentimiento expreso.
