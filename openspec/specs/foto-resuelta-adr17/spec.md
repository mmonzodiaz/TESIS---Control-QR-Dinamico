# Foto resuelta por el emisor (ADR-17)

## Purpose

Módulo secundario que simula la arquitectura alternativa: el QR llevaría solo el hash de la foto y el verificador autorizado pediría la imagen al emisor a partir del núcleo firmado. Existe para contrastar arquitecturas con números; no es el flujo principal y va apagado por defecto. El acceso a una base así no existe en la realidad: es un supuesto hipotético. Archivos principales: `backend/registro_civil/app.py`, `backend/scripts/registro_civil_sim.py`, `backend/tests/test_registro_civil.py`.

## Requirements

### Requirement: Apagado por defecto
El endpoint `POST /foto` del Registro Civil simulado SHALL responder como una ruta inexistente (404) salvo que `ENABLE_FOTO_RESUELTA=1`, porque el recinto recibe el núcleo firmado en cada validación y, encendido, podría pedir la foto de cada asistente.

#### Scenario: Módulo apagado
- **WHEN** se llama a `POST /foto` con un núcleo firmado legítimo y la bandera apagada
- **THEN** el servicio responde 404 con el mismo cuerpo que una ruta inexistente

### Requirement: Autorización por núcleo firmado
Encendido, el servicio SHALL entregar la foto solo a quien presente un núcleo con firma válida del emisor, y SHALL entregar la foto cuyo hash está firmado en ese núcleo, no la que tenga el padrón.

#### Scenario: Núcleo sin firma válida
- **WHEN** se envía un núcleo con una firma que no es del emisor
- **THEN** no se entrega ninguna foto

#### Scenario: Enumerar rostros por RUT
- **WHEN** alguien envía solo un RUT, sin núcleo firmado
- **THEN** el servicio no entrega la foto

### Requirement: Límite propio de consultas
Encendido, el endpoint SHALL limitar a 60 por minuto por IP las consultas, aparte del límite de enrolamiento.

#### Scenario: Consultas masivas
- **WHEN** una IP supera 60 consultas de foto por minuto
- **THEN** las siguientes reciben 429
