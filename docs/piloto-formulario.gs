/**
 * Crea en Google Forms el cuestionario del piloto (docs/piloto-cuestionario.md), con los títulos exactos que
 * reconoce informe/analisis/piloto.py. Así no hay que copiarlos a mano.
 *
 * Uso: abrir https://script.google.com con la cuenta que va a recibir las respuestas, crear un proyecto nuevo,
 * pegar este archivo completo, elegir la función crearFormularioPiloto y tocar «Ejecutar». La primera vez pide
 * permiso para crear formularios. Al terminar, el registro muestra el enlace para editar y el enlace para
 * responder.
 *
 * Después, a mano en el editor de Forms (la API no lo permite):
 *   - Pregunta «De lo que viste…»: menú de los tres puntos → «Orden aleatorio de las opciones».
 *   - Configuración → Respuestas: confirmar que «Recopilar correos electrónicos» está en «No recopilar».
 */

function crearFormularioPiloto() {
  var form = FormApp.create('Piloto: cédula digital en el acceso a eventos');
  form.setDescription(
    'Este formulario forma parte de un estudio de la Universidad de Chile sobre la cédula de identidad digital. ' +
    'Verás la demostración de un prototipo de tesis: no es la app oficial del Registro Civil y hoy no se usa en ' +
    'eventos. Tus respuestas son anónimas y se usarán solo para fines académicos. Participar es voluntario, puedes ' +
    'dejar de responder cuando quieras y debes tener 18 años o más. Responde según lo que realmente piensas: no ' +
    'hay respuestas correctas.'
  );
  form.setCollectEmail(false);
  form.setLimitOneResponsePerUser(false); // exigiría iniciar sesión con Google
  form.setAllowResponseEdits(false);
  form.setShowLinkToRespondAgain(false);
  form.setProgressBar(true);
  form.setConfirmationMessage('Gracias por participar.');

  var ESCALA_INTENCION = ['nada probable', 'muy probable'];
  var ESCALA_SEGURIDAD = ['mucho menos seguro', 'mucho más seguro'];

  function unaOpcion(titulo, opciones, ayuda) {
    var item = form.addMultipleChoiceItem().setTitle(titulo).setChoiceValues(opciones).setRequired(true);
    if (ayuda) item.setHelpText(ayuda);
    return item;
  }

  function escala(titulo, extremos, ayuda, obligatoria) {
    return form.addScaleItem()
      .setTitle(titulo)
      .setBounds(1, 5)
      .setLabels(extremos[0], extremos[1])
      .setHelpText(ayuda)
      .setRequired(obligatoria);
  }

  // Parte 1: antes de la demostración
  unaOpcion('¿En qué rango de edad te encuentras?',
    ['18-24 años', '25-34 años', '35-44 años', '45-59 años', '60 años o más']);
  unaOpcion('¿Cuál es tu nivel educacional más alto alcanzado o completado?',
    ['Educación media', 'Técnico o universitario incompleto', 'Técnico o universitario completo',
     'Postgrado (magíster/doctorado)', 'Prefiero no responder']);
  unaOpcion('¿Con qué frecuencia realizas trámites digitales (bancos, servicios del Estado, etc.)?',
    ['Rara vez o nunca', 'Una vez a la semana o menos', 'Más de una vez a la semana', 'Todos los días']);
  unaOpcion('¿Habías escuchado sobre la app del Registro Civil que permite usar tu cédula de identidad desde el celular?',
    ['No, es la primera vez que lo escucho', 'La había escuchado, pero no sé bien cómo funciona',
     'Sí, la conozco bien y sé cómo funciona']);
  unaOpcion('¿Tienes la nueva cédula física emitida desde diciembre de 2024?',
    ['Sí, ya la tengo', 'No, aún tengo la cédula anterior', 'No lo sé']);
  unaOpcion('¿Has descargado o utilizado activamente la app de Identificación Digital?',
    ['No aplica (no tengo la nueva cédula)', 'No la he descargado', 'La descargué, pero no pude activarla',
     'La descargué, pero no la uso', 'Sí, la uso activamente']);
  escala('Antes de la demostración: ¿qué tan probable es que hagas lo que te falta para tener la cédula digital ' +
    '(renovar tu cédula, descargar la app o activarla) en los próximos 6 meses?',
    ESCALA_INTENCION, 'Si ya la usas, marca 5.', true);
  escala('Antes de la demostración: ¿qué tan seguro consideras que es el carnet digital en comparación con el ' +
    'documento físico?',
    ESCALA_SEGURIDAD, 'Opcional: déjala en blanco si no lo sabes.', false);
  form.addSectionHeaderItem()
    .setTitle('Ahora pide la demostración')
    .setHelpText('Continúa cuando termine.');

  // Parte 2: después de la demostración. La sección separada evita que se vea antes de tiempo.
  form.addPageBreakItem().setTitle('Después de la demostración');
  escala('Después de la demostración: ¿qué tan probable es que hagas lo que te falta para tener la cédula digital ' +
    '(renovar tu cédula, descargar la app o activarla) en los próximos 6 meses?',
    ESCALA_INTENCION, 'Si ya la usas, marca 5.', true);
  escala('Después de la demostración: ¿qué tan seguro consideras que es el carnet digital en comparación con el ' +
    'documento físico?',
    ESCALA_SEGURIDAD, 'Opcional: déjala en blanco si no lo sabes.', false);
  unaOpcion('Si este tipo de sistema se usara en los eventos a los que vas, ¿qué harías con el trámite para tener ' +
    'la cédula digital?',
    ['Haría el trámite antes de lo que tenía pensado', 'Haría el trámite, aunque antes no pensaba hacerlo',
     'No cambia: lo iba a hacer igual, sin apuro', 'No cambia: no lo haría de todos modos',
     'Ya tengo la cédula digital activa', 'No lo sé']);
  unaOpcion('De lo que viste, ¿qué te motivaría más a tener la cédula digital?',
    ['Que una foto o copia de mi QR no le sirva a otra persona', 'Que el guardia vea una foto verificada de mí',
     'Tener una fila propia para quienes la usan', 'No tener que andar con el carnet físico en eventos',
     'Que sea más difícil entrar con la identidad de otra persona', 'Nada de esto me motivaría']);
  form.addCheckboxItem()
    .setTitle('¿Qué te preocuparía de usarla para entrar a un evento?')
    .setChoiceValues(['Quedarme sin batería o sin el teléfono', 'Que la app falle en la puerta',
      'Mi privacidad o qué datos quedan guardados', 'Que no la acepten en todos lados',
      'Que el trámite para obtenerla sea complicado', 'Que el guardia se equivoque al comparar la foto',
      'Nada de esto'])
    .setRequired(true);
  unaOpcion('¿Cómo participaste en la demostración?',
    ['Solo la vi', 'La probé mostrando el QR', 'La probé escaneando']);
  form.addParagraphTextItem()
    .setTitle('¿Quieres agregar algo sobre lo que te haría, o no, hacer el trámite?')
    .setHelpText('Por favor no escribas nombres, RUT ni otros datos personales.')
    .setRequired(false);

  Logger.log('Editar: ' + form.getEditUrl());
  Logger.log('Responder: ' + form.getPublishedUrl());
}
