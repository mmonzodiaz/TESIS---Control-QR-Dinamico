# Validación de acceso

## Purpose

Lo que decide el recinto en la puerta cuando hay red: el escáner del guardia descifra y verifica el QR localmente y consulta `POST /qr/validate` sin la foto, en dos pasos (ADR-12), contra la lista de entradas nominativas por RUT del evento (ADR-13), con uso único y anti pass-back (ADR-8) y prohibiciones de ingreso. Archivos principales: `backend/app/routers/qr.py`, `backend/app/models.py`, `frontend/src/pages/ScannerPage.tsx`, `frontend/src/reasons.ts`.

## Requirements

### Requirement: Verificación en dos pasos
El servidor SHALL aceptar `check` sin consumir el QR ni registrar ingreso, y SHALL registrar el ingreso solo cuando el guardia confirma con `admit` tras comparar la foto firmada con la persona.

#### Scenario: Paso 1, verificación
- **WHEN** el escáner envía `check` con un QR válido de una persona con entrada
- **THEN** el servidor responde `pending` con los datos del asistente, sin consumir el QR ni la entrada

#### Scenario: Paso 2, el guardia deja pasar
- **WHEN** el guardia toca «Dejar pasar» y el escáner envía `admit`
- **THEN** el servidor consume el QR, marca la entrada como admitida y lo registra en el historial

### Requirement: «No coincide» no quema la entrada del titular
Cuando el guardia rechaza con `reject` porque la foto no es de quien está en la puerta, el servidor SHALL inutilizar ese QR y SHALL dejar la entrada sin consumir para que el titular entre con un QR nuevo.

#### Scenario: Cómplice con el QR del titular
- **WHEN** el guardia rechaza un QR con `reject`
- **THEN** el motivo es `photo_mismatch`, ese QR ya no sirve en ninguna fila y el titular puede entrar después con otro QR

### Requirement: Confirmación después del vencimiento
El servidor SHALL aceptar la confirmación `admit` de un QR ya vencido solo si ese QR pasó un `check` hace 60 segundos o menos.

#### Scenario: El guardia tarda en mirar la foto
- **WHEN** el QR vence mientras el guardia compara la foto y confirma dentro de los 60 segundos desde el `check`
- **THEN** el ingreso se registra

#### Scenario: Confirmación fuera de la ventana
- **WHEN** la confirmación llega más de 60 segundos después del `check` o sin `check` previo
- **THEN** el servidor responde `expired`

### Requirement: Entrada nominativa por RUT
El servidor SHALL admitir solo a una persona cuyo RUT firmado figure en la lista de entradas del evento de la fila, y la misma cédula SHALL servir en cualquier evento donde ese RUT tenga entrada.

#### Scenario: Cédula válida sin entrada
- **WHEN** el RUT de una cédula válida no está en la lista del evento
- **THEN** el servidor responde `no_ticket`

#### Scenario: Otro evento con entrada
- **WHEN** la misma persona presenta su cédula en otro evento donde tiene entrada
- **THEN** es admitida en ese evento

### Requirement: Uso único y anti pass-back
Cada QR SHALL servir para un solo ingreso aunque varias filas lo escaneen a la vez, y una persona ya admitida SHALL ser rechazada con cualquier QR nuevo en el mismo evento.

#### Scenario: Escaneos concurrentes del mismo QR
- **WHEN** dos filas confirman el mismo QR al mismo tiempo
- **THEN** solo una registra el ingreso y la otra recibe `already_used`

#### Scenario: Persona ya ingresada
- **WHEN** una persona admitida presenta un QR nuevo de su cédula en el mismo evento
- **THEN** el servidor responde `already_admitted`

### Requirement: Prohibiciones de ingreso
El servidor SHALL rechazar con `banned` a una persona cuyo RUT tiene prohibición de ingreso, revisándolo en cada validación para que una prohibición agregada a última hora aplique.

#### Scenario: Hincha sancionado con su propia cédula
- **WHEN** una persona con prohibición presenta su cédula
- **THEN** el servidor responde `banned`

### Requirement: Motivos de rechazo conocidos por el escáner
Todo motivo que devuelva el servidor SHALL tener texto y color en el escáner; los motivos son `invalid`, `revoked`, `no_ticket`, `banned`, `expired`, `already_used`, `already_admitted`, `photo_mismatch` y `unknown_gate`.

#### Scenario: Motivo sin etiqueta o huérfano
- **WHEN** un motivo de la lista del backend en `reasons.test.ts` no tiene etiqueta o color, o `frontend/src/reasons.ts` tiene uno que el backend ya no usa
- **THEN** `reasons.test.ts` falla

### Requirement: Límite de validaciones por guardia
El servidor SHALL limitar a 120 por minuto por cuenta de guardia las llamadas a `/qr/validate` y `/qr/sync`.

#### Scenario: Token de guardia usado para sondear cédulas
- **WHEN** una cuenta supera 120 validaciones en un minuto
- **THEN** las siguientes reciben 429
