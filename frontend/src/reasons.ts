export const REASON_LABEL: Record<string, string> = {
  ok: "Acceso concedido",
  expired: "Codigo expirado",
  already_used: "Codigo ya utilizado",
  invalid: "Codigo invalido",
  already_admitted: "Esta entrada ya ingreso",
  wrong_event: "Entrada de otro evento",
};

export const REASON_TONE: Record<string, string> = {
  ok: "bg-[#e5f7f1] text-[#0e806c]",
  expired: "bg-[#fff3d9] text-[#a26a11]",
  already_used: "bg-[#fce8ed] text-[#b74961]",
  invalid: "bg-[#fdeceb] text-[#c6505b]",
  already_admitted: "bg-[#fce8ed] text-[#b74961]",
  wrong_event: "bg-[#fdeceb] text-[#c6505b]",
};
