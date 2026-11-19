# Aquí van las grabaciones de voz del video

Cada archivo de esta carpeta reemplaza a la voz sintética de Windows en un tramo del video de
demostración. El nombre del archivo es el nombre del tramo; la extensión da lo mismo mientras ffmpeg
sepa leerla (`.m4a` de la grabadora de Windows, `.wav`, `.mp3`, `.ogg`).

Son siete tramos:

| Archivo | Qué es | Dura más o menos |
|---|---|---|
| `caratula-intro` | La portada | 15 s |
| `clip-cedula` | La persona obtiene su cédula | 15 s |
| `clip-qr` | El código que se renueva | 15 s |
| `clip-ingreso` | Un ingreso válido | 17 s |
| `clip-vencido` | El pantallazo que ya no sirve | 10 s |
| `clip-nocoincide` | El código de otra persona | 12 s |
| `caratula-cierre` | El cierre comparativo | 20 s |

## Cómo grabarlas

1. `cd e2e && npm run video -- --guion` imprime qué decir en cada tramo.
2. Abre el recorte del tramo en `video-salida/apuntador/` (o en `video-respaldo/apuntador/`, que es la
   copia estable). Es el video **sin audio**, con el texto arriba y las palabras encendiéndose al ritmo
   al que conviene leer.
3. Graba mientras lo miras, con la grabadora de voz de Windows o lo que prefieras, y guarda el archivo
   aquí con el nombre del tramo.
4. Cuando tengas los que quieras —no hace falta grabarlos todos, los que falten siguen con la voz de
   Windows— corre `npm run video -- --montar`. Rearma el video en un minuto, sin volver a grabar la
   aplicación, y estira o acorta cada escena para que calce con tu voz.

Usa audífonos o silencia los parlantes: el apuntador no tiene audio, pero si tienes el video narrado
sonando en otra ventana se te cuela en la grabación.

## Estos archivos no se versionan

El `.gitignore` deja fuera todo lo de esta carpeta menos este LÉEME, porque son grabaciones de la voz
del autor y el repositorio es público. Si cambias de computador, cópialas a mano.
