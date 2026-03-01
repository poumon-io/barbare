import potion from "@poumon/potion";

const FORUMS_REFRESH_MS = 30 * 1000;

let NAV = potion.sync("nav", {
  forums: [],
});

let forumsRefreshTimer = null;
let forumsRefreshAbort = null;

const getForums = async () => {
  const isIndex = window.location.pathname === "/";
  if (isIndex) {
    return createForums(document.querySelectorAll("#index_box a"));
  } else {
    return fetchForumsFromIndexRoute();
  }
};

const fetchForumsFromIndexRoute = async ({ signal } = {}) => {
  const res = await fetch(`/?__forums_refresh=${Date.now()}`, {
    signal,
    credentials: "same-origin",
    cache: "no-store",
  });
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  return createForums(doc.querySelectorAll("#index_box a"));
};

export const refetchForums = async () => {
  // cancel un refresh en cours si on relance
  if (forumsRefreshAbort) forumsRefreshAbort.abort();
  forumsRefreshAbort = new AbortController();

  const forums = await fetchForumsFromIndexRoute({
    signal: forumsRefreshAbort.signal,
  });

  NAV.forums = forums;
  return forums;
};

// ✅ interval singleton
export const startForumsAutoRefresh = (intervalMs = FORUMS_REFRESH_MS) => {
  if (forumsRefreshTimer) return; // déjà actif

  forumsRefreshTimer = window.setInterval(() => {
    refetchForums().catch(() => {
      console.log("erreur refech");
    });
  }, intervalMs);
};

export const stopForumsAutoRefresh = () => {
  if (forumsRefreshTimer) {
    clearInterval(forumsRefreshTimer);
    forumsRefreshTimer = null;
  }
  if (forumsRefreshAbort) {
    forumsRefreshAbort.abort();
    forumsRefreshAbort = null;
  }
};

export const forumTheme = {
  f1: { color: "blue", shade: 500 },
  f2: { color: "emerald", shade: 500 },
  f3: { color: "purple", shade: 500 },
  f4: { color: "rose", shade: 500 },
  f5: { color: "orange", shade: 500 },
  f6: { color: "yellow", shade: 500 },
  default: { color: "blue", shade: 500 },
};

function getForumTheme(forumKey) {
  return forumKey && forumTheme[forumKey]
    ? forumTheme[forumKey]
    : forumTheme.default;
}

function twText({ color, shade }) {
  return `text-${color}-${shade}`;
}

/**
 * ✅ met à jour la classe de couleur dans le SVG
 * - retire toutes les classes text-*-### existantes
 * - ajoute text-${color}-${shade}
 */
function withIconTwColor(svg, theme) {
  if (!svg) return svg;

  const textClass = twText(theme);
  let out = String(svg);

  const stripTextClasses = (cls) =>
    cls
      .split(/\s+/)
      .filter(Boolean)
      .filter((c) => !/^text-[a-z-]+-\d{2,3}$/.test(c)) // ex: text-blue-500
      .join(" ");

  if (/class="/i.test(out)) {
    out = out.replace(/class="([^"]*)"/i, (_m, cls) => {
      const cleaned = stripTextClasses(cls);
      const merged = `${cleaned} ${textClass}`.trim();
      return `class="${merged}"`;
    });
  } else {
    out = out.replace(/<svg\b/i, `<svg class="${textClass}"`);
  }

  return out;
}

export const icons = {
  f1: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-lucide="hash" aria-hidden="true" class="lucide lucide-hash w-4 h-4 text-blue-500 mr-2"><line x1="4" x2="20" y1="9" y2="9"></line><line x1="4" x2="20" y1="15" y2="15"></line><line x1="10" x2="8" y1="3" y2="21"></line><line x1="16" x2="14" y1="3" y2="21"></line></svg>`,
  f2: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-lucide="help-circle" aria-hidden="true" class="lucide lucide-help-circle w-4 h-4 text-emerald-500 mr-2"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><path d="M12 17h.01"></path></svg>`,
  f3: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-lucide="code" aria-hidden="true" class="lucide lucide-code w-4 h-4 text-purple-500 mr-2"><path d="m16 18 6-6-6-6"></path><path d="m8 6-6 6 6 6"></path></svg>`,
  f4: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-lucide="palette" aria-hidden="true" class="lucide lucide-palette w-4 h-4 text-rose-500 mr-2"><path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"></path><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"></circle><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"></circle><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"></circle><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"></circle></svg>`,
  f5: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-lucide="folder-kanban" aria-hidden="true" class="lucide lucide-folder-kanban w-4 h-4 mr-2 text-orange-500"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"></path><path d="M8 10v4"></path><path d="M12 10v2"></path><path d="M16 10v6"></path></svg>`,
  f6: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-lucide="coffee" aria-hidden="true" class="lucide lucide-coffee w-4 h-4 text-yellow-500 mr-2"><path d="M10 2v2"></path><path d="M14 2v2"></path><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"></path><path d="M6 2v2"></path></svg>`,
  default: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-lucide="hash" aria-hidden="true" class="lucide lucide-hash w-4 h-4 text-blue-500 mr-2"><line x1="4" x2="20" y1="9" y2="9"></line><line x1="4" x2="20" y1="15" y2="15"></line><line x1="10" x2="8" y1="3" y2="21"></line><line x1="16" x2="14" y1="3" y2="21"></line></svg>`,
};

function stripHtml(html) {
  if (!html) return "";
  // DOMParser est idéal pour enlever les tags ET décoder les entités (&amp;, etc.)
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(String(html), "text/html");
    return (doc.body.textContent || "").trim();
  }
  // fallback (si jamais)
  return String(html)
    .replace(/<[^>]*>/g, "")
    .trim();
}

function getForumKeyFromUrl(url) {
  if (!url) return null;

  // Ex: /f12-..., /f12, /f12/
  const m1 = String(url).match(/\/f(\d+)(?=\/|[-?#]|$)/i);
  if (m1) return `f${m1[1]}`;

  // Ex: ?f=12 (ou &f=12)
  const m2 = String(url).match(/[?&]f=(\d+)\b/i);
  if (m2) return `f${m2[1]}`;

  return null;
}

const createForums = (links) => {
  const arr = Array.from(links || []);
  return arr.map((link) => {
    const url = link?.href || "";
    const forumKey = getForumKeyFromUrl(url);
    const noNew = link?.dataset?.new;

    const theme = getForumTheme(forumKey);

    const baseIcon =
      forumKey && icons[forumKey] ? icons[forumKey] : icons.default;
    const icon = withIconTwColor(baseIcon, theme); // ✅ icon HTML avec text-${color}-${shade}

    const topics = Number.parseInt(link?.dataset?.topics, 10);
    const safeTopics = Number.isFinite(topics) ? topics : 0;

    return {
      name: (link?.textContent || "").trim(),
      url,
      forumKey,
      icon,
      description: stripHtml(link?.dataset?.description ?? ""),
      topics: safeTopics,
      read: noNew === "read.png" ? "hidden" : "flex",

      // ✅ pour ton UI (tu peux faire text-${color}-500)
      color: theme.color, // ex: "blue"
      shade: theme.shade, // ex: 500
      textClass: twText(theme), // ex: "text-blue-500"
    };
  });
};

export const initSidebar = async () => {
  // est-ce qu'on est sur l'index ?
  // selon l'adresse de la page
  await refetchForums();
  startForumsAutoRefresh();
};

export const initMobileSidebar = () => {
  const root = document.getElementById("app-root");
  const sidebar = document.getElementById("sidebar");
  const btn = document.getElementById("menu-toggle");
  if (!root || !sidebar || !btn) return;

  // Overlay (créé si absent)
  let overlay = document.getElementById("sidebar-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "sidebar-overlay";
    overlay.setAttribute("aria-hidden", "true");
    document.body.appendChild(overlay);
  }

  let open = false;

  function isDrawerMode() {
    // Si le bouton est visible => on est < xl => drawer actif
    return getComputedStyle(btn).display !== "none";
  }

  function lockScroll(on) {
    document.documentElement.classList.toggle("drawer-lock", on);
    document.body.classList.toggle("drawer-lock", on);
  }

  function setOpen(next) {
    // En desktop (>= xl), on force toujours fermé (sidebar normale)
    if (!isDrawerMode()) next = false;

    open = next;

    root.classList.toggle("drawer-open", open);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    sidebar.setAttribute(
      "aria-hidden",
      open ? "false" : isDrawerMode() ? "true" : "false",
    );

    overlay.setAttribute("aria-hidden", open ? "false" : "true");
    lockScroll(open);
  }

  // Toggle
  btn.addEventListener("click", () => setOpen(!open));

  // Close interactions
  overlay.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });
  sidebar.addEventListener("click", (e) => {
    if (e.target.closest("a")) setOpen(false);
  });

  // Sync sur resize (quand on passe <xl / >=xl)
  window.addEventListener("resize", () => setOpen(false));

  // Init (si on charge en desktop, aria-hidden doit être false)
  setOpen(false);
};
