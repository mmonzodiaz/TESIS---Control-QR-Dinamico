# Piloto en terreno: demostración y opiniones (borrador)

Lo realiza el autor, instalándose en un lugar para simular accesos, durante la semana del 2026-11-04 y la
siguiente (fechas tentativas). **No es un despliegue:** todo corre en su PC y en una red local.

## 1. Qué responde

**Pregunta principal:** ¿la existencia de este tipo de sistema incentivaría a quienes no tienen la cédula
digital a apurar o hacer el trámite?

Se conecta con la hipótesis de la tesis, que nombra los incentivos, «como un ingreso más expedito en
eventos masivos», como una implicancia que el estudio transversal no puede poner a prueba (`intro.tex`).
El piloto aporta evidencia exploratoria sobre esa palanca.

**Lo que puede afirmar:** qué declaran, después de ver el sistema, las personas de esa muestra.

**Lo que no puede afirmar:**
- Que el sistema aumente la adopción. La intención declarada no equivale a la conducta (Sheeran, 2002,
  doi:10.1080/14792772143000003).
- Que el resultado valga para la población. El muestreo es por conveniencia y en un solo lugar.
- Que el efecto se deba solo al sistema. No hay grupo de control, y responder después de una demostración
  amable puede inflar las respuestas.

**También se mide, como comprobación técnica:** si el sistema funciona con equipos reales en un lugar real
(§5). No se mide la detección de impostores.

## 2. Diseño

Cada persona responde antes y después de la misma demostración:

1. **Parte 1 del cuestionario:** perfil, tenencia del documento, intención y seguridad percibida.
2. **Demostración de unos 3 minutos** (§4).
3. **Parte 2 del cuestionario:** la misma intención y seguridad percibida, más el efecto declarado, lo que
   motiva y lo que preocupa.

El cuestionario es `docs/piloto-cuestionario.md`, y se aplica en Google Forms como la encuesta de la tesis.

**Grupo objetivo:** quienes no usan activamente la cédula digital. Quienes ya la usan pueden responder, pero
se reportan aparte. La respuesta principal es el porcentaje del grupo objetivo que marca «Haría el trámite
antes de lo que tenía pensado» o «Haría el trámite, aunque antes no pensaba hacerlo».

**Cuántas personas:** intervalo de confianza del 95 % para un porcentaje cercano al 50 %, con el método de
Wilson que ya usa la tesis:

| Personas del grupo objetivo | Margen aproximado |
|---|---|
| 20 | ±20 puntos |
| 30 | ±17 puntos |
| 50 | ±13 puntos |
| 100 | ±10 puntos |

Sugerencia: al menos 30, e idealmente 50. Con menos sigue sirviendo, pero solo de forma descriptiva.

## 3. Cómo reducir el sesgo

- **Distancia:** cada persona responde sola en su teléfono, y el autor se aparta mientras responde.
- **Lenguaje neutro:** no decir «esto te convencería» ni pedir que apoyen el proyecto.
- **Mostrar también los límites:** se necesita teléfono con batería, es un prototipo y sigue existiendo la
  fila normal.
- **Transparencia:** decir desde el inicio que no es la app oficial y que hoy no se usa en eventos.
- **Registro:** anotar lugar, horario, cuántas personas declinaron participar y cualquier problema.

## 4. Guion de la demostración

Con la persona demo «Asistente Uno» en un teléfono y otro teléfono o PC como escáner:

1. **Presentación.** «Soy estudiante de la Universidad de Chile. Esto es un prototipo de tesis: no es la app
   oficial del Registro Civil y hoy no se usa en eventos. Muestra cómo podría verificarse la identidad al
   entrar a un estadio o a un concierto.»
2. **Hoy.** «Hoy se suele leer el QR del carnet, que es siempre el mismo: una foto de ese QR sirve igual.»
3. **Copia del QR.** Presentar una foto del QR tomada hace más de 50 s. Resultado: «Código expirado». Tocar
   «Siguiente».
4. **Otra persona con el QR.** Presentar un QR vigente del titular: el escáner muestra la foto del titular,
   no la de quien lo presenta, y el guardia toca «No coincide». Aclarar que aquí **decide una persona**, y
   que puede equivocarse. Tocar «Siguiente».
5. **Ingreso normal.** Cerrar el QR y volver a abrirlo, porque el anterior ya quedó usado. El escáner muestra la
   foto firmada, y el guardia toca «Dejar pasar». El intento anterior no le quitó la entrada al titular.
6. **Límites.** «Requiere teléfono con batería. Quien no quiera usarla entra por la fila normal.»

**El orden importa:** una vez admitido el titular, cualquier QR suyo responde «Esta entrada ya ingresó», sin
mostrar los botones de decisión. Por eso el ingreso normal va al final.

**La foto del paso 3:** tomarla antes de la sesión, en otro teléfono o impresa. Si se vuelve a activar la cédula,
hay que tomarla de nuevo, porque la foto anterior respondería «Cédula revocada».

Entre demostraciones hay que reabrir la entrada, porque cada una admite un solo ingreso:

```bash
cd backend && uv run python scripts/piloto.py reabrir --evento 1
```

**Datos reales:** nadie entrega foto ni RUT. Quien quiera probarlo usa una persona demo, con retrato
sintético. La comparación facial queda apagada.

## 5. Instalación y comprobación técnica

```bash
# Una vez, con internet, antes de salir
uv run demo.py --red-local --verificar

# En el lugar
uv run demo.py --red-local
```

Muestra la dirección para los teléfonos. En cada uno hay que aceptar la advertencia del certificado, y el
firewall de Windows debe permitir Node en redes privadas. Sin internet solo se pierden las tipografías de
Google. **El sistema no necesita internet; Google Forms sí:** verificar los datos móviles del lugar y llevar
una versión impresa del cuestionario.

Llevar el PC con cargador, un router o punto de acceso propio, dos o más teléfonos de distinta gama, y la
pistola lectora si se va a usar. Antes de salir, cambiar las contraseñas demo en «Usuarios», porque el
repositorio es público, y hacer un **ensayo completo con teléfonos reales**, que todavía no se ha hecho.

Anotar en una hoja, en cada sesión, lo que funcionó y lo que no:

| Comprobación | Esperado |
|---|---|
| QR en cada teléfono, con distinta luz y distancia | Se lee; anotar fallos y repeticiones |
| Tiempo por persona, con cronómetro | Hoy es un supuesto de 8 s |
| Foto del QR vencida | `expired` |
| Teléfono reportado como perdido | `revoked`, en hasta unos 30 s |
| Sin entrada | `no_ticket` |
| Caída de red (`c` y luego `v` en la consola de la demo) | Sigue operando y sincroniza al volver |
| Misma persona por dos filas sin red | Entra por ambas y queda **alerta**: se detecta, no se evita |

Al terminar:

```bash
cd backend && uv run python scripts/piloto.py exportar --evento 1
```

Deja en `backend/piloto-datos/` un CSV sin RUT, nombres ni horas absolutas, fuera de git.

## 6. Ética y datos

- **Datos:** cuestionario anónimo, sin RUT ni datos de contacto. La pregunta abierta avisa que no se escriban
  datos personales. La demostración usa solo personas demo. Con esto, la frase de la tesis de que el
  prototipo no trató datos de personas reales puede mantenerse, pero la encuesta del piloto hay que declararla.
- **Consentimiento informado** al inicio del formulario, igual que en la encuesta de la tesis.
- **Por confirmar con los guías:** si esta encuesta requiere revisión de un comité de ética. Pedir además
  permiso a quien administra el lugar.
- **Mayores de 18 años:** la primera pregunta solo ofrece rangos desde 18, como en la encuesta original.

## 7. Análisis

```bash
cd ../informe/analisis
python -I piloto.py "<ruta al CSV de Google Forms>"
```

Calcula, sin dependencias: el efecto declarado con intervalos de Wilson, el cambio antes y después con la
prueba de rangos con signo de Wilcoxon (Wilcoxon, 1945, doi:10.2307/3001968), motivaciones, preocupaciones y
resultados por tenencia de la cédula. Las respuestas abiertas se leen y se agrupan a mano por tema.

## 8. Por definir

- [ ] Lugar, días y permiso.
- [ ] Revisión ética, según lo que digan los guías.
- [ ] Crear el formulario y probarlo con 2 o 3 personas antes de la primera sesión.
- [ ] Ensayo completo con teléfonos reales.

## 9. Qué cambia en el informe después del piloto

- `metodologia.tex`: el piloto como quinto procedimiento, el instrumento y Consideraciones éticas.
- `resultados.tex`: nueva subsección con los resultados y sus límites.
- `conclu.tex`: la pregunta 6, la tercera palanca de la hipótesis («mecanismos de incentivo»), «nada se probó
  en un evento real» y el trabajo futuro.
- `anexoA.tex`: el cuestionario del piloto.
- `main.tex`: el Resumen.
