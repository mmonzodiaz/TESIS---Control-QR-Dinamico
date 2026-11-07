"""Video MJPEG para la camara simulada de Chromium (--use-file-for-fake-video-capture).

    uv run python ../e2e/camara_mjpeg.py <salida.mjpeg> [captura-del-qr.png]

Con una captura, la pone algo girada y desenfocada, como la veria una camara frente a un telefono. Sin
captura, la imagen es negra (camara tapada): sirve para las pantallas que no deben leer nada.
"""

import io
import sys

from PIL import Image, ImageFilter

target = sys.argv[1]
frame = Image.new("RGB", (1920, 1080), (235, 235, 235) if len(sys.argv) > 2 else (0, 0, 0))
if len(sys.argv) > 2:
    screen = Image.open(sys.argv[2]).convert("RGB")
    qr = screen.resize((round(screen.width * 1040 / screen.height), 1040), Image.LANCZOS)
    qr = qr.rotate(3, expand=True, fillcolor=(235, 235, 235))
    qr.thumbnail((1900, 1070))
    frame.paste(qr, ((1920 - qr.width) // 2, (1080 - qr.height) // 2))
    frame = frame.filter(ImageFilter.GaussianBlur(0.8))
buffer = io.BytesIO()
frame.save(buffer, "JPEG", quality=85)
with open(target, "wb") as file:
    for _ in range(30):
        file.write(buffer.getvalue())
