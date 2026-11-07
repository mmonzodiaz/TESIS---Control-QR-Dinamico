export const REASON_LABEL: Record<string, string> = {
  ok: "Acceso concedido",
  expired: "Código expirado",
  already_used: "Código ya utilizado",
  invalid: "Código inválido",
  already_admitted: "Esta entrada ya ingresó",
  no_ticket: "Sin entrada para este evento",
  banned: "Prohibición de ingreso",
  photo_mismatch: "Rechazado: la foto no coincide",
  revoked: "Cédula revocada",
  // Solo en /qr/sync: decision sin red para una fila que ya no existe (no se pudo evaluar).
  unknown_gate: "La fila ya no existe",
};

// Clases de etiqueta (index.css): el color solo distingue si la persona pasó, no pasó o quedó algo pendiente.
export const REASON_TONE: Record<string, string> = {
  ok: "tag tag-ok",
  expired: "tag tag-bad",
  already_used: "tag tag-bad",
  invalid: "tag tag-bad",
  already_admitted: "tag tag-bad",
  no_ticket: "tag tag-bad",
  banned: "tag tag-bad",
  photo_mismatch: "tag tag-bad",
  revoked: "tag tag-bad",
  unknown_gate: "tag tag-warn",
};
