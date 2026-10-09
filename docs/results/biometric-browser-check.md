# Comparador biométrico: navegador contra Python (ADR-16)

**Medido el 2026-10-09** en Chrome 155 (Windows 11) con `frontend/dev-check/biometria.html`, sobre
insumos de `backend/scripts/biometric_browser_check.py`. Cierra el hueco que dejaba
`biometrics.integration.test.ts`: ese test reemplaza el canvas por pixeles fijos, así que nunca
contrastaba el recorte ni el reescalado del navegador (auditoría del 2026-10-09).

## Qué se midió

200 pares de LFW (100 genuinos y 100 impostores, muestra equilibrada repartida por los 10 folds),
modelo `w600k_mbf.onnx`. Para cada par:

- **Referencia:** la foto del QR, con el mismo compresor del emisor (WebP 112×112 en 900 B),
  decodificada por el navegador.
- **Sonda:** el recorte del rostro (128 px) y versiones ampliadas con Lanczos a 512 y 1080 px, que
  simulan un fotograma de cámara encuadrado en el rostro. En el navegador las reduce a 112 px
  `drawImage` del canvas, como hace el escáner con la cámara.
- **Puntaje:** el navegador usa `faceVector` y `similarity` de `frontend/src/biometrics.ts` tal como
  están. Python usa el pipeline del experimento, que fijó el umbral (bicúbico de PIL, sonda de
  128 px).

## Resultado

Diferencia de puntaje navegador − Python (similitud coseno), por tamaño de la sonda:

| Sonda | Contra Python, misma imagen: media / media abs. / máx. abs. | Contra Python calibrado (128 px): media / media abs. / máx. abs. | Decisiones distintas al umbral |
|---|---|---|---|
| 128 px | +0,00016 / 0,0020 / 0,0096 | +0,00016 / 0,0020 / 0,0096 | 0 de 200 |
| 512 px | −0,00008 / 0,0017 / 0,0094 | +0,00001 / 0,0016 / 0,0083 | 0 de 200 |
| 1080 px | −0,00014 / 0,0016 / 0,0153 | −0,00002 / 0,0015 / 0,0109 | 0 de 200 |

- **Sin sesgo:** la diferencia media es del orden de 10⁻⁴, así que el navegador no corre los
  puntajes hacia aceptar ni hacia rechazar. El reescalado del canvas al reducir 1080 → 112 no
  introduce un desvío sistemático.
- **Ruido chico frente a la separación:** la diferencia típica es 0,002 y la máxima 0,015, contra
  similitudes medias de 0,505 (genuinos) y 0,013 (impostores) en el experimento.
- **Decisiones:** con el umbral vigente al medir (0,245486) ninguna de las 600 comparaciones cambió
  de lado. Solo 2 pares quedaban a menos de 0,015 del umbral, y 9 a menos de 0,05. Las
  estadísticas de diferencia no dependen del umbral, así que la conclusión vale también para el
  umbral que salga de la nueva medición.

## Límites

1. Las sondas grandes son ampliaciones de un recorte de 128 px: tienen menos detalle fino que un
   fotograma real de 1080 px, así que el aliasing se pone a prueba menos que con una cámara.
2. No es un fotograma en vivo: no mide desenfoque, contraluz ni ángulo, ni el encuadre real que
   logra el guardia. Eso sigue pendiente en terreno.
3. Un solo navegador y una sola máquina (Chrome 155, Windows 11). Safari o Chrome en Android pueden
   remuestrear distinto.
4. 200 pares: alcanza para medir la diferencia de puntaje (es pareada), no para recalcular TAR/FAR.

## Cómo repetirlo

```bash
cd backend
uv run --group biometria python scripts/biometric_browser_check.py \
    --rostros biometric-data/lfw_funneled --pares biometric-data/pairs.txt \
    --modelo ../frontend/public/models/w600k_mbf.onnx --pares-muestra 200
cd ../frontend
VITE_BIOMETRIA=1 npx vite
# abrir /dev-check/biometria.html y esperar "Listo."
```
