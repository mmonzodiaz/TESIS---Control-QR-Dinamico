# Personal y sesiones

## Purpose

Cuentas del personal del recinto (administradores y guardias), sus sesiones y los controles OWASP Top 10 que las protegen (`docs/security-guarantees.md §1b`). El asistente no tiene cuenta: solo tiene su cédula. Limitaciones declaradas: sesión en `sessionStorage` y no en cookie `HttpOnly`, sin segundo factor, y límites de intentos en memoria de un solo proceso. Archivos principales: `backend/app/security.py`, `backend/app/deps.py`, `backend/app/ratelimit.py`, `backend/app/routers/auth.py`, `backend/app/routers/users.py`, `backend/app/routers/logs.py`, `backend/app/models.py`.

## Requirements

### Requirement: Roles y permisos
El sistema SHALL distinguir los roles `admin` y `guard`: solo `admin` SHALL gestionar usuarios, entradas y prohibiciones, y ambos SHALL poder validar accesos y leer el historial.

#### Scenario: Guardia intenta gestionar usuarios
- **WHEN** un guardia llama a `/users`
- **THEN** el servidor responde 403

### Requirement: Contraseñas con Argon2id
El sistema SHALL guardar las contraseñas con Argon2id, SHALL exigir entre 12 y 128 caracteres, y SHALL migrar a Argon2id los hashes bcrypt heredados en el siguiente login correcto.

#### Scenario: Usuario con hash bcrypt antiguo
- **WHEN** un usuario con hash bcrypt inicia sesión con la contraseña correcta
- **THEN** entra y su hash queda reemplazado por uno Argon2id

### Requirement: Tokens de sesión verificados
El backend SHALL emitir JWT HS256 con emisor, audiencia, expiración de 480 minutos y la versión de sesión del usuario, SHALL rechazar tokens con otro algoritmo, otra clave, otra audiencia, vencidos o con versión distinta, y SHALL negarse a arrancar con un `JWT_SECRET` de menos de 32 caracteres o igual al del ejemplo.

#### Scenario: Token con `alg: none`
- **WHEN** llega un token sin firma o firmado con otra clave
- **THEN** el servidor responde 401

### Requirement: Cierre de sesiones al cambiar datos sensibles
Cambiar la contraseña, el rol o el estado de una cuenta SHALL invalidar todos sus tokens emitidos.

#### Scenario: Cambio de contraseña
- **WHEN** el admin cambia la contraseña de un guardia
- **THEN** los tokens anteriores de ese guardia reciben 401

### Requirement: Tokens que no reviven al recrear una cuenta
Cada cuenta nueva SHALL partir con una versión de sesión aleatoria, de modo que los tokens de una cuenta borrada no sirvan para otra creada con el mismo email.

#### Scenario: Email reutilizado
- **WHEN** se borra una cuenta y se crea otra con el mismo email
- **THEN** los tokens de la cuenta borrada reciben 401

### Requirement: Login sin enumeración de cuentas
El login SHALL responder igual y tardar lo mismo cuando la cuenta no existe que cuando la contraseña es incorrecta.

#### Scenario: Email inexistente
- **WHEN** alguien intenta entrar con un email que no existe
- **THEN** recibe la misma respuesta que con una contraseña incorrecta

### Requirement: Límites de intentos de login
El login SHALL limitar los intentos a 30 por minuto por IP, a 5 por minuto por cuenta desde una misma IP y a 60 por minuto por cuenta desde cualquier IP, y el limitador SHALL olvidar las claves sin intentos recientes.

#### Scenario: Bloqueo malicioso desde otra IP
- **WHEN** una IP agota los 5 intentos por minuto contra la cuenta de un guardia
- **THEN** el guardia real puede seguir entrando desde su propia IP

#### Scenario: Fuerza bruta distribuida
- **WHEN** muchas IPs suman más de 60 intentos por minuto contra una cuenta
- **THEN** los siguientes reciben 429

### Requirement: Historial sin datos personales del personal
El historial SHALL identificar a quien escaneó solo con id, nombre y rol, sin email ni RUT, y el RUT del asistente SHALL mostrarse enmascarado.

#### Scenario: Guardia lee el historial
- **WHEN** un guardia consulta `/logs`
- **THEN** no recibe el email ni el RUT de otros funcionarios

### Requirement: Ids que no se reutilizan
Las tablas de usuarios, eventos, filas y entradas SHALL usar ids que no se reutilizan al borrar, para que el historial antiguo no quede atribuido a otra persona.

#### Scenario: Entrada borrada y otra creada después
- **WHEN** se borra una entrada con historial y se crea otra
- **THEN** la nueva recibe un id distinto y el historial antiguo no cambia de titular

### Requirement: Validación de entradas sin errores internos
La API SHALL responder 4xx, nunca 500, ante RUT con dígitos que no son ASCII, valores nulos en campos obligatorios, ids fuera de rango o cuerpos de más de 1 MB.

#### Scenario: RUT con dígitos Unicode
- **WHEN** se envía `1²-K` a `/enrolar` o al crear una entrada
- **THEN** la respuesta es 4xx

#### Scenario: Null explícito en PATCH
- **WHEN** el admin envía `{"role": null}` a `PATCH /users/{id}`
- **THEN** la respuesta es 422
