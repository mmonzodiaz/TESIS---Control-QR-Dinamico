# QR dinámico

## Purpose

El QR que muestra el titular: lo genera el teléfono sin conexión con la cédula firmada (foto incluida), lo firma con la clave del dispositivo y lo cifra para los lectores autorizados (ADR-10, ADR-11; reemplaza al token opaco de ADR-1). Su vigencia de 45 s está derivada en `docs/ttl-justification.md` (ADR-3). Archivos principales: `backend/app/credential.py`, `frontend/src/credential.ts`, `frontend/src/pages/CedulaView.tsx`, `backend/tests/vectors/qr-v2.json`.

## Requirements

### Requirement: Generación sin conexión en el teléfono
El teléfono SHALL generar el QR localmente, sin consultar ningún servidor, y SHALL renovarlo cada 45 segundos con un nonce aleatorio y la hora de emisión.

#### Scenario: Teléfono sin red
- **WHEN** el titular abre su cédula con el PIN y el teléfono no tiene conexión
- **THEN** el teléfono muestra un QR válido y lo reemplaza por otro cada 45 segundos

### Requirement: Contenido firmado del QR
El QR SHALL contener la cédula firmada por el emisor (RUT, nombre, hash SHA-256 de la foto y clave pública del teléfono), la foto, y una firma Ed25519 del teléfono sobre el hash de la cédula, el nonce y la hora de emisión, con separación de dominio entre la firma del emisor y la del dispositivo.

#### Scenario: Foto cambiada
- **WHEN** un QR lleva una foto cuyo hash no coincide con el firmado en la cédula
- **THEN** el lector lo rechaza como inválido

#### Scenario: Cédula copiada a otro teléfono
- **WHEN** un QR está firmado con una clave de dispositivo distinta de la que va dentro de la cédula
- **THEN** el lector y el servidor lo rechazan como inválido

#### Scenario: Emisor falso
- **WHEN** la cédula no tiene una firma válida de la clave pública del emisor
- **THEN** el lector y el servidor lo rechazan como inválido

### Requirement: Cifrado para lectores autorizados
El QR SHALL ir cifrado para la clave pública X25519 de lectores autorizados (X25519 efímera + HKDF + ChaCha20-Poly1305) y codificado como `CA2:` + base45, de modo que quien lo fotografía no lea la identidad ni la foto.

#### Scenario: Lector no autorizado
- **WHEN** un lector sin la clave privada de lectores intenta leer el QR
- **THEN** no puede descifrarlo ni obtener RUT, nombre ni foto

### Requirement: Vigencia del QR
Un lector SHALL considerar vencido un QR cuya hora de emisión tiene más de 45 s más 5 s de tolerancia de reloj, y SHALL rechazar como inválido uno fechado más de 5 s en el futuro.

#### Scenario: Captura usada un minuto después
- **WHEN** se presenta un QR emitido hace 60 segundos
- **THEN** el servidor responde `expired`

#### Scenario: QR fechado en el futuro
- **WHEN** la hora de emisión supera la hora del servidor en más de 5 segundos
- **THEN** el servidor responde `invalid`

### Requirement: Formato compartido entre backend y frontend
El backend y el frontend SHALL producir y leer el mismo QR byte a byte, fijado por los vectores de `backend/tests/vectors/qr-v2.json`, que solo se regeneran al cambiar el formato a propósito.

#### Scenario: Mismos vectores en ambos lados
- **WHEN** corren los tests de `credential.py` y de `credential.ts` con los vectores compartidos
- **THEN** ambos generan y verifican el mismo QR
