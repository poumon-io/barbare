/**
 * Déplace #footer à l'intérieur du container Barba actif.
 * Compatible avec registerModule : mount(container) reçoit
 * directement l'élément section, pas un root à parcourir.
 *
 * @param {Element} [container=document] - le container Barba courant,
 *   ou document pour le chargement initial (cherche alors la section lui-même).
 */
export const initFooter = (container = document) => {
  const footer = document.querySelector("#footer");
  const linksContainer = document.querySelector("#footer-links");
  const links = document.querySelectorAll("#page-footer > a");

  const target =
    container === document
      ? document.querySelector('section[data-barba="container"]')
      : container;

  if (footer && target) {
    target.appendChild(footer);
    links.forEach((link) => {
      linksContainer.appendChild(link);
    });
    footer.classList.remove("hidden");
  }
};
