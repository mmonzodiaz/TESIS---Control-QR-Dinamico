# Resultados del experimento de ataque (generado)

Generado por `backend/scripts/attack_experiment.py`. No editar a mano. Metodo en `docs/attack-experiment.md`.

TTL del QR dinamico: 45 s. Ambos modos tienen admision unica por entrada.
QR dinamico en dos pasos (ADR-12) con un guardia que compara bien la foto: si no coincide, rechaza sin
consumir la entrada del titular. Carnet: "foto no coincide" indica que una comparacion correcta lo detendria.

| Escenario | QR estatico (carnet) | QR dinamico | Titular despues: estatico | Titular despues: dinamico |
|---|---|---|---|---|
| Control: el titular legitimo ingresa | Acepta (`ok`) | Acepta (`ok`) | — | — |
| Foto del QR usada 60 s despues | **ATAQUE PASA** (`ok`) | Bloqueado (`expired`) | RECHAZA (`already_admitted`) | Acepta (`ok`) |
| Foto del QR usada 1 hora despues | **ATAQUE PASA** (`ok`) | Bloqueado (`expired`) | RECHAZA (`already_admitted`) | Acepta (`ok`) |
| Copia usada en otro evento, 30 dias despues | **ATAQUE PASA** (`ok`) | Bloqueado (`expired`) | RECHAZA (`already_admitted`) | Acepta (`ok`) |
| Reenvio en tiempo real (4.5 s) | **ATAQUE PASA** (`ok`) | Pasa el sistema; **el guardia lo rechaza: foto no coincide** (`photo_mismatch`) | RECHAZA (`already_admitted`) | Acepta (`ok`) |
| Copia usada despues de que el titular ingreso | Bloqueado (`already_admitted`) | Bloqueado (`already_used`) | — | — |

**Ataques que pasan la validacion automatica:** QR estatico 4 de 5; QR dinamico 1 de 5.

**Ataques que pasan ademas una comparacion correcta de la foto:** QR estatico 4 de 5; QR dinamico 0 de 5.

Titular legitimo aceptado: estatico si, dinamico si.

## Filtro de personas con prohibicion de ingreso

| Escenario | QR estatico (carnet) | QR dinamico |
|---|---|---|
| Control: persona con prohibicion usa su propia credencial | RECHAZA (`banned`) | RECHAZA (`banned`) |
| Persona con prohibicion usa la copia del QR de un tercero | **ATAQUE PASA** (`ok`) | Bloqueado (`expired`) |
| Persona con prohibicion usa la credencial prestada por un tercero | Pasa el sistema (`ok`); **foto no coincide** | Pasa el sistema; **el guardia lo rechaza: foto no coincide** (`photo_mismatch`) |

**Evasiones del filtro (validacion automatica):** QR estatico 2 de 2; QR dinamico 1 de 2.

**Evasiones con comparacion correcta de la foto:** QR estatico 1 de 2; QR dinamico 0 de 2.

Con su propia credencial, la persona sancionada es bloqueada en ambos modos: si.

Escenarios:

- **Control: el titular legitimo ingresa**: Sin ataque. Verifica que ningun modo rechace al titular.
- **Foto del QR usada 60 s despues**: El atacante fotografia el QR del titular y lo presenta 60 s despues, antes de que el titular llegue a la puerta.
- **Foto del QR usada 1 hora despues**: Idem, 1 hora despues (misma jornada).
- **Copia usada en otro evento, 30 dias despues**: La copia capturada se presenta en otro evento al que el titular tambien tiene entrada.
- **Reenvio en tiempo real (4.5 s)**: El QR se reenvia a un complice que escanea en la puerta antes que el titular, dentro de la ventana de validez.
- **Copia usada despues de que el titular ingreso**: El titular entra primero; luego el atacante presenta la copia.
- **Control: persona con prohibicion usa su propia credencial**: La persona sancionada tiene entrada y presenta su propio carnet / QR. Verifica que el filtro funcione.
- **Persona con prohibicion usa la copia del QR de un tercero**: Presenta la copia del QR de alguien sin prohibicion (capturada 10 min antes, sin que el tercero coopere).
- **Persona con prohibicion usa la credencial prestada por un tercero**: Un tercero sin prohibicion coopera: presta su carnet (estatico) o le reenvia su QR en tiempo real, 4.5 s (dinamico).
