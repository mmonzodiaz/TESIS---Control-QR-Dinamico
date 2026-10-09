# Revocación de cédulas

## Purpose

Cómo deja de servir una cédula de un teléfono perdido o reemplazado (ADR-14): el Registro Civil publica una lista firmada de emisiones revocadas, el backend del recinto la usa en cada validación y el escáner la recibe en la copia de contingencia. No es un servicio de estado estándar (status list, OCSP); es una limitación declarada. Archivos principales: `backend/scripts/registro_civil_sim.py`, `backend/app/revocation.py`, `backend/app/credential.py`, `frontend/src/offline.ts`.

## Requirements

### Requirement: Lista firmada sin datos personales
El Registro Civil SHALL publicar en `GET /revocaciones` una lista firmada por el emisor con los identificadores (hashes) de las emisiones revocadas, sin RUT ni nombres.

#### Scenario: Lista alterada en el camino
- **WHEN** el backend recibe una lista cuya firma no verifica o cuya fecha está fuera de rango
- **THEN** la descarta y conserva la última lista válida, sin responder 500

### Requirement: Revocación aplicada en la puerta
El backend SHALL rechazar con `revoked` una cédula cuya emisión figura en la lista, y SHALL refrescar la lista como máximo cada 30 segundos.

#### Scenario: Teléfono reportado como perdido
- **WHEN** se presenta un QR de una cédula revocada
- **THEN** el servidor responde `revoked`

### Requirement: Continuidad si cae el Registro Civil
Si el Registro Civil no responde, el backend SHALL seguir validando con la última lista válida y SHALL registrar una advertencia.

#### Scenario: Registro Civil caído
- **WHEN** falla la descarga de la lista
- **THEN** el backend usa la lista anterior y deja una advertencia en el registro

### Requirement: Aviso al guardia sin lista confiable
El escáner SHALL avisar al guardia cuando la copia de contingencia indica que el servidor nunca obtuvo la lista o que estaba atrasada más de 120 segundos al generarla, y SHALL seguir decidiendo igual (no falla cerrado).

#### Scenario: El backend arrancó sin lista
- **WHEN** la copia trae `revocation_list_issued_at` nulo
- **THEN** el escáner muestra un aviso para pedir el carnet ante la duda, y la decisión sin red no cambia

#### Scenario: Lista atrasada
- **WHEN** la lista tenía 15 minutos de atraso al generar la copia
- **THEN** el aviso indica la antigüedad en minutos

### Requirement: El teléfono sabe si su cédula fue revocada
Al abrir la cédula, el teléfono SHALL consultar la lista de revocadas y SHALL avisar al titular si su emisión fue revocada.

#### Scenario: Cédula activada en otro teléfono
- **WHEN** el titular abre una cédula que fue reemplazada por una activación en otro teléfono
- **THEN** el teléfono muestra «Tu cédula ya no es válida en este teléfono»
