import { useEffect } from "react";

const APP = "Control de acceso";

/** Título de la pestaña según la pantalla (WCAG 2.4.2). Sin `app`, el título va solo: así se llama la app de la cédula. */
export function useDocumentTitle(title: string, app: string | null = APP) {
  useEffect(() => {
    document.title = app ? `${title} | ${app}` : title;
  }, [title, app]);
}
