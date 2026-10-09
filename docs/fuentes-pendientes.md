# Fuentes para los dos hechos pendientes del handoff

Búsqueda del 2026-10-09 (skill `buscador-citas`). Responde al pendiente de `HANDOFF.md §7` y de
`guia-tesis.md` («Conseguir fuentes citables»). Solo se listan fuentes que se abrieron y leyeron;
lo que no se pudo verificar se dice. Las fuentes que ya estaban en
`docs/referencias-comparacion-rostros.bib` (`srcei_resolucion466_2024`, `srcei_resolucion234_2026`,
`illanes_pago_carnet_2025`) no se repiten como entradas nuevas, pero se usan.

**Resumen.** Ninguno de los dos hechos tiene una fuente primaria que lo afirme tal cual:

1. **Foto a color en la app:** sin fuente. La fuente primaria (Res. Ex. 234/2026) dice, para la
   fotografía principal, **blanco y negro**, y lista aparte un «retrato principal del titular en
   movimiento». Lo único citable que se acerca es ese retrato animado. El color sigue siendo
   observación del autor: hay que respaldarlo con una **captura propia fechada** (ver §1.4).
2. **Formato del QR del carnet:** sin fuente primaria del contenido. La norma (Res. Ex. 466/2024)
   solo nombra el QR. Lo más sólido es una **verificación propia reproducible** del servidor del
   Registro Civil (rehecha hoy, §2.1), más una fuente técnica secundaria nueva (Regula, 2026) que
   describe qué datos lleva.

---

## 1. La app Identificación Digital muestra una foto a color del titular junto al QR

### 1.1 Fuente primaria (ya en el `.bib`): Res. Ex. 234/2026 — respalda lo contrario, en parte

- **Qué dice** (texto extraído del PDF del Diario Oficial N° 44.448, 13-05-2026, CVE 2807801):
  - Punto 1, características de seguridad: *«d) Retrato principal del titular en movimiento, para
    demostrar que no es una captura de pantalla»* y *«e) Retrato secundario del titular en menor
    tamaño»*; *«h) Un código QR con vigencia limitada»*.
  - Punto 3, menciones del anverso: *«a) Fotografía principal en blanco y negro»* y *«b) Fotografía
    secundaria en blanco y negro en tamaño reducido con año de nacimiento»*.
  - Punto 2: diseño y menciones iguales a los de la cédula física (Res. Ex. 466/2024), salvo chip y
    Braille.
- **Respaldo:** primaria. **No respalda** el color; respalda que existe un **retrato en movimiento**
  como medida antipantallazo, distinto de la «fotografía» en blanco y negro. Nada en la resolución
  dice de qué color es ese retrato.
- **Uso correcto en la tesis:** citar el retrato en movimiento y la fotografía en blanco y negro
  textualmente; el color, como observación propia (§1.4). Si la captura muestra el retrato a color,
  la lectura «el retrato animado es el que se ve a color y la fotografía en B/N es otro elemento»
  es compatible con la norma, pero es interpretación, no hecho normado.
- **Fuente:** `srcei_resolucion234_2026` (ya en el `.bib`). PDF consultado el 2026-10-09:
  https://www.diariooficial.interior.gob.cl/publicaciones/2026/05/13/44448/01/2807801.pdf

### 1.2 Ficha oficial de la app (App Store) — respalda el QR, no la foto

- **Qué dice:** desarrollador «SRCEI», vendedor «Servicio de Registro Civil e Identificacion».
  Descripción: *«El ciudadano puede compartir mediante QR su identificación a una autoridad de
  verificación.»* Versión 1.7.0 (la ficha muestra «26 ago», sin año). No menciona foto ni color;
  las capturas de pantalla no tienen texto alternativo legible.
- **Respaldo:** primaria (publicada por el propio Servicio) para «la app oficial comparte la
  identificación mediante QR». **No respalda** la foto a color.

APA:
> Servicio de Registro Civil e Identificación. (s. f.). *Identificación Digital* (versión 1.7.0)
> [Aplicación móvil]. App Store. Recuperado el 9 de octubre de 2026, de
> https://apps.apple.com/cl/app/identificaci%C3%B3n-digital/id6736663106

```bibtex
@misc{srcei_app_identificacion_digital,
  title        = {Identificación Digital},
  author       = {{Servicio de Registro Civil e Identificación}},
  howpublished = {Aplicación móvil, App Store (Chile)},
  note         = {Versión 1.7.0. Ficha consultada el 2026-10-09},
  url          = {https://apps.apple.com/cl/app/identificaci%C3%B3n-digital/id6736663106}
}
```

### 1.3 Prensa previa al lanzamiento — respalda la imagen en movimiento, no el color

- **Qué dice:** Meganoticias (Constanza Galdames, 5 de junio de 2024), atribuyéndolo al Registro
  Civil sin cita directa: en la versión digital la imagen del titular será *«una imagen móvil y no
  estática como la del carnet físico»*; la app permitiría *«generar un holograma del Registro
  Civil»* para comprobar la autenticidad. No dice si la imagen es a color.
- **Respaldo:** secundaria, anterior al lanzamiento (diciembre de 2024); parcial. Útil solo como
  apoyo de la Res. Ex. 234/2026 (retrato en movimiento).

APA:
> Galdames, C. (2024, 5 de junio). *Nuevo carnet de identidad digital: ¿Cómo será?* Meganoticias.
> https://www.meganoticias.cl/nacional/449243-nuevo-carnet-de-identidad-digital-como-sera-pdp-05-06-2024.html

```bibtex
@misc{galdames_carnet_digital_2024,
  title        = {Nuevo carnet de identidad digital: ¿cómo será?},
  author       = {Galdames, Constanza},
  howpublished = {Meganoticias},
  year         = {2024},
  month        = {6},
  url          = {https://www.meganoticias.cl/nacional/449243-nuevo-carnet-de-identidad-digital-como-sera-pdp-05-06-2024.html},
  note         = {Fuente de prensa, anterior al lanzamiento. Consultada el 2026-10-09}
}
```

### 1.4 Lo que no se encontró y cómo cubrirlo

- **Sin fuente:** ni el Registro Civil, ni gob.cl (notas del lanzamiento del 16-12-2024), ni
  ChileAtiende, ni la prensa revisada (La Tercera, Meganoticias, The Clinic, Universidad de Chile)
  describen el color de la foto que muestra la app. Las fichas de las tiendas no tienen capturas
  legibles por texto.
- **Propuesta:** una **figura con captura propia** de la app, con metodología declarada en la
  leyenda o en una nota: fecha y hora de la captura, versión de la app (en *Ajustes* o en la
  tienda), sistema operativo y modelo del teléfono, y la cédula del propio autor con RUN, número
  de documento y QR **tapados** (el QR es un dato personal y un vector de *replay*, ver
  `threat-model.md` A1). Mejor dos capturas: la pantalla de la cédula y la de «mostrar QR».
  Que la figura muestre el retrato en movimiento a color resuelve también el conflicto con la
  Res. Ex. 234/2026 descrito en `attack-experiment.md §4.1`.
- **QR oficial de 256 bytes:** tampoco tiene fuente. La Res. Ex. 234/2026 no especifica el
  contenido del QR (solo «vigencia limitada»). Sigue siendo **medición propia** (una muestra);
  citarla como tal, con el método ya descrito en el handoff, sin publicar el payload.

---

## 2. El QR del carnet es una URL de consulta de vigencia con RUN y número de serie, sin firma ni foto

### 2.1 Verificación propia reproducible del servidor del Registro Civil (rehecha el 2026-10-09)

- **Qué se hizo:** una petición `HEAD` con datos **ficticios** (RUN 11.111.111-1, serie y MRZ en
  ceros), sin datos de ninguna persona:

  ```
  curl -sI "https://portal.sidiv.registrocivil.cl/docstatus?RUN=11111111-1&type=CEDULA&serial=000000000&mrz=000000000000000000000000"
  ```

- **Resultado** (2026-10-09, 04:51:40 GMT): `HTTP/1.1 301 Moved Permanently`, `Server: cloudflare`,
  `Location: https://portal.nuevosidiv.registrocivil.cl/document-validity?RUN=11111111-1&type=CEDULA&serial=000000000&mrz=000000000000000000000000`.
  El servidor oficial reconoce la ruta `docstatus` y reenvía **los cuatro parámetros intactos** a su
  servicio de validez de documentos.
- **Respaldo:** primaria en el sentido de que es el comportamiento del propio sistema del Registro
  Civil, pero **no** prueba qué codifica el QR: prueba que esa URL con esos parámetros es una
  consulta de vigencia que el Registro Civil atiende. Reproduce lo que `threat-model.md §6` ya
  afirmaba; ahora con fecha de hoy.
- **Cómo citarlo:** como verificación del autor con el comando y la fecha (en una nota al pie o en
  la metodología), no como referencia bibliográfica.

### 2.2 Fuente técnica secundaria nueva: Regula Forensics (2026) — respalda los datos, no la URL

- **Qué dice:** artículo del CTO de un proveedor de verificación documental (Ihar Kliashchou,
  20 de abril de 2026): el reverso tiene *«a QR code with personal information such as the RUN,
  document number, date of birth, and expiration date»* y *«Authorized inspectors can use the QR
  code to access this information via a government website.»* No da la URL ni menciona firma.
- **Respaldo:** secundaria (proveedor comercial, no revisada por pares); **parcial**: respalda que
  el QR lleva RUN, número de documento y fechas de nacimiento y vencimiento (coherente con el
  parámetro `mrz`) y que remite a un sitio del gobierno. Puede ser el «proveedor forense» que ya
  menciona `threat-model.md §6`; el documento no lo nombra, así que conviene confirmarlo.

APA:
> Kliashchou, I. (2026, 20 de abril). *Chilean passports and IDs: The challenges of processing*.
> Regula Forensics. https://regulaforensics.com/blog/chile-id-card-processing/

```bibtex
@misc{kliashchou_regula_chile_2026,
  title        = {Chilean Passports and {IDs}: The Challenges of Processing},
  author       = {Kliashchou, Ihar},
  howpublished = {Regula Forensics (blog técnico de proveedor)},
  year         = {2026},
  month        = {4},
  url          = {https://regulaforensics.com/blog/chile-id-card-processing/},
  note         = {Fuente comercial, no revisada por pares. Consultada el 2026-10-09}
}
```

### 2.3 Fuente primaria normativa (ya en el `.bib`): Res. Ex. 466/2024 — solo nombra el QR

- Lista el «código de respuesta rápida (código QR)» entre las menciones del reverso y dice que la
  fotografía principal va *«en blanco y negro grabada mediante láser»*. **No** describe el
  contenido del QR. Sigue siendo la cita correcta para «el carnet tiene QR» y para la foto en B/N.
  (`srcei_resolucion466_2024`.)

### 2.4 Incidente de mayo de 2025 y voz académica — respaldan el riesgo de copia, no el formato

- **Ya en el `.bib`:** `illanes_pago_carnet_2025` (The Clinic, 19-05-2025): QR recuperado desde el
  pantallazo de un reportaje y usado para consultar datos de una persona real. El post original
  del investigador en X (https://x.com/illanes00/status/1923964932359376960) **no se pudo abrir**
  (la plataforma devolvió HTTP 402); no citarlo sin leerlo.
- **Nueva, complementaria:** Diario Usach (Belén Muñoz B., 23 de mayo de 2025) entrevista a
  Leonardo Ochoa, de la Facultad Tecnológica de la Universidad de Santiago: *«cada vez que comparto
  una imagen de mi cédula de identidad estoy compartiendo el código QR»*, lo que *«podría poner en
  riesgo al sistema»*; recomienda tapar el QR. Dice también que el QR *«es generado por un
  algoritmo privado»*, sin más detalle: **no** usarla para el formato.
- **Respaldo:** secundaria (prensa institucional universitaria); respalda A1 (copia del QR por
  foto), no el contenido.

APA:
> Muñoz B., B. (2025, 23 de mayo). *Pagar con carnet: ¿Qué tan seguro es y por qué es vital
> proteger el QR de la cédula de identidad?* Diario Usach.
> https://www.diariousach.cl/pagar-con-carnet-que-tan-seguro-es-y-por-que-es-vital-proteger-el-qr-de

```bibtex
@misc{munoz_usach_qr_carnet_2025,
  title        = {Pagar con carnet: ¿qué tan seguro es y por qué es vital proteger el {QR} de la cédula de identidad?},
  author       = {Muñoz B., Belén},
  howpublished = {Diario Usach, Universidad de Santiago de Chile},
  year         = {2025},
  month        = {5},
  url          = {https://www.diariousach.cl/pagar-con-carnet-que-tan-seguro-es-y-por-que-es-vital-proteger-el-qr-de},
  note         = {Entrevista a Leonardo Ochoa (Facultad Tecnológica, Usach). Consultada el 2026-10-09}
}
```

### 2.5 Revisadas y descartadas (o solo como pista)

- **Pauta.cl, 13-05-2022** (Santiago Parro): el Pase de Movilidad se obtenía escaneando el QR de
  la cédula en `scanmevacuno.gob.cl`. Muestra que un servicio del Estado consumía el QR del carnet
  como identificador, pero no dice qué contiene. Pista, no respaldo.
- **Gist `jbovet/registrocivil.py`** (GitHub): consulta el formulario
  `portal.sidiv.registrocivil.cl/usuarios-portal/pages/DocumentRequestStatus.xhtml` con RUN, tipo
  de documento y número de documento. Es **otro** punto de entrada (el formulario web, no
  `docstatus`); confirma que la consulta de vigencia usa RUN + tipo + número de serie, nada más.
  Código de terceros, secundario.
- **Terra.cl, 2013** (lanzamiento del formato 2013), citado por un blog personal: el QR permitiría
  *«enlazar directamente con el sitio web del registro civil para verificar si la cédula está
  vigente»*. **No se pudo abrir** el original (error TLS; archive.org inaccesible desde aquí), así
  que **no citar** hasta leerlo.
- **BCN, «Identidad digital: conceptos y legislación» (Weidenslaufer y Roberts, octubre de
  2022):** solo menciona que la cédula cuenta con un código QR; no describe su contenido.
- **Wikipedia, La Tercera, gob.cl (lanzamiento), Veridas:** no describen el contenido del QR ni el
  color de la foto de la app; Veridas (proveedor) afirma un QR dinámico «que varía su estructura
  matemática», sin fuente: no usar.

---

## 3. Qué falta

| Hecho | Mejor respaldo disponible | Falta |
|---|---|---|
| Foto a color en la app | Ninguno; la Res. Ex. 234/2026 respalda el **retrato en movimiento** y dice B/N para la fotografía | Captura propia fechada (§1.4) |
| QR oficial de 256 B, sin foto | Medición propia | Nada citable; declararlo como medición de una muestra |
| QR del carnet = URL `docstatus` con RUN, tipo, serie y MRZ | Verificación propia del servidor (§2.1) + Regula 2026 (§2.2) + triangulación ya documentada | Fuente oficial del contenido (no existe publicada); formato del carnet nuevo (2024) sin lectura publicada |
| Riesgo de copia del QR del carnet (A1) | The Clinic 2025 (ya) + Diario Usach 2025 | — |

Antes de redactar, pasar las entradas nuevas por `verificador-citas`.
