// Contraste del comparador del navegador (src/biometrics.ts) contra Python con fotos reales de LFW.
// Solo para desarrollo: no entra en la compilacion (Vite solo construye index.html). Los insumos los
// genera backend/scripts/biometric_browser_check.py en dev-check/data/ (ignorado por git).
// Correr con:  VITE_BIOMETRIA=1 npx vite  y abrir /dev-check/biometria.html
import { THRESHOLD, faceVector, similarity } from "../src/biometrics";

interface Entry {
  id: number;
  same: boolean;
  ref: string;
  probes: Record<string, string>;
  python: Record<string, number>;
}

interface Manifest {
  probe_sizes: number[];
  calibrated_probe_size: number;
  entries: Entry[];
}

const estado = document.getElementById("estado")!;
const salida = document.getElementById("resultado")!;

async function vectorOf(url: string): Promise<Float32Array> {
  const bitmap = await createImageBitmap(await (await fetch(url)).blob());
  try {
    return await faceVector(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

function stats(values: number[]) {
  const abs = values.map(Math.abs);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return {
    media: +mean.toFixed(5),
    media_abs: +(abs.reduce((a, b) => a + b, 0) / abs.length).toFixed(5),
    max_abs: +Math.max(...abs).toFixed(5),
  };
}

async function main() {
  const manifest: Manifest = await (await fetch("./data/manifest.json")).json();
  const calibrated = String(manifest.calibrated_probe_size);
  const rows: { id: number; same: boolean; browser: Record<string, number>; python: Record<string, number> }[] = [];
  for (const [i, entry] of manifest.entries.entries()) {
    estado.textContent = `Par ${i + 1} de ${manifest.entries.length}…`;
    const ref = await vectorOf(`./data/${entry.ref}`);
    const browser: Record<string, number> = {};
    for (const size of manifest.probe_sizes) {
      browser[size] = similarity(ref, await vectorOf(`./data/${entry.probes[size]}`));
    }
    rows.push({ id: entry.id, same: entry.same, browser, python: entry.python });
  }

  const porTamano: Record<string, unknown> = {};
  for (const size of manifest.probe_sizes.map(String)) {
    // Contra Python en la misma imagen (mide el remuestreo y la decodificacion) y contra el camino
    // calibrado de Python (sonda de 128 px), que es el que fijo el umbral.
    const vsMismo = rows.map((r) => r.browser[size] - r.python[size]);
    const vsCalibrado = rows.map((r) => r.browser[size] - r.python[calibrated]);
    const cambiosDecision = rows.filter((r) => r.browser[size] >= THRESHOLD !== r.python[calibrated] >= THRESHOLD);
    porTamano[size] = {
      vs_python_mismo_tamano: stats(vsMismo),
      vs_python_calibrado: stats(vsCalibrado),
      decisiones_distintas_al_umbral: cambiosDecision.length,
      pares_que_cambian: cambiosDecision.map((r) => ({
        id: r.id,
        genuino: r.same,
        navegador: +r.browser[size].toFixed(4),
        python_calibrado: +r.python[calibrated].toFixed(4),
      })),
    };
  }
  const resumen = {
    navegador: navigator.userAgent,
    umbral: THRESHOLD,
    pares: rows.length,
    genuinos: rows.filter((r) => r.same).length,
    por_tamano_de_sonda: porTamano,
  };
  (window as unknown as { __contraste: unknown }).__contraste = { resumen, rows };
  estado.textContent = "Listo.";
  salida.textContent = JSON.stringify(resumen, null, 2);
}

main().catch((err) => {
  estado.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
  (window as unknown as { __contraste: unknown }).__contraste = { error: String(err) };
});
