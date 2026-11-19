# Narración del video explicativo (video.cjs): convierte cada texto en un WAV con la voz en español
# instalada en Windows. Uso: powershell -File narrar.ps1 -Json narracion.json -Dir voz
param([Parameter(Mandatory = $true)][string]$Json, [Parameter(Mandatory = $true)][string]$Dir)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$textos = Get-Content -Raw -Encoding UTF8 $Json | ConvertFrom-Json
$voz = New-Object System.Speech.Synthesis.SpeechSynthesizer
$espanol = $voz.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'es*' } | Select-Object -First 1
if (-not $espanol) { throw "No hay una voz en espanol instalada (Configuracion > Hora e idioma > Voz)." }
$voz.SelectVoice($espanol.VoiceInfo.Name)
$voz.Rate = 1   # un poco mas rapido que el valor de fabrica, que suena muy lento
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
foreach ($p in $textos.PSObject.Properties) {
  $salida = Join-Path $Dir "$($p.Name).wav"
  $voz.SetOutputToWaveFile($salida)
  $voz.Speak($p.Value)
}
$voz.SetOutputToDefaultAudioDevice()
Write-Output "Voz: $($espanol.VoiceInfo.Name) ($($textos.PSObject.Properties.Name.Count) pistas)"
