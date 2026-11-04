# Biometría en el dispositivo del guardia

## Purpose

Módulo opcional que compara la foto firmada del QR con lo que ve la cámara del guardia, como apoyo a la verificación visual (ADR-16, que reemplaza a ADR-5). Va apagado por defecto y su fundamento legal está en `docs/ley-21719.md`. El modelo `w600k_mbf.onnx` no se versiona (pesos de investigación no comercial). Archivos principales: `frontend/src/biometrics.ts`, `frontend/src/pages/ScannerPage.tsx`, `backend/scripts/biometric_degradation.py`, `docs/results/biometric-degradation.json`. El recorte y el reescalado del canvas se contrastaron contra Python en Chrome con fotos de LFW (`docs/results/biometric-browser-check.md`); pendiente declarado: la cámara en vivo en terreno.

## Requirements

### Requirement: Apagado por defecto
El módulo SHALL activarse solo con `VITE_BIOMETRIA=1` exacto; apagado, SHALL rechazar cualquier carga sin descargar el modelo ni el runtime.

#### Scenario: Variable ausente o con otro valor
- **WHEN** `VITE_BIOMETRIA` no está definida o vale `0` o `true`
- **THEN** el módulo está apagado y `loadModel` falla sin pedir el modelo

### Requirement: Comparación en el dispositivo del guardia
La comparación SHALL ejecutarse en el escáner del guardia y nunca en el teléfono del titular ni en el servidor.

#### Scenario: Guardia pide comparar
- **WHEN** el guardia toca «Comparar rostro (opcional)» y la persona acepta
- **THEN** el escáner calcula los dos vectores y su similitud localmente

### Requirement: Consentimiento expreso antes de comparar
El escáner SHALL informar qué se hará, para qué, por cuánto tiempo y cómo negarse, y SHALL NOT comparar hasta que el guardia registre que la persona aceptó. La aceptación SHALL valer solo para ese ingreso.

#### Scenario: La persona no acepta
- **WHEN** el guardia toca «No acepta»
- **THEN** no se compara nada y el guardia sigue con la revisión visual

#### Scenario: Persona siguiente
- **WHEN** el guardia lee otro QR después de una comparación aceptada
- **THEN** el escáner vuelve a pedir el consentimiento

### Requirement: Evidencia del consentimiento
La decisión del guardia SHALL llevar la marca de consentimiento, en línea y sin red, y el servidor SHALL guardar solo el nonce, la fila, quién la registró y la hora, porque la carga de probar el consentimiento es del responsable. Esa evidencia SHALL NOT incluir imagen, vector ni puntaje.

#### Scenario: Decisión con consentimiento
- **WHEN** el guardia decide después de una comparación aceptada
- **THEN** queda la evidencia y el historial muestra «Comparación facial consentida»

#### Scenario: QR falsificado
- **WHEN** las firmas del QR no son válidas
- **THEN** no se guarda evidencia

### Requirement: Comparación solo con una decisión pendiente
El escáner SHALL ofrecer la comparación solo cuando quede una decisión del guardia por tomar.

#### Scenario: Lectura ya rechazada
- **WHEN** la lectura terminó rechazada o el ingreso ya se registró
- **THEN** no se ofrece comparar

### Requirement: Sin persistencia de datos biométricos
El módulo SHALL descartar el fotograma de la cámara y los vectores faciales después de calcular el puntaje, sin guardarlos en el dispositivo ni enviarlos al servidor.

#### Scenario: Resultado de una comparación
- **WHEN** termina una comparación
- **THEN** de ella solo queda el puntaje y el umbral en la pantalla

### Requirement: El puntaje no decide
El escáner SHALL mostrar el puntaje y el umbral como información, y la decisión SHALL seguir siendo del guardia con los mismos botones del flujo en dos pasos.

#### Scenario: Puntaje bajo el umbral
- **WHEN** el puntaje queda bajo el umbral
- **THEN** el escáner lo muestra con «Decide tú» y el guardia todavía puede tocar «Dejar pasar» o «No coincide»

#### Scenario: Puntaje sobre el umbral sin detector de rostros
- **WHEN** el puntaje supera el umbral
- **THEN** el escáner muestra «Sobre la referencia», advierte que no comprueba que haya un rostro y SHALL NOT afirmar que el rostro coincide

### Requirement: Vía de ingreso no biométrica
El sistema SHALL permitir el ingreso sin comparación biométrica, porque la Ley 21.719 presume que el consentimiento no fue libre si la recolección no era necesaria para el servicio.

#### Scenario: Asistente que no quiere comparación facial
- **WHEN** el guardia no usa la comparación o el módulo está apagado
- **THEN** el flujo de verificación visual en dos pasos funciona igual

### Requirement: Umbral amarrado al experimento
El umbral del escáner SHALL ser el que midió el experimento para la configuración de producción (112×112 en 900 B) a FAR 10⁻³, y un test SHALL compararlo contra `docs/results/biometric-degradation.json`.

#### Scenario: Umbral cambiado a mano
- **WHEN** alguien cambia `THRESHOLD` sin volver a medir
- **THEN** `biometrics.test.ts` falla

### Requirement: Reintento de carga del modelo
Si la carga del modelo falla, el módulo SHALL olvidar ese fallo y reintentar en la siguiente comparación.

#### Scenario: Red inestable al abrir el escáner
- **WHEN** falla la primera descarga del modelo y luego vuelve la red
- **THEN** la siguiente comparación vuelve a intentar la carga y puede funcionar
