# Contingencia sin conexión

## Purpose

Cómo sigue operando el escáner cuando se cae la red del recinto (ADR-15): decide con una copia de contingencia sellada de hasta 10 minutos, guarda las decisiones del guardia y las sincroniza con `POST /qr/sync`, que las reverifica y deja alertas. Riesgo residual declarado: dos puertas sin red pueden admitir a la misma persona; se detecta al sincronizar, no se evita. Archivos principales: `backend/app/routers/events.py`, `backend/app/routers/qr.py`, `backend/app/security.py`, `frontend/src/offline.ts`, `frontend/src/pages/ScannerPage.tsx`.

## Requirements

### Requirement: Copia de contingencia sellada
El servidor SHALL entregar al personal autenticado una copia por evento con los RUT con entrada, los ya admitidos, las prohibiciones, las cédulas revocadas, su hora de generación, una vigencia de 600 segundos y un sello HMAC sobre evento y hora de generación; el escáner SHALL pedirla cada 60 segundos mientras hay red y guardarla solo en memoria.

#### Scenario: Copia sin autenticación
- **WHEN** se pide `GET /events/{id}/contingencia` sin token
- **THEN** el servidor responde 401

### Requirement: Decisión sin red
Sin red, el escáner SHALL rechazar localmente según la copia vigente del mismo evento (revocada, prohibición, sin entrada, ya admitida) y según lo que el propio lector ya registró sin red; solo si todo calza SHALL dejar que el guardia compare la foto y decida.

#### Scenario: Persona con entrada y sin antecedentes en la copia
- **WHEN** el escáner sin red lee un QR vigente de un RUT con entrada, sin prohibición ni ingreso previo
- **THEN** muestra la foto firmada y espera la decisión del guardia

#### Scenario: Mismo QR dos veces en el mismo lector
- **WHEN** el lector sin red ya registró ese nonce
- **THEN** responde `already_used` sin consultar al guardia

### Requirement: Sin copia vigente no se deja pasar a nadie
El escáner SHALL tratar como inutilizable una copia de más de 600 segundos o de otro evento, y en ese caso SHALL derivar a la persona a la fila normal en vez de permitir que el guardia la deje pasar.

#### Scenario: Copia vencida
- **WHEN** la última copia tiene más de 10 minutos
- **THEN** el veredicto es `stale` y no hay botón para dejar pasar

#### Scenario: Copia de otro evento
- **WHEN** el guardia cambió de evento y la copia en memoria es del anterior
- **THEN** el veredicto es `stale`

### Requirement: Cola de decisiones por guardia
El escáner SHALL guardar las decisiones sin red en `localStorage` en una cola separada por cuenta de guardia, y SHALL mostrar las colas pendientes de otras cuentas con la opción explícita de enviarlas a nombre propio.

#### Scenario: Otro guardia toma la tablet
- **WHEN** inicia sesión un guardia en un lector con decisiones pendientes de otra cuenta
- **THEN** ve un aviso y esas decisiones solo se envían si toca «Enviar a mi nombre»

### Requirement: Hora de escaneo acotada por el servidor
Al sincronizar, el servidor SHALL creer la hora de escaneo declarada solo dentro de la ventana de confirmación de un `check` en línea previo de ese QR, o si no, dentro de la vigencia de la copia sellada con que se decidió; sin ninguno de los dos SHALL evaluar la decisión a la hora de la sincronización.

#### Scenario: QR fotografiado hace una hora con hora declarada antigua
- **WHEN** se sincroniza un `admit` de un QR emitido hace una hora declarando una hora de escaneo en que estaba vigente
- **THEN** el servidor lo evalúa dentro de la vigencia de la copia sellada, responde `expired` con alerta y el titular sigue pudiendo entrar

#### Scenario: Sello de otro evento o falsificado
- **WHEN** el sello no corresponde al evento de la fila o no lo emitió el servidor
- **THEN** la hora declarada se ignora y la decisión se evalúa a la hora de sincronizar

#### Scenario: Caída larga sincronizada después
- **WHEN** el guardia decidió con una copia de hace 5 minutos y la red vuelve varios minutos más tarde
- **THEN** se respeta la hora declarada, dentro de la vigencia de la copia

### Requirement: Sincronización idempotente
El servidor SHALL tratar como ya registrada una decisión cuyo nonce tiene una sincronización previa o un ingreso en línea concedido, y SHALL reverificar las demás aunque exista un `check` o un intento en línea rechazado con ese nonce.

#### Scenario: Lote reenviado
- **WHEN** el escáner reenvía un lote ya sincronizado
- **THEN** el servidor devuelve los mismos resultados sin duplicar el historial

#### Scenario: Check rechazado y entrada sin red con el mismo QR
- **WHEN** un `check` en línea rechazó a una persona con prohibición y luego entra sin red por otra puerta con el mismo QR
- **THEN** la sincronización registra el ingreso como alerta `banned`

### Requirement: Alertas de ingresos sin red
El historial SHALL registrar cada decisión sin red con `offline = true` y la hora del escaneo, y SHALL marcar como alerta todo ingreso que el guardia permitió y el servidor no habría permitido.

#### Scenario: Doble ingreso por dos puertas sin red
- **WHEN** la misma persona fue admitida sin red en dos puertas y ambas sincronizan
- **THEN** la segunda queda como `already_admitted` con alerta

### Requirement: Una alerta no consume la entrada
El servidor SHALL consumir el QR y marcar la entrada como admitida solo cuando la decisión sin red habría sido permitida; una alerta SHALL quedar en el historial sin quemar la entrada del titular.

#### Scenario: «No coincide» en línea y el mismo QR entra sin red
- **WHEN** un QR rechazado en línea por foto entra sin red por otra puerta
- **THEN** la sincronización responde `already_used` con alerta y el titular entra después con un QR nuevo

### Requirement: Una decisión inválida no traba la cola
El servidor SHALL responder un resultado por decisión, incluido `unknown_gate` cuando la fila ya no existe, y el escáner SHALL enviar en lotes de hasta 500, aislar las decisiones que el servidor rechace y avisarlo al guardia.

#### Scenario: Fila borrada con decisiones pendientes
- **WHEN** se sincroniza una decisión cuya fila ya no existe
- **THEN** esa decisión queda como `unknown_gate`, con alerta si el guardia dejó pasar, y el resto del lote se procesa

### Requirement: Un solo envío de sincronización a la vez
El escáner SHALL tener como máximo una sincronización en curso y SHALL reintentar cada 15 segundos mientras queden decisiones pendientes.

#### Scenario: Decisión nueva durante un envío
- **WHEN** el guardia registra una decisión mientras un `/qr/sync` está en vuelo
- **THEN** no sale un segundo envío en paralelo; la decisión va en el siguiente
