# Justificación del intervalo de regeneración del QR dinámico

> `QR_TTL_SECONDS = 45` (`backend/app/config.py`). Este documento deriva ese número; no es una
> cifra elegida por conveniencia de demo (de hecho, el valor original de esta implementación
> mientras era solo un prototipo funcional era 60s, fijado sin análisis — este documento lo
> corrige).

## 1. Por qué el valor no puede ser arbitrario

Un TTL demasiado largo amplía la ventana en la que un QR fotografiado o capturado en pantalla
(actor A1 de `threat-model.md`) sigue siendo válido y reutilizable. Un TTL demasiado corto empeora
la usabilidad para las personas con más fricción de activación — precisamente el problema central
que esta misma tesis documenta empíricamente en la encuesta (n=338): la opción "el proceso de
activación es muy complicado" es una de las razones declaradas de abandono en el Bloque 5 del
instrumento, y los dos arquetipos con menor familiaridad digital (*Mayoría desinformada activa*,
47%, y *Joven desconectado*, 17%) suman el 64% de la muestra. El valor correcto es el punto donde
ambas cotas —usabilidad y exposición a *replay*— se cruzan, no un extremo de ninguna de las dos.

## 2. Cota inferior: piso de usabilidad

Tiempo que necesita completarse un escaneo **legítimo** de extremo a extremo:

1. Tiempo de reacción para levantar el teléfono y mostrar la pantalla al verificador: ~2–3 s.
2. Tiempo de enfoque y lectura de la cámara del verificador bajo condiciones reales (no de
   laboratorio: variación de luz, ángulo, calidad de la cámara del dispositivo de portería):
   típicamente 1–3 s en condiciones favorables, hasta 5–8 s en condiciones adversas.
3. Latencia de red del *round-trip* `POST /qr/validate`: <1 s en redes móviles LTE/Wi-Fi
   normales, pero se debe dejar margen para redes degradadas.

Estimación conservadora del caso legítimo: **5–10 s**. A esto se suma un margen cognitivo para los
arquetipos con menor familiaridad digital — quien nunca ha usado la app dudará, buscará el botón,
volverá a mirar la pantalla — que la literatura de usabilidad general sitúa en un factor de 2–4×
sobre el tiempo de un usuario experto para tareas de interfaz nuevas. Con ese margen, el piso de
usabilidad ajustado por los arquetipos reales de esta muestra se ubica entre **~15 y ~30 s**.

## 3. Cota superior: techo de exposición a *replay*

No existe un estándar internacional único, auditado y específico para "QR dinámico anti-replay"
en control de acceso físico (se buscó explícitamente; ver §4). El ancla formal más cercana es
**RFC 6238 (TOTP — Time-Based One-Time Password Algorithm)**, que define un *time step* por
defecto de **30 segundos** para códigos de un solo uso basados en tiempo, elegido específicamente
para balancear la deriva de reloj entre cliente y servidor contra la ventana de vulnerabilidad de
cada código. Es el precedente más citado en la industria para "cuánto debe vivir un código que
rota", aunque fue diseñado para códigos numéricos de 6 dígitos, no para payloads QR — se usa aquí
como analogía de diseño, no como aplicabilidad literal.

Como evidencia adicional de práctica real (no de estándar formal), varios esquemas de pago por QR
dinámico en producción rotan sus códigos en ventanas del mismo orden de magnitud (decenas de
segundos), lo que sugiere que 30–60 s es un rango aceptado de facto en la industria para este tipo
de mecanismo, sin que exista un análisis público que derive ese número desde primeros principios
más allá del propio RFC 6238.

## 4. Sobre el QR de la app chilena "Identificación Digital"

Se buscó explícitamente el intervalo de regeneración real de la app oficial (fuentes: cobertura de
prensa especializada, listados de tiendas de aplicaciones, comunicados del Registro Civil,
literatura académica y de la Biblioteca del Congreso Nacional). **No existe un parámetro numérico
público.** La única caracterización disponible es cualitativa: el QR "varía constantemente su
estructura matemática para impedir capturas de pantalla o réplicas" (fuente secundaria de prensa,
sin respaldo técnico oficial ni cifra asociada), consistente con lo que la propia introducción de
esta tesis declara (`intro.tex`): las claves de verificación del sistema no son públicas y este
trabajo no intenta interoperar con ellas. Este hallazgo negativo —confirmar que el dato no es
público— es en sí mismo parte del resultado metodológico: el prototipo replica el **propósito**
declarado (impedir reutilización por captura) usando el ancla formal disponible (RFC 6238), no un
valor extraído de la app real, porque ese valor no existe públicamente.

## 5. Decisión

**TTL = 45 s**, punto intermedio entre el piso de usabilidad ajustado por arquetipos (~15–30 s) y
el techo de exposición de referencia de la industria/RFC 6238 (~30–60 s). Es una decisión de
compromiso explícita y revisable, no un óptimo matemático único:

- Si se prioriza más la seguridad (minimizar ventana de *replay*), el valor defendible más bajo es
  ~30 s, alineado directamente con RFC 6238.
- Si se prioriza más la accesibilidad para los arquetipos con mayor fricción de activación
  (*Mayoría desinformada activa* + *Joven desconectado*, 64% de la muestra), un valor de 60–90 s
  sería más permisivo, a costa de una ventana de exposición mayor.
- 45 s se elige como punto medio defendible que no sacrifica ninguna de las dos cotas de forma
  extrema.

## 6. Lo que acota la exposición real (actualizado con ADR-11)

*Antes*, generar un QR nuevo invalidaba el anterior en el servidor (ADR-2), lo que bajaba la
exposición real por debajo del TTL nominal. Con ADR-11 el QR lo genera el teléfono sin conexión y
el servidor ya no puede revocar el anterior: dentro de la ventana pueden coexistir varios QR
vigentes de la misma entrada. Lo que acota el efecto ahora:

- **Admisión única por entrada (ADR-8):** solo uno de esos QR puede servir, y tras el ingreso
  ninguno sirve.
- **Foto firmada en el QR (ADR-10):** si un tercero usa una copia dentro de la ventana, el guardia
  ve la foto del titular.
- **La hora la firma el dispositivo y la verifica el servidor** con una tolerancia de 5 s
  (`QR_CLOCK_SKEW_SECONDS`); la exposición máxima de una copia es TTL + tolerancia = 50 s.
