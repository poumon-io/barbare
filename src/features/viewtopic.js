import { icons, forumTheme } from "../core/sidebar.js";
import { initPrism } from "../features/prism.js";

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
      href.startsWith("javascript:") ||
      href.startsWith("/tags/")
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

    a.classList.add(className, "bg-zinc-100", "dark:bg-zinc-900");

    // pathname uniquement (decode safe)
    let path = url.pathname || "/";
    try {
      path = decodeURIComponent(path);
    } catch {}

    // ⚠️ Remplace TOUT le texte (et supprimera les icônes si elles sont dans <a>)
    a.textContent = path;
  });
}

export const addColorToPost = (root = document) => {
  const post = root.querySelector(".postbody");
  if (!post) return;
  // based on category
  const category = root.querySelector("#topic-category .nav");
  const m = category?.href?.match(/\/f(\d+)-/);
  let color = "gray";
  if (m) {
    const id = m[1];
    color = forumTheme["f" + id]?.color || color;
  }

  root.body.style.setProperty("--author-color", `var(--color-${color}-500)`);
};

const RESOLU_TEST_RE =
  /(^|[\s\-–—:;,.|])[\[\(]?\s*r[eéèêë]solu\s*[\]\)]?(?=$|[\s\-–—:;,.|])/i;

const RESOLU_STRIP_RE =
  /(^|[\s\-–—:;,.|])[\[\(]?\s*r[eéèêë]solu\s*[\]\)]?(?=$|[\s\-–—:;,.|])/gi;

const stripResolvedToken = (raw) => {
  const hadResolved = RESOLU_TEST_RE.test(raw || "");
  if (!hadResolved) return { cleaned: raw || "", hadResolved: false };

  let cleaned = (raw || "").replace(RESOLU_STRIP_RE, "$1");

  cleaned = cleaned
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-–—:;,.|]+/g, "")
    .replace(/[\s\-–—:;,.|]+$/g, "")
    .trim();

  return { cleaned, hadResolved: true };
};

const ensureResolvedBadge = (titleEl) => {
  // déjà présent ?
  let badge = titleEl.querySelector('label[data-resolved-badge="1"]');
  if (badge) return badge;

  badge = document.createElement("label");
  badge.setAttribute("data-resolved-badge", "1");
  badge.setAttribute("aria-label", "Sujet résolu");
  badge.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 lucide lucide-circle-check-big-icon lucide-circle-check-big"><path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/></svg><span>Résolu</span>`;

  // style “badge” (Tailwind)
  badge.className =
    "flex gap-2 px-2 py-1 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-200";

  return badge;
};

const removeResolvedBadge = (titleEl) => {
  const badge = titleEl.querySelector('label[data-resolved-badge="1"]');
  if (badge) badge.remove();
};

export const extractTagfromTitle = (root = document) => {
  const titleEl = root.querySelector("#topic-title");
  const container = root.querySelector("#tags-container");
  if (!titleEl | !container) return;

  // souvent le texte est dans un <a>, sinon directement dans #topic-title
  const host = titleEl.querySelector("a") || titleEl;

  const before = (host.textContent || "").trim();
  if (!before) return;

  const { cleaned, hadResolved } = stripResolvedToken(before);

  if (!hadResolved) {
    // optionnel: si pas résolu, on enlève un badge existant
    removeResolvedBadge(titleEl);
    return;
  }

  // 1) retirer le token du titre
  if (cleaned !== before) host.textContent = cleaned;

  // 2) insérer le badge juste avant le host (donc “à la place” du token en début)
  const badge = ensureResolvedBadge(titleEl);

  // si badge déjà dans le bon parent, rien à faire
  if (!badge.isConnected) {
    // insère badge + espace avant le texte
    container.appendChild(badge);
  }
};

export const initViewtopic = (root = document) => {
  addIconToCategory();
  addColorToPost();
  markInternalLinks();
  extractTagfromTitle();
  initPrism(root);
};
