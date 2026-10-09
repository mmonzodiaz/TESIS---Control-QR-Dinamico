# Cédula digital

## Purpose

Simula la app de Identificación Digital en el teléfono del titular: enrolamiento ante un Registro Civil simulado, credencial firmada ligada al teléfono, PIN local y reporte de pérdida. La cédula es de la persona, no del evento (ADR-13). Archivos principales: `backend/registro_civil/app.py`, `backend/scripts/registro_civil_sim.py`, `frontend/src/wallet.ts`, `frontend/src/pages/CedulaPage.tsx`. La clave de activación de 8 caracteres sustituye a ClaveÚnica más la verificación facial de la app real; es una limitación declarada.

## Requirements

### Requirement: Enrolamiento con RUT y clave de activación
El Registro Civil simulado SHALL emitir una cédula firmada con Ed25519 solo si el RUT y la clave de activación calzan con el padrón, y SHALL responder lo mismo (401) cuando el RUT no existe o la clave es incorrecta.

#### Scenario: Enrolamiento correcto
- **WHEN** el teléfono envía a `POST /enrolar` un RUT inscrito, su clave de activación y la clave pública que acaba de crear
- **THEN** recibe la cédula firmada por el emisor, la clave pública de lectores autorizados y la hora del servidor

#### Scenario: RUT inexistente o clave incorrecta
- **WHEN** el RUT no está en el padrón o la clave no corresponde
- **THEN** el servicio responde 401 con el mismo mensaje en ambos casos, sin revelar quién está en el padrón

### Requirement: Cédula ligada al teléfono
La cédula SHALL llevar firmada dentro la clave pública Ed25519 del teléfono que se enroló, y el teléfono SHALL rechazar una cédula ligada a otra clave.

#### Scenario: El Registro Civil devuelve una cédula de otro teléfono
- **WHEN** la clave pública dentro de la cédula recibida no es la del teléfono
- **THEN** el teléfono no la guarda y muestra «El Registro Civil devolvió una cédula ligada a otro teléfono»

### Requirement: Una cédula activa por persona
El Registro Civil SHALL revocar la cédula activa anterior de una persona cuando esa persona se enrola en otro teléfono.

#### Scenario: Activación en un segundo teléfono
- **WHEN** una persona con cédula activa se enrola desde otro teléfono
- **THEN** la emisión anterior pasa a la lista de revocadas y solo la nueva queda activa

### Requirement: Reporte de pérdida
El Registro Civil SHALL revocar la cédula activa de una persona cuando ella lo pide con su RUT y su clave de activación desde cualquier dispositivo.

#### Scenario: «¿Perdiste tu teléfono?»
- **WHEN** se envía a `POST /reportar-perdida` un RUT y su clave correcta
- **THEN** la cédula activa queda revocada y aparece en la lista firmada de revocadas

#### Scenario: Clave incorrecta en el reporte
- **WHEN** la clave no corresponde al RUT
- **THEN** el servicio responde 401 y no revoca nada

### Requirement: Límite de intentos de la clave de activación
El Registro Civil SHALL limitar a 10 por minuto por IP los intentos de enrolamiento y de reporte de pérdida, que comparten el mismo límite.

#### Scenario: Fuerza bruta de la clave
- **WHEN** una misma IP supera 10 solicitudes por minuto a `/enrolar` y `/reportar-perdida`
- **THEN** las siguientes reciben 429 hasta que pasa la ventana

### Requirement: Cédula guardada cifrada con PIN
El teléfono SHALL guardar la cédula, la clave del dispositivo y la clave de lectores cifradas con un PIN de 6 dígitos, y SHALL bloquear el ingreso del PIN por 60 segundos cada 5 fallos seguidos.

#### Scenario: PIN incorrecto repetido
- **WHEN** el titular ingresa 5 PIN incorrectos seguidos
- **THEN** el ingreso de PIN queda bloqueado por 60 segundos

#### Scenario: PIN correcto
- **WHEN** el titular ingresa su PIN correcto
- **THEN** el teléfono descifra la cédula y puede mostrar el QR

### Requirement: Padrón consistente bajo concurrencia
El Registro Civil simulado SHALL serializar las lecturas y escrituras del padrón dentro del proceso y SHALL escribirlo de forma atómica, para que ninguna emisión se pierda ni un lector vea el archivo a medio escribir.

#### Scenario: Enrolamientos y reporte de pérdida simultáneos
- **WHEN** varios enrolamientos y un reporte de pérdida llegan al mismo tiempo
- **THEN** todas las emisiones quedan registradas en el padrón y cualquier revocación posterior las alcanza
