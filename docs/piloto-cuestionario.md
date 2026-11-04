# Cuestionario del piloto (borrador para Google Forms)

Tiempo estimado: 4 minutos más la demostración. Las preguntas 1 a 6 usan la **misma redacción** que la
encuesta de la tesis (Anexo), para poder comparar perfiles. Hay que copiar los títulos tal cual:
`informe/analisis/piloto.py` reconoce cada columna y cada opción por su texto.

## Texto inicial

> Este formulario forma parte de un estudio de la Universidad de Chile sobre la cédula de identidad digital.
> Verás la demostración de un prototipo de tesis: no es la app oficial del Registro Civil y hoy no se usa en
> eventos. Tus respuestas son anónimas y se usarán solo para fines académicos. Participar es voluntario, puedes
> dejar de responder cuando quieras y debes tener 18 años o más. Responde según lo que realmente piensas: no
> hay respuestas correctas.

## Parte 1: antes de la demostración

**1. ¿En qué rango de edad te encuentras?**
18-24 años / 25-34 años / 35-44 años / 45-59 años / 60 años o más

**2. ¿Cuál es tu nivel educacional más alto alcanzado o completado?**
Educación media / Técnico o universitario incompleto / Técnico o universitario completo / Postgrado
(magíster/doctorado) / Prefiero no responder

**3. ¿Con qué frecuencia realizas trámites digitales (bancos, servicios del Estado, etc.)?**
Rara vez o nunca / Una vez a la semana o menos / Más de una vez a la semana / Todos los días

**4. ¿Habías escuchado sobre la app del Registro Civil que permite usar tu cédula de identidad desde el celular?**
No, es la primera vez que lo escucho / La había escuchado, pero no sé bien cómo funciona / Sí, la conozco bien
y sé cómo funciona

**5. ¿Tienes la nueva cédula física emitida desde diciembre de 2024?**
Sí, ya la tengo / No, aún tengo la cédula anterior / No lo sé

**6. ¿Has descargado o utilizado activamente la app de Identificación Digital?**
No aplica (no tengo la nueva cédula) / No la he descargado / La descargué, pero no pude activarla / La
descargué, pero no la uso / Sí, la uso activamente

**7. Antes de la demostración: ¿qué tan probable es que hagas lo que te falta para tener la cédula digital
(renovar tu cédula, descargar la app o activarla) en los próximos 6 meses?**
Escala de 1 (nada probable) a 5 (muy probable). Si ya la usas, marca 5.

**8. Antes de la demostración: ¿qué tan seguro consideras que es el carnet digital en comparación con el
documento físico?**
Escala de 1 (mucho menos seguro) a 5 (mucho más seguro). Opcional: déjala en blanco si no lo sabes.

> *Fin de la sección:* «Ahora pide la demostración. Continúa cuando termine.»

## Parte 2: después de la demostración

**9. Después de la demostración: ¿qué tan probable es que hagas lo que te falta para tener la cédula digital
(renovar tu cédula, descargar la app o activarla) en los próximos 6 meses?**
Escala de 1 (nada probable) a 5 (muy probable). Si ya la usas, marca 5.

**10. Después de la demostración: ¿qué tan seguro consideras que es el carnet digital en comparación con el
documento físico?**
Escala de 1 (mucho menos seguro) a 5 (mucho más seguro). Opcional: déjala en blanco si no lo sabes.

**11. Si este tipo de sistema se usara en los eventos a los que vas, ¿qué harías con el trámite para tener la
cédula digital?**
Una sola opción:
- Haría el trámite antes de lo que tenía pensado
- Haría el trámite, aunque antes no pensaba hacerlo
- No cambia: lo iba a hacer igual, sin apuro
- No cambia: no lo haría de todos modos
- Ya tengo la cédula digital activa
- No lo sé

**12. De lo que viste, ¿qué te motivaría más a tener la cédula digital?**
Una sola opción, con el orden de las opciones al azar:
- Que una foto o copia de mi QR no le sirva a otra persona
- Que el guardia vea una foto verificada de mí
- Tener una fila propia para quienes la usan
- No tener que andar con el carnet físico en eventos
- Que sea más difícil entrar con la identidad de otra persona
- Nada de esto me motivaría

**13. ¿Qué te preocuparía de usarla para entrar a un evento?**
Varias opciones:
- Quedarme sin batería o sin el teléfono
- Que la app falle en la puerta
- Mi privacidad o qué datos quedan guardados
- Que no la acepten en todos lados
- Que el trámite para obtenerla sea complicado
- Que el guardia se equivoque al comparar la foto
- Nada de esto

**14. ¿Cómo participaste en la demostración?**
Solo la vi / La probé mostrando el QR / La probé escaneando

**15. ¿Quieres agregar algo sobre lo que te haría, o no, hacer el trámite?**
Respuesta abierta y opcional. Por favor no escribas nombres, RUT ni otros datos personales.

## Notas para crear el formulario

- Usar dos secciones de Forms, una por parte, para que no se vea la parte 2 antes de la demostración.
- No activar «recopilar correos» ni el inicio de sesión obligatorio: el formulario es anónimo.
- Marcar 8, 10 y 15 como opcionales; las demás, obligatorias.
- En la pregunta 12, activar «Orden aleatorio de las opciones».
- Probarlo con 2 o 3 personas antes de la primera sesión y anotarlo como prueba del instrumento.
