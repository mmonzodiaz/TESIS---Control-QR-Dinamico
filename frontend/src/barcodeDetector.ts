// Lector de QR robusto para el escaner del guardia.
//
// html5-qrcode usa el lector nativo del navegador (BarcodeDetector) si existe; si no, cae a zxing-js,
// que NO logra leer los QR densos que llevan la foto (~1,7 KB, cerca de version 25). BarcodeDetector existe
// en Chrome de Android y macOS, pero no en Chrome de Windows ni en Firefox. Este polyfill usa
// ZXing-C++ compilado a WebAssembly. El .wasm se sirve desde este mismo sitio (sin CDN), porque el
// escaner debe poder leer QR sin conexion.
import { BarcodeDetector as BarcodeDetectorPolyfill, prepareZXingModule } from "barcode-detector/ponyfill";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

let installed = false;

export function installBarcodeDetector() {
  if (installed || "BarcodeDetector" in globalThis) return;
  prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) },
  });
  (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = BarcodeDetectorPolyfill;
  installed = true;
}
