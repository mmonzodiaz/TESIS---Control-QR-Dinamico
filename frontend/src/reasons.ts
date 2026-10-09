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

export const REASON_TONE: Record<string, string> = {
  ok: "bg-[#e5f7f1] text-[#0e806c]",
  expired: "bg-[#fff3d9] text-[#a26a11]",
  already_used: "bg-[#fce8ed] text-[#b74961]",
  invalid: "bg-[#fdeceb] text-[#c6505b]",
  already_admitted: "bg-[#fce8ed] text-[#b74961]",
  no_ticket: "bg-[#fdeceb] text-[#c6505b]",
  banned: "bg-[#fdeceb] text-[#c6505b]",
  photo_mismatch: "bg-[#fdeceb] text-[#c6505b]",
  revoked: "bg-[#fdeceb] text-[#c6505b]",
  unknown_gate: "bg-[#fff3d9] text-[#a26a11]",
};
