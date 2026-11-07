# Interfaz orientada a los arquetipos

## Purpose

Cómo la app de la cédula recoge las recomendaciones de los arquetipos del Anexo A de la tesis (`tab:arquetipos-anexo` y `tab:trazabilidad-anexo`). Archivos principales: `frontend/src/pages/CedulaPage.tsx`, `frontend/src/pages/CedulaView.tsx`, `backend/app/routers/events.py`.

## Requirements

### Requirement: Información antes de activar
La app SHALL ofrecer los paneles informativos antes de activar la cédula y también después, y el panel «Qué es esto y para qué sirve» SHALL mostrarse expandido solo la primera vez en cada navegador.

#### Scenario: Segunda visita sin haber cerrado el panel
- **WHEN** la persona vuelve después de haberlo visto expandido, aunque no lo haya cerrado
- **THEN** el panel aparece plegado y se puede abrir

### Requirement: Mensajería comparativa
La app SHALL explicar en un panel «¿En qué se diferencia de una clave o contraseña?» que el QR acredita la identidad en persona y no reemplaza a la clave.

#### Scenario: Persona escéptica abre el panel
- **WHEN** abre el panel
- **THEN** ve la diferencia con la ClaveÚnica

### Requirement: Errores junto al campo y reintento
Los errores de activación y de reporte de pérdida SHALL mostrarse junto al campo que falló, y la pantalla SHALL conservar lo ingresado para reintentar. Un fallo de red SHALL explicarse en español.

#### Scenario: Clave de activación rechazada
- **WHEN** el Registro Civil rechaza la clave
- **THEN** el mensaje aparece bajo ese campo, el RUN y la clave siguen escritos y se puede reintentar

### Requirement: Dónde se acepta
La app SHALL mostrar, a pedido de la persona, los eventos vigentes con fila de cédula digital. La consulta SHALL NOT enviar datos de la persona, y su fallo SHALL NOT afectar el uso de la cédula.

#### Scenario: Persona abre el panel
- **WHEN** toca «Dónde puedes usarla»
- **THEN** la app consulta `GET /events/public`, que entrega solo nombre y fecha

#### Scenario: Evento sin fila digital o ya pasado
- **WHEN** un evento no tiene fila de cédula digital o terminó hace más de un día
- **THEN** no aparece en la lista
