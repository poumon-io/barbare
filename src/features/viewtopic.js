import { icons, forumTheme } from "../core/sidebar.js";

export const addIconToCategory = (root = document) => {
  const category = root.querySelector("#topic-category");
  const nav = category.querySelector(".nav");
  nav.classList.add("flex");
  // parse id from url of nav /f[id]-
  const m = nav?.href?.match(/\/f(\d+)-/);
  if (m) {
    const id = m[1];
    const icon = icons["f" + id];
    // add icon as html tprepend
    if (icon) nav.insertAdjacentHTML("afterbegin", icon);
    category.classList.add(
      `bg-${forumTheme["f" + id].color}-100`,
      `text-${forumTheme["f" + id].color}-600`,
      `dark:bg-${forumTheme["f" + id].color}-950`,
      `dark:text-${forumTheme["f" + id].color}-200`,
    );
  }
};

export function markInternalLinks(root = document, className = "is-internal") {
  const origin = location.origin;

  root.querySelectorAll(".postbody a[href]").forEach((a) => {
    const href = a.getAttribute("href")?.trim();
    if (!href) return;

    // ignore ancres / pseudo-protocoles
    if (
      href.startsWith("#") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      href.startsWith("javascript:")
    )
      return;

    let url;
    try {
      url = new URL(href, location.href);
    } catch {
      return;
    }

    // seulement les liens internes
    if (url.origin !== origin) return;

    // optionnel: garder l’ancien texte
    if (!a.dataset.originalText) a.dataset.originalText = a.textContent ?? "";

    a.classList.add(className, "bg-zinc-100");

    // pathname uniquement (decode safe)
    let path = url.pathname || "/";
    try {
      path = decodeURIComponent(path);
    } catch {}

    // ⚠️ Remplace TOUT le texte (et supprimera les icônes si elles sont dans <a>)
    a.textContent = path;
  });
}
