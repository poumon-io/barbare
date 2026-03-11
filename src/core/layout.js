export function initLayout() {
  const root = document.getElementById("app-root");
  const group = document.getElementById("view-mode-group");
  if (!root || !group) return;

  const buttons = Array.from(group.querySelectorAll("button[data-view]"));
  const VALID = new Set(["split", "forum", "chat"]);

  const ACTIVE = "bg-white shadow-sm dark:bg-zinc-700";
  const INACTIVE =
    "bg-transparent cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-700";

  function setActiveButton(mode) {
    buttons.forEach((btn) => {
      const isActive = btn.dataset.view === mode;
      btn.classList.remove(...ACTIVE.split(" "), ...INACTIVE.split(" "));
      btn.classList.add(...(isActive ? ACTIVE : INACTIVE).split(" "));
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }

  function setViewMode(mode, { persist = true } = {}) {
    if (!VALID.has(mode)) mode = "split";

    root.classList.remove("view-split", "view-forum", "view-chat");
    root.classList.add(`view-${mode}`);

    setActiveButton(mode);

    if (persist) localStorage.setItem("viewMode", mode);
  }

  // Click handler (délégué)
  group.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-view]");
    if (!btn) return;
    setViewMode(btn.dataset.view);
  });

  // Init
  const saved = localStorage.getItem("viewMode");
  setViewMode(VALID.has(saved) ? saved : "split", { persist: false });
}

export const initResize = () => {
  const root = document.getElementById("app-root");
  const content = document.getElementById("content");
  const chat = document.getElementById("chat");
  const forum = content?.querySelector('div[data-barba="wrapper"]');
  if (!root || !content || !chat || !forum) return;

  // Crée le handle si absent
  let handle = document.getElementById("panel-resizer");
  if (!handle) {
    handle = document.createElement("div");
    handle.classList.add(
      "bg-zinc-200",
      "dark:bg-zinc-800",
      "hover:before:bg-black/5",
      "dark:hover:before:bg-white/10",
    );
    handle.id = "panel-resizer";
    handle.setAttribute("aria-hidden", "true");
    // insérer entre forum et chat
    content.insertBefore(handle, chat);
  }

  const LS_KEY = "split_chat_width_px";
  const MIN_CHAT = 280;
  const MIN_FORUM = 360;

  function isSplitActive() {
    // Actif seulement si chat visible ET mode split
    if (!root.classList.contains("view-split")) return false;
    return getComputedStyle(chat).display !== "none";
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function setChatWidth(px) {
    content.style.setProperty("--chat-w", px + "px");
  }

  // Init depuis localStorage
  const saved = Number(localStorage.getItem(LS_KEY));
  if (Number.isFinite(saved) && saved > 0) setChatWidth(saved);

  // Double click = reset (optionnel)
  handle.addEventListener("dblclick", () => {
    setChatWidth(MIN_CHAT);
  });

  let dragging = false;

  handle.addEventListener("pointerdown", (e) => {
    if (!isSplitActive()) return;

    dragging = true;
    handle.setPointerCapture(e.pointerId);
    document.documentElement.classList.add("is-resizing");

    // Empêche sélection texte
    e.preventDefault();
  });

  window.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    if (!isSplitActive()) return;

    const rect = content.getBoundingClientRect();
    const x = e.clientX - rect.left; // position dans #content

    // largeur chat = distance du bord droit
    const rawChatW = rect.width - x;

    // bornes : chat min + forum min
    const maxChat = Math.max(MIN_CHAT, rect.width - MIN_FORUM - 10);
    const chatW = clamp(rawChatW, MIN_CHAT, maxChat);

    setChatWidth(Math.round(chatW));
  });

  function stopDrag() {
    if (!dragging) return;
    dragging = false;
    document.documentElement.classList.remove("is-resizing");

    // Sauvegarde
    const current = parseFloat(getComputedStyle(chat).width);
    if (Number.isFinite(current) && current > 0) {
      localStorage.setItem(LS_KEY, String(Math.round(current)));
    }
  }

  window.addEventListener("pointerup", stopDrag);
  window.addEventListener("pointercancel", stopDrag);

  // Si on quitte le mode split / resize fenêtre: on garde la valeur,
  // mais on évite les glitches pendant un drag.
  window.addEventListener("resize", () => stopDrag());
};
