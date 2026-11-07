# Especificación para verificadores de terceros

Lo que un tercero necesita para verificar la cédula digital **simulada** de este prototipo sin usar
su código. Es la especificación concreta a la que se refieren la pregunta 6 y la cuarta recomendación
de la tesis. Describe el emisor simulado de este repositorio: **no describe el sistema del Registro
Civil real**, cuyo formato no es público.

`backend/tests/test_verifier_spec.py` implementa un verificador solo con este documento, la biblioteca
estándar de Python y `cryptography`, sin importar `app.credential`, y lo prueba contra los vectores y
contra lo que publica el emisor. Si el formato cambia sin actualizar este documento, ese test falla.

## 1. Qué tiene que entregar el emisor

| Elemento | Cómo se obtiene | ¿Es público? |
|---|---|---|
| Clave pública del emisor (Ed25519) | `GET /clave-publica`, campo `issuer_public_key` | Sí |
| Lista de cédulas revocadas, firmada | `GET /revocaciones` (§4) | Sí; solo tiene hashes |
| Formato de la credencial y del QR | Este documento | Sí |
| Clave **privada** de lectores autorizados (X25519) | La entrega el emisor a cada verificador que autoriza | **No** |

El cuarto elemento no se publica, y sin él no se puede verificar: el QR va cifrado para que quien lo
fotografíe en la fila no vea la identidad ni la foto. Por eso un verificador de terceros necesita,
además de lo publicado, **que el emisor lo autorice**. `GET /clave-publica` entrega también la parte
pública de esa clave (`verifier_public_key`), con la que el teléfono cifra el QR.

Limitación declarada: todos los lectores comparten una sola clave. Si se compromete un lector, esa
clave permite leer los QR de cualquier persona (no falsificarlos) hasta que se reemplace. Un sistema
real necesitaría un registro de verificadores con claves individuales y revocables.

## 2. Notación

Enteros sin signo en *big-endian*: `u8`, `u16`, `u32`, `u64`. `||` es concatenación. Firmas Ed25519
(RFC 8032) de 64 bytes. Base45 según RFC 9285. Base64 estándar, con relleno.

## 3. Credencial y QR

### 3.1 Núcleo de la cédula (`core`)

```
u8  versión = 2
u32 fecha de emisión (unix)
u8  largo del RUT   || RUT en ASCII, normalizado (12345678K)
u8  largo del nombre || nombre en UTF-8
32 bytes  SHA-256 de la foto
32 bytes  clave pública Ed25519 del teléfono
```

No puede sobrar ni faltar ningún byte. La **firma del emisor** es
`Ed25519(emisor, "CA-ID-v2" || core)`.

El identificador de una emisión es `credential_id = hex(SHA-256(core))`. Cambia cada vez que la
persona activa la cédula en otro teléfono.

### 3.2 Sobre del QR

```
"CA2:" || base45( clave efímera X25519 (32 bytes) || texto cifrado con su etiqueta )
```

Para descifrar:

1. `compartido = X25519(clave privada de lectores, clave efímera)`.
2. `clave = HKDF-SHA256(compartido, sin sal, info = "CA-QR-v2 enc" || clave efímera || clave pública de lectores, largo 32)`.
3. `texto plano = ChaCha20-Poly1305(clave, nonce = 12 bytes en cero, datos asociados = "CA2")`.
   El nonce fijo es seguro porque cada QR usa una clave efímera nueva.

### 3.3 Texto plano

```
16 bytes  nonce del QR (uso único)
u32       hora de emisión del QR (unix)
64 bytes  firma del dispositivo
u16       largo del core || core
64 bytes  firma del emisor
resto     foto (WebP)
```

La **firma del dispositivo** es
`Ed25519(teléfono, "CA-QR-v2" || SHA-256(core) || nonce || u32 hora del QR)`.

## 4. Lista de revocadas

`GET /revocaciones` devuelve:

```json
{ "issued_at": 1790000000, "revoked": ["<credential_id en hex>", "..."], "sig": "<base64>" }
```

`revoked` va ordenada y sin repetidos. La firma es
`Ed25519(emisor, "CA-REV-v1" || u64 issued_at || u32 cantidad || cada id como 32 bytes)`.

Cualquiera puede redistribuirla, porque sin la clave del emisor no se puede alterar. El verificador
debe ignorar una lista con firma inválida y nunca retroceder a una con `issued_at` anterior. La lista
no tiene datos personales: sin la cédula no se sabe de quién es cada hash.

## 5. Algoritmo de verificación

Los pasos 1 a 6 funcionan sin conexión. Si uno falla, el QR se rechaza.

1. Descifrar (§3.2). Si falla: QR alterado o lector no autorizado.
2. Separar los campos (§3.3).
3. Verificar la firma del emisor sobre `core`, **antes de leerlo**.
4. Leer `core` (§3.1) y verificar la firma del dispositivo con la clave del teléfono que viene dentro.
5. Comprobar que el SHA-256 de la foto coincide con el de `core`.
6. Comprobar la vigencia con `t = hora del QR`, usando `qr_ttl_seconds` (45) y
   `qr_clock_skew_seconds` (5) de `GET /clave-publica`:
   - `t > ahora + tolerancia`: inválido, porque fechar el QR en el futuro alargaría su vigencia;
   - `ahora - t > vigencia + tolerancia`: vencido.
7. Comprobar que `credential_id` no está en la lista de revocadas (§4).
8. Mostrar a la persona que verifica la **foto, el nombre y el RUT obtenidos del QR**, y no lo que
   exhiba el teléfono del titular.

## 6. Lo que no decide el emisor

Estas reglas son de quien verifica, y el formato no las resuelve por sí solo:

- **Uso único:** guardar cada `nonce` aceptado y rechazar los repetidos, de forma atómica si hay
  varias puertas. Sin esto, un QR vigente sirve varias veces dentro de su ventana.
- **Reglas de negocio:** en este prototipo, entrada por RUT, anti *pass-back* y prohibiciones de
  ingreso (`backend/app/routers/qr.py`).
- **Comparación de la foto con la persona:** el QR prueba que la cédula es auténtica, no que quien lo
  muestra sea su titular. Un QR reenviado en tiempo real pasa los pasos 1 a 7.

## 7. Vectores de prueba

`backend/tests/vectors/qr-v2.json` trae claves, cédula, foto, QR y los casos de base45. Son los mismos
que usan el backend y el frontend. Son solo de prueba.
