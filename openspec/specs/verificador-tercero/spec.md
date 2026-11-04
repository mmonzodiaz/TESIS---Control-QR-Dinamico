# Verificador de terceros

## Purpose

Lo mínimo que el emisor entrega para que un tercero verifique la credencial sin usar el código del prototipo (pregunta 6 y cuarta recomendación de la tesis; ADR-18). Archivos principales: `docs/especificacion-verificador.md`, `backend/registro_civil/app.py`, `backend/tests/test_verifier_spec.py`.

## Requirements

### Requirement: Publicación de la clave del emisor
El Registro Civil simulado SHALL publicar, sin autenticación, la clave pública del emisor, la clave pública de lectores, la vigencia y la tolerancia del QR, y SHALL NOT incluir en esa respuesta claves privadas ni datos personales.

#### Scenario: Consulta sin sesión
- **WHEN** alguien pide `GET /clave-publica`
- **THEN** recibe esos cuatro datos y la referencia a la especificación

### Requirement: Especificación suficiente
`docs/especificacion-verificador.md` SHALL bastar para verificar un QR y la lista de revocadas sin importar el código del prototipo, y un test SHALL demostrarlo con una implementación independiente.

#### Scenario: Formato cambiado sin actualizar el documento
- **WHEN** alguien cambia el formato del QR o de la lista
- **THEN** `tests/test_verifier_spec.py` falla

### Requirement: Autorización del lector
La clave privada de lectores SHALL entregarse solo a los verificadores que el emisor autoriza, porque sin ella el QR no se puede descifrar.

#### Scenario: Tercero sin autorización
- **WHEN** un tercero tiene lo publicado, pero no la clave de lectores
- **THEN** no puede leer la identidad ni la foto del QR
