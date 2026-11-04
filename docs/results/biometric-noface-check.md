# Comparador biométrico frente a imágenes sin rostro

Generado por `backend/scripts/biometric_noface_check.py`. No editar a mano.

Umbral 0.245486 (FAR 10⁻³ con rostros de LFW). 37 imágenes sin rostro, sintéticas: colores, ruido, formas e imitación de la cámara falsa de Chromium. Es una comprobación, no una tasa de error: faltan fotogramas reales de una puerta.

| Referencia | Pares sobre el umbral | Mediana | p99 | Máximo | Imagen con más pares sobre el umbral |
|---|---|---|---|---|---|
| 300 fotos de LFW, una por persona | 10 de 11100 (0.09%) | 0.011 | 0.144 | 0.362 | formas-0 (0.3%) |
| 50 avatares de la demo | 317 de 1850 (17.14%) | 0.176 | 0.361 | 0.428 | camara-falsa (98.0%) |

Con fotos de rostros reales, las imágenes sin rostro superan el umbral con una frecuencia del mismo orden que el FAR medido. Con los avatares sintéticos de la demo el puntaje no significa nada: por eso el escáner no afirma que el rostro coincida, y una demostración con ellos no sirve para evaluar el comparador.
