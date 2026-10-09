# Costo biometrico de meter la foto en el QR (ADR-16)

**Generado por** `backend/scripts/biometric_degradation.py`. No editar a mano.

Modelo: `w600k_mbf.onnx` (512 dimensiones). Pares medidos: 6000.

## Linea base: opcion (B), plantilla firmada por el emisor

El emisor calcula el vector desde el retrato original sin degradar, asi que esta fila es el
techo alcanzable y el valor de referencia contra el que se mide todo lo demas.

- TAR a FAR 1e-3: **94.3 %** (FAR real 1.0e-03)
- TAR a FAR 1e-3 con el umbral elegido fuera de cada fold: 93.8 % (FAR 1.0e-03)
- EER: 2.4 % (umbral 0.145)
- AUC: 0.9959
- Similitud media: genuinos 0.505, impostores 0.013

## Opcion (A): comparar contra la foto del QR

Calidad y bytes son la mediana por foto; los caracteres de QR, los de la foto mas grande (el QR
tiene que caber en el peor caso). La columna validada elige el umbral en 9 folds de LFW y lo
mide en el decimo, y muestra el FAR que resulto en caras no vistas.

| Configuracion | Calidad WebP | Bytes de foto (mediana / max) | Caracteres de QR (max) | Fotos que caben | TAR @ FAR 1e-3 | TAR @ FAR 1e-3 validado | EER | AUC |
|---|---|---|---|---|---|---|---|---|
| 72x96@600B | 35 | 584 / 600 | 1342 | 100 % | 84.2 % | 83.7 % (FAR 1.0e-03) | 4.0 % | 0.9923 |
| 72x96@900B | 70 | 822 / 900 | 1792 | 100 % | 86.8 % | 86.1 % (FAR 1.0e-03) | 3.7 % | 0.9929 |
| 72x96@1500B | 70 | 822 / 1488 | 2674 | 100 % | 87.2 % | 86.5 % (FAR 1.0e-03) | 3.6 % | 0.9927 |
| 72x96@2500B | 70 | 822 / 2004 | 3448 | 100 % | 87.2 % | 86.5 % (FAR 1.0e-03) | 3.6 % | 0.9927 |
| 96x128@600B | 15 | 576 / 600 | 1342 | 98 % | 84.3 % | 84.4 % (FAR 1.0e-03) | 4.0 % | 0.9909 |
| 96x128@900B | 50 | 876 / 900 | 1792 | 100 % | 87.5 % | 87.5 % (FAR 1.0e-03) | 3.8 % | 0.9925 |
| 96x128@1500B | 70 | 1090 / 1500 | 2692 | 100 % | 87.2 % | 86.3 % (FAR 1.0e-03) | 3.5 % | 0.9931 |
| 96x128@2500B | 70 | 1090 / 2414 | 4063 | 100 % | 87.2 % | 86.3 % (FAR 1.0e-03) | 3.5 % | 0.9932 |
| 112x112@600B ⚠ | 10 | 574 / 600 | 1342 | 95 % ⚠ | 89.8 % | 89.8 % (FAR 1.1e-03) | 3.2 % | 0.9945 |
| 112x112@900B **(produccion actual)** | 40 | 874 / 900 | 1792 | 100 % | 92.0 % | 91.8 % (FAR 1.3e-03) | 2.6 % | 0.9955 |
| 112x112@1500B | 70 | 1214 / 1500 | 2692 | 100 % | 93.3 % | 92.8 % (FAR 1.0e-03) | 2.5 % | 0.9954 |
| 112x112@2500B | 70 | 1214 / 2476 | 4156 | 100 % | 93.3 % | 92.8 % (FAR 1.0e-03) | 2.5 % | 0.9955 |
| 128x160@600B ⚠ | 5 | 572 / 600 | 1342 | 46 % ⚠ | 82.0 % | 82.8 % (FAR 1.4e-03) | 4.3 % | 0.9911 |
| 128x160@900B | 25 | 870 / 900 | 1792 | 100 % | 86.9 % | 87.7 % (FAR 1.0e-03) | 3.3 % | 0.9936 |
| 128x160@1500B | 70 | 1432 / 1500 | 2692 | 100 % | 90.6 % | 89.7 % (FAR 1.0e-03) | 3.2 % | 0.9943 |
| 128x160@2500B | 70 | 1472 / 2490 | 4177 | 100 % | 90.5 % | 89.3 % (FAR 1.0e-03) | 3.2 % | 0.9942 |
| 160x160@600B ⚠ | 5 | 576 / 600 | 1342 | 8 % ⚠ | — | — | 3.4 % | 0.9939 |
| 160x160@900B ⚠ | 10 | 858 / 900 | 1792 | 94 % ⚠ | 90.5 % | 90.9 % (FAR 1.1e-03) | 2.8 % | 0.9955 |
| 160x160@1500B | 50 | 1460 / 1500 | 2692 | 100 % | 93.6 % | 91.8 % (FAR 1.0e-03) | 2.4 % | 0.9957 |
| 160x160@2500B | 70 | 1800 / 2500 | 4192 | 100 % | 93.9 % | 93.8 % (FAR 1.3e-03) | 2.4 % | 0.9960 |

FAR minimo resoluble con la muestra completa: 3.3e-04 (3000 pares impostores). Un TAR en blanco significa que esa fila tiene muy pocos impostores para resolver ese FAR.

> **⚠ Filas no comparables.** El compresor del emisor no logra meter toda foto en todo
> presupuesto: cuando no cabe, ese par se descarta **solo para esa configuracion**, asi que
> la fila queda medida sobre un subconjunto distinto y sesgado (justamente las fotos que
> mas se comprimen). Su TAR, EER y AUC **no** se pueden comparar con el resto ni con la
> linea base. Mas importante: una configuracion que no admite la mayoria de las fotos no es
> una opcion de produccion, aunque su AUC se vea bien. Afectadas:

> - `112x112@600B`: solo 95 % de las fotos caben (5675 de 6000 pares)
> - `128x160@600B`: solo 46 % de las fotos caben (2748 de 6000 pares)
> - `160x160@600B`: solo 8 % de las fotos caben (498 de 6000 pares)
> - `160x160@900B`: solo 94 % de las fotos caben (5628 de 6000 pares)

## Como leer esto

La fila marcada como produccion actual es lo que hoy entrega el emisor. La distancia entre
esa fila y la linea base es el costo de la restriccion de tamano del QR: si es chica, ADR-16
se implementa con la opcion (A) y no se toca el formato de la credencial; si es grande, el
numero justifica la opcion (B), con su costo de ataduras de modelo y cambio de formato.

## Limites

1. Sin alineado por puntos faciales: el TAR absoluto es una cota inferior; lo valido es la comparacion relativa.
2. El FAR minimo resoluble lo fija la cantidad de pares impostores.
3. Las sondas son fotos de archivo, no fotogramas de camara en una fila: el resultado es un techo.
4. El conjunto de rostros no representa la poblacion chilena. LFW lo advierte en su propia pagina: muy pocos ninos, nadie sobre 80 anos, proporcion baja de mujeres y etnias con representacion minima o nula, y no tiene datos suficientes para conclusiones estadisticas por subgrupo.
5. LFW declara que ningun resultado sobre el permite concluir que un algoritmo sirva para un proposito comercial; aqui se usa para comparar configuraciones entre si, no para certificar nada.
6. Declarar en la tesis la variante exacta de LFW y el espejo usado: la fuente oficial (vis-www.cs.umass.edu) esta caida desde ~enero de 2025 y las variantes dan resultados distintos.
7. Declarar la licencia de los pesos del modelo: los de InsightFace son solo para investigacion no comercial; arcfaceresnet100-8 es Apache-2.0 pero se entreno con MS-Celeb-1M, retirado por Microsoft por problemas de consentimiento.
