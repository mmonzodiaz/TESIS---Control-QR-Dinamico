# Borradores para la tesis

`sec-prototipo.tex` es un borrador de la sección del prototipo (`sec:prototipo`) y de su evaluación, escrito a partir de `docs/` siguiendo `docs/guia-tesis.md`. No se compiló (no hay LaTeX en este equipo).

1. Copiar las tres `\section` a sus capítulos: `sec:prototipo` a Metodología, `sec:prototipo-evaluacion` a Resultados y `sec:prototipo-limitaciones` a Discusión o Conclusiones (ver el encabezado del archivo).
2. Agregar al preámbulo `booktabs`, `tikz` (con `arrows.meta` y `positioning`) y `url` o `hyperref`, si no están.
3. Reemplazar las macros `\TARqr`, `\TARplantilla` y `\UmbralBio` con las cifras de `docs/results/biometric-degradation.md` cuando termine la nueva medición, y actualizar `\TestsBackend` y `\TestsFrontend`.
4. Resolver cada `\cite{PENDIENTE-...}`: la lista está al final del archivo. Después, pasar todas las citas por `verificador-citas`.
5. Revisar los `% TODO`: el repositorio público, la declaración de la herramienta de revisión de código y el tope de antigüedad del sello.
