// init/barba.js
import Context from "./context.js";
import barba from "@barba/core";
import { updateTyme } from "../lib/tyme.js";

/**
 * Pager Barba "stack + panel" (vertical)
 * - Overlay strip at top (48px) when panels are open
 * - Forward:
 *   - promote current panel to background (moves up to top=0)
 *   - next panel enters from bottom (50px) + fade-in
 * - Back:
 *   - current panel fades/slides down (50px) and disappears
 *   - incoming panel (if not base) drops to overlay inset (top=48px)
 */

const modules = [];
let activeCleanups = [];

function mountModules(container) {
  activeCleanups = modules.map((m) => m.mount?.(container)).filter(Boolean);
}

function unmountModules() {
  activeCleanups.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
  activeCleanups = [];
}

const CFG = {
  CONTAINER_SEL: '[data-barba="container"]',
  WRAPPER_SEL: '[data-barba="wrapper"]',
  STAGE_ID: "barba-pager-stage",
  OVERLAY_ID: "barba-pager-overlay-fallback",

  // Optional legacy selectors (no-op if absent)
  MENU_SEL: "ul#navigation",
  OVERLAY_SEL: "div#overlay",

  // Visuals
  STACK_PX: 48, // overlay strip height and panel top inset when in panel mode
  PANEL_Z: 301,
  STAGE_Z: 280,
  OVERLAY_Z: 290,

  // Motion
  ENTER_MS: 420,
  BACK_CLOSE_MS: 420,
  EASING: "cubic-bezier(.22,.8,.2,1)",

  // Micro motion
  SLIDE_PX: 50,
};

let _initialized = false;
const _nsHooks = new Map();

const Pager = {
  stage: null,
  overlayEl: null,
  overlayIsFallback: false,

  // Cached visible stack under active panel (old p3 pages)
  layers: [], // [{ url, el, order }]

  // Detached snapshots kept for browser forward reconstruction
  detachedByUrl: new Map(),

  // Snapshot of current page used for back close animation
  outgoingBackSnap: null,
  outgoingBackAnim: null,

  // Session history stack (normalized same-origin URLs)
  historyUrls: [],
  historyIndex: -1,

  // Pending nav resolved per transition
  pending: null,
  // { kind:'push'|'pop', direction:'forward'|'back', targetUrl, delta, source }

  backLock: false,

  // Bound handlers
  _onPopState: null,
  _onOverlayClick: null,

  // Base page helpers
  baseHomeSnap: null,
  tempBaseUnderlay: null,
};

/* ---------------------------------------
 * Public API
 * ------------------------------------- */

export function onNamespace(ns, handlers) {
  _nsHooks.set(ns, { ...(handlers || {}) });
}

export function getRegisteredNamespaces() {
  return Array.from(_nsHooks.keys());
}

export function registerModule(m) {
  modules.push(m);
}

export function initBarba() {
  if (_initialized) return { destroy };
  _initialized = true;

  if (!barba?.init) {
    console.warn("[barba] introuvable. Charge @barba/core avant initBarba().");
    Context.container = qs(CFG.CONTAINER_SEL) || document;
    return { destroy };
  }

  Context.container = qs(CFG.CONTAINER_SEL) || document;

  ensureStage();
  ensureOverlay();
  bindPagerEvents();
  memorizeBaseMenu();

  mountModules(document);
  updateTyme(document);

  barba.init({
    prevent: ({ el }) => el?.hasAttribute?.("data-barba-prevent"),

    transitions: [
      {
        name: "fac-pager-barba",
        sync: false,

        beforeOnce(data) {
          callNsHook("beforeOnce", data?.next?.namespace, data);
        },

        once(data) {
          const next = data?.next?.container;
          if (next) {
            Context.container = next;
            applyHomeContainer(next);
          }

          const baseUrl = normalizeUrl(window.location.href);
          Pager.historyUrls = [baseUrl];
          Pager.historyIndex = 0;

          if (next) {
            refreshBaseHomeSnapshot(next, baseUrl);
          }

          syncMenuStateFromUrl(baseUrl);
          syncOverlayVisibility();

          callNsHook("once", data?.next?.namespace, data);
          callNsHook("afterEnter", data?.next?.namespace, data);
        },

        before(data) {
          callNsHook("before", data?.current?.namespace, data);

          const current = data?.current?.container;
          if (!current) return;

          Pager.pending = resolvePendingNavigation(data);
          const dir = Pager.pending.direction;

          if (dir === "back") {
            prepareBackwardVisuals(current, Pager.pending);
            // start closing immediately (no perceived latency)
            startOutgoingBackCloseAnimation();
          } else {
            prepareForwardVisuals(current, Pager.pending);
          }

          hideCurrentContainerForTransition(current);
        },

        async leave(data) {
          await Promise.resolve(
            callNsHook("leave", data?.current?.namespace, data),
          );
          unmountModules();
        },

        async beforeEnter(data) {
          if (window.lucide) {
            try {
              lucide.createIcons();
            } catch (e) {
              console.warn("[barba] lucide.createIcons() a échoué:", e);
            }
          }
          updateTyme(data?.next?.container);
        },

        async enter(data) {
          const next = data?.next?.container;
          if (!next) return;

          Context.container = next;
          safelyRebindProgressPath(next);

          const dir = Pager.pending?.direction || "forward";
          const returningToBase = isPendingReturnToBase();

          if (returningToBase) {
            clearAllLayers();
          }

          const shouldPanelizeIncoming =
            !returningToBase && Pager.layers.length > 0;

          if (shouldPanelizeIncoming) {
            // Panel mode always top inset = 48px (constant)
            applyIncomingPanel(next, getTopInsetPx());
          } else {
            applyHomeContainer(next);
          }

          await Promise.resolve(
            callNsHook("enter", data?.next?.namespace, data),
          );

          if (shouldPanelizeIncoming) {
            if (dir === "back") {
              // Incoming panel drops from top=0 to inset (48px)
              await animatePanelDropToInset(next, getTopInsetPx());
            } else {
              // Forward: small slide-up + fade-in
              await animatePanelInForward(next);
            }
          }
          mountModules(data.next.container);
        },

        afterEnter(data) {
          const next = data?.next?.container;

          finalizeNavigationState();

          const isBaseLayer = Pager.historyIndex === 0;
          if (isBaseLayer) {
            clearAllLayers();
            if (next) {
              applyHomeContainer(next);
              refreshBaseHomeSnapshot(next, normalizeUrl(window.location.href));
            }
          } else if (next) {
            settleTopPanel(next);
          }

          cleanupTempBaseUnderlay();
          syncMenuStateFromUrl(normalizeUrl(window.location.href));
          syncOverlayVisibility();

          callNsHook("afterEnter", data?.next?.namespace, data);

          Pager.pending = null;

          // If no back-close anim running, purge any lingering snap
          if (!Pager.outgoingBackAnim) {
            forceClearOutgoingBackSnap();
          }

          /* auto rooms */
          window.__faChatSyncPath?.(
            data?.next?.url?.path ||
              data?.next?.url?.href ||
              window.location.href,
          );
        },
      },
    ],
  });

  return { destroy };
}

/* ---------------------------------------
 * Destroy
 * ------------------------------------- */

function destroy() {
  try {
    barba?.destroy?.();
  } catch {}

  if (Pager._onPopState) {
    window.removeEventListener("popstate", Pager._onPopState);
    Pager._onPopState = null;
  }

  if (Pager.overlayEl && Pager._onOverlayClick) {
    Pager.overlayEl.removeEventListener("click", Pager._onOverlayClick);
    Pager._onOverlayClick = null;
  }

  clearAllLayers();
  cleanupTempBaseUnderlay();
  forceClearOutgoingBackSnap();
  safeRemove(Pager.baseHomeSnap);
  Pager.baseHomeSnap = null;

  if (Pager.stage?.isConnected) Pager.stage.remove();
  Pager.stage = null;

  if (Pager.overlayIsFallback && Pager.overlayEl?.isConnected) {
    Pager.overlayEl.remove();
  }
  Pager.overlayEl = null;
  Pager.overlayIsFallback = false;

  Pager.detachedByUrl.clear();
  Pager.historyUrls = [];
  Pager.historyIndex = -1;
  Pager.pending = null;
  Pager.backLock = false;

  _nsHooks.clear();
  _initialized = false;
}

/* ---------------------------------------
 * Namespace hooks
 * ------------------------------------- */

function callNsHook(name, ns, data) {
  const h = ns ? _nsHooks.get(ns) : null;
  try {
    return h?.[name]?.(data);
  } catch (e) {
    console.error(`[barba:${name} ns]`, e);
  }
}

/* ---------------------------------------
 * Event binding (history / overlay)
 * ------------------------------------- */

function bindPagerEvents() {
  if (!Pager._onPopState) {
    Pager._onPopState = () => {
      const targetUrl = normalizeUrl(window.location.href);
      const idx = findLastIndex(Pager.historyUrls, targetUrl);

      let delta = 0;
      let direction = "back";

      if (idx >= 0) {
        delta = idx - Pager.historyIndex;
        direction = delta < 0 ? "back" : "forward";
      } else {
        direction = Pager.layers.length > 0 ? "back" : "forward";
      }

      // Overlay responsiveness immediately (top strip)
      if (idx === 0) hideOverlayNow();
      else if (idx > 0) showOverlayNow();

      Pager.pending = {
        kind: "pop",
        direction,
        targetUrl,
        delta,
        source: "history",
      };
    };

    window.addEventListener("popstate", Pager._onPopState);
  }

  if (Pager.overlayEl && !Pager._onOverlayClick) {
    Pager._onOverlayClick = (e) => {
      e.preventDefault();
      if (!Pager.layers.length || Pager.backLock) return;

      Pager.backLock = true;

      // If closing last panel -> hide overlay instantly
      if (Pager.layers.length === 1) {
        hideOverlayNow();
      }

      Pager.pending = {
        kind: "pop",
        direction: "back",
        targetUrl: null,
        delta: -1,
        source: "overlay",
      };

      window.history.back();

      window.setTimeout(() => {
        Pager.backLock = false;
      }, CFG.BACK_CLOSE_MS + 60);
    };

    Pager.overlayEl.addEventListener("click", Pager._onOverlayClick);
  }
}

/* ---------------------------------------
 * DOM setup
 * ------------------------------------- */

function ensureStage() {
  let stage = byId(CFG.STAGE_ID);
  const host = getHost();

  if (!stage) {
    stage = document.createElement("div");
    stage.id = CFG.STAGE_ID;
    stage.setAttribute("aria-hidden", "true");
    setStyles(stage, {
      position: "absolute",
      inset: "0",
      zIndex: String(CFG.STAGE_Z),
      pointerEvents: "none",
      overflow: "hidden",
    });
    host.appendChild(stage);
  } else if (stage.parentElement !== host) {
    host.appendChild(stage);
  }

  Pager.stage = stage;
  return stage;
}

function ensureOverlay() {
  let overlay = qs(CFG.OVERLAY_SEL);
  let isFallback = false;
  const host = getHost();

  if (!overlay) {
    overlay = byId(CFG.OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = CFG.OVERLAY_ID;
      host.appendChild(overlay);
    } else if (overlay.parentElement !== host) {
      host.appendChild(overlay);
    }
    isFallback = true;
  }

  setStyles(overlay, {
    position: "absolute",
    top: "0",
    left: "0",
    right: "0",
    bottom: "auto",
    height: "0px",
    zIndex: String(CFG.OVERLAY_Z),
    display: "none",
    background: "rgba(0,0,0,.25)",
    cursor: "n-resize",
    pointerEvents: "auto",
  });

  Pager.overlayEl = overlay;
  Pager.overlayIsFallback = isFallback;
  return overlay;
}

/* ---------------------------------------
 * Navigation resolution / history state
 * ------------------------------------- */

function resolvePendingNavigation(data) {
  if (Pager.pending) return Pager.pending;

  const triggerHref =
    data?.trigger?.href || data?.next?.url?.href || window.location.href;

  const targetUrl = normalizeUrl(triggerHref);
  const currentUrl = normalizeUrl(
    data?.current?.url?.href || window.location.href,
  );

  const idx = findLastIndex(Pager.historyUrls, targetUrl);
  const currentIdx = Pager.historyIndex;

  if (idx >= 0 && idx !== currentIdx) {
    return {
      kind: "pop",
      direction: idx < currentIdx ? "back" : "forward",
      targetUrl,
      delta: idx - currentIdx,
      source: "fallback",
    };
  }

  return {
    kind: "push",
    direction: "forward",
    targetUrl,
    delta: 1,
    source: "fallback",
  };
}

function finalizeNavigationState() {
  const currentUrl = normalizeUrl(window.location.href);
  const nav = Pager.pending || {
    kind: "push",
    direction: "forward",
    targetUrl: currentUrl,
    delta: 1,
    source: "fallback",
  };

  if (nav.kind === "push") {
    Pager.historyUrls = Pager.historyUrls.slice(0, Pager.historyIndex + 1);
    Pager.historyUrls.push(currentUrl);
    Pager.historyIndex = Pager.historyUrls.length - 1;
    return;
  }

  const idx = findLastIndex(Pager.historyUrls, currentUrl);
  if (idx >= 0) {
    Pager.historyIndex = idx;
  } else {
    Pager.historyUrls = Pager.historyUrls.slice(0, Pager.historyIndex + 1);
    Pager.historyUrls.push(currentUrl);
    Pager.historyIndex = Pager.historyUrls.length - 1;
  }
}

function getPendingTargetIndex() {
  const nav = Pager.pending;

  if (nav?.kind === "pop" && typeof nav.delta === "number" && nav.delta !== 0) {
    const raw = Pager.historyIndex + nav.delta;
    return clamp(raw, 0, Pager.historyUrls.length - 1);
  }

  if (nav?.targetUrl) {
    const idx = findLastIndex(Pager.historyUrls, nav.targetUrl);
    if (idx >= 0) return idx;
  }

  return Pager.historyIndex;
}

function isPendingReturnToBase() {
  const nav = Pager.pending;
  return !!(nav && nav.direction === "back" && getPendingTargetIndex() === 0);
}

/* ---------------------------------------
 * Pager visuals (stack + promotion + back close)
 * ------------------------------------- */

function prepareForwardVisuals(currentContainer, nav) {
  ensureStage();

  const currentUrl = normalizeUrl(window.location.href);
  const snap = cloneForSnapshot(currentContainer);
  const nextOrder = getNextLayerOrder();

  // Inset of current active panel (0 if base, 48 if already in panel mode)
  styleLayerSnapshot(snap, nextOrder, currentUrl);

  const fromInsetPx = getTopInsetPx();
  setStyles(snap, {
    top: "0px",
    transform: fromInsetPx ? `translateY(${fromInsetPx}px)` : "translateY(0)",
  });

  Pager.stage.appendChild(snap);
  Pager.layers.push({ url: currentUrl, el: snap, order: nextOrder });

  // Overlay must appear immediately on opening first panel
  showOverlayNow();

  normalizeLayerOrderAndZ();

  // Promote snapshot to background: visually moves up by inset to become top=0
  promoteSnapshotToBackground(snap, fromInsetPx);

  // Optional: rebuild intermediate detached pages on browser forward jumps (kept)
  if (nav.kind === "pop" && nav.delta > 1) {
    const start = Pager.historyIndex + 1;
    const end = Pager.historyIndex + nav.delta;

    let order = nextOrder;
    for (let i = start; i < end; i++) {
      const url = Pager.historyUrls[i];
      if (!url || url === nav.targetUrl) continue;
      if (Pager.layers.some((l) => l.url === url)) continue;

      const cached = Pager.detachedByUrl.get(url);
      if (!cached) continue;

      const restored = cached.cloneNode(true);
      order += 1;
      styleLayerSnapshot(restored, order, url);
      Pager.stage.appendChild(restored);
      Pager.layers.push({ url, el: restored, order });
    }
  }

  normalizeLayerOrderAndZ();
}

function prepareBackwardVisuals(currentContainer, nav) {
  // Capture inset BEFORE popping layers (prevents positional jump)
  const fromInsetPx = getTopInsetPx();

  ensureStage();

  const steps = nav?.delta < 0 ? Math.max(1, Math.abs(nav.delta)) : 1;
  const removed = [];

  for (let i = 0; i < steps; i++) {
    const top = Pager.layers.pop();
    if (!top) break;
    removed.push(top);

    if (top.url) {
      Pager.detachedByUrl.set(top.url, top.el.cloneNode(true));
    }
    safeRemove(top.el);
  }

  if (!nav.targetUrl && removed.length) {
    nav.targetUrl = removed[removed.length - 1].url || removed[0].url || null;
  }

  normalizeLayerOrderAndZ();

  // If returning to base, place an underlay under the closing panel to avoid flash
  if (Pager.layers.length === 0 && Pager.baseHomeSnap) {
    placeTempBaseUnderlay();
  }

  // Outgoing panel snapshot that will fade/slide down
  forceClearOutgoingBackSnap();
  const out = cloneForSnapshot(currentContainer);
  styleOutgoingBackSnapshot(out, fromInsetPx);
  Pager.stage.appendChild(out);
  Pager.outgoingBackSnap = out;

  // If returning to base, overlay must vanish immediately
  if (getPendingTargetIndex() === 0) {
    hideOverlayNow();
  } else {
    // still in panel mode: ensure overlay visible & correct geometry
    showOverlayNow();
  }
}

function startOutgoingBackCloseAnimation() {
  if (!Pager.outgoingBackSnap || Pager.outgoingBackAnim) return;

  const el = Pager.outgoingBackSnap;

  Pager.outgoingBackAnim = animatePanelOutBack(el)
    .catch(() => {})
    .finally(() => {
      if (Pager.outgoingBackSnap === el) {
        Pager.outgoingBackSnap = null;
      }
      Pager.outgoingBackAnim = null;
    });
}

function placeTempBaseUnderlay() {
  cleanupTempBaseUnderlay();

  Pager.tempBaseUnderlay = Pager.baseHomeSnap.cloneNode(true);
  setStyles(Pager.tempBaseUnderlay, {
    zIndex: "200",
    top: "0",
    left: "0",
    right: "0",
    bottom: "0",
    transform: "translateY(0)",
    opacity: "1",
    pointerEvents: "none",
    visibility: "visible",
  });

  Pager.stage.appendChild(Pager.tempBaseUnderlay);
}

/* ---------------------------------------
 * Container / snapshot styling
 * ------------------------------------- */

function applyHomeContainer(container) {
  if (!container) return;
  resetContainerInlineStyles(container);
  container.setAttribute("data-pos", "home");
  container.classList.remove("currentpage");
  setStyles(container, {
    visibility: "visible",
    pointerEvents: "auto",
    opacity: "1",
    transform: "translateY(0)",
  });
}

function applyIncomingPanel(container, insetPx) {
  if (!container) return;

  container.classList.add(
    "currentpage",
    "bg-zinc-50",
    "dark:bg-black",
    "rounded-tl-xl",
    "rounded-tr-xl",
  );
  container.setAttribute("data-pos", "p2");
  container.removeAttribute("data-order");

  setStyles(container, {
    position: "absolute",
    top: cssPx(insetPx), // constant 48px in panel mode
    left: "0",
    right: "0",
    bottom: "0",
    margin: "0",
    width: "auto",
    maxWidth: "none",
    overflow: "auto",
    visibility: "visible",
    pointerEvents: "auto",
    boxShadow: "0 2px 8px rgba(0,0,0,.1)",
    zIndex: String(CFG.PANEL_Z),
    willChange: "transform, opacity",
    opacity: "1",
    transform: "translateY(0)",
  });
}

function settleTopPanel(container) {
  if (!container) return;
  setStyles(container, {
    transform: "translateY(0)",
    opacity: "1",
    visibility: "visible",
    pointerEvents: "auto",
    willChange: "",
  });
}

function hideCurrentContainerForTransition(container) {
  if (!container) return;
  setStyles(container, {
    visibility: "hidden",
    pointerEvents: "none",
  });
}

function styleLayerSnapshot(el, order, url) {
  el.classList.remove("currentpage");
  el.setAttribute("data-pos", "p3");
  el.setAttribute("data-order", String(order));
  if (url) el.setAttribute("data-url", url);

  setStyles(el, snapshotBaseStyles());
  setStyles(el, {
    zIndex: String(200 + order),
    transform: "translateY(0)",
    opacity: "1",
  });
}

function styleOutgoingBackSnapshot(el, insetPx) {
  el.classList.add("currentpage");
  el.setAttribute("data-pos", "p2");
  el.removeAttribute("data-order");

  setStyles(el, snapshotBaseStyles());
  setStyles(el, {
    top: cssPx(insetPx),
    zIndex: String(CFG.PANEL_Z),
    transform: "translateY(0)",
    opacity: "1",
    willChange: "transform, opacity",
  });
}

function snapshotBaseStyles() {
  return {
    position: "absolute",
    top: "0",
    left: "0",
    right: "0",
    bottom: "0",
    margin: "0",
    width: "auto",
    maxWidth: "none",
    overflow: "auto",
    visibility: "visible",
    pointerEvents: "none",
  };
}

function resetContainerInlineStyles(container) {
  if (!container) return;
  for (const key of INLINE_STYLE_KEYS) {
    container.style[key] = "";
  }
}

const INLINE_STYLE_KEYS = [
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "zIndex",
  "margin",
  "width",
  "maxWidth",
  "overflow",
  "visibility",
  "pointerEvents",
  "background",
  "boxShadow",
  "borderRadius",
  "transform",
  "opacity",
  "willChange",
  "cursor",
];

/* ---------------------------------------
 * Animation (DRY)
 * ------------------------------------- */

function animate(
  el,
  keyframes,
  opts,
  { commitFinalStyles = null, removeOnFinish = false } = {},
) {
  if (!el) return Promise.resolve();

  // Fallback no-WAAPI
  if (!el.animate) {
    const last = Array.isArray(keyframes)
      ? keyframes[keyframes.length - 1]
      : null;
    if (last) Object.assign(el.style, last);
    if (commitFinalStyles) Object.assign(el.style, commitFinalStyles);
    if (removeOnFinish) safeRemove(el);
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const anim = el.animate(keyframes, opts);
    const done = () => {
      if (commitFinalStyles) Object.assign(el.style, commitFinalStyles);
      if (removeOnFinish) safeRemove(el);
      resolve();
    };
    anim.onfinish = done;
    anim.oncancel = done;
  });
}

function animatePanelInForward(el) {
  // enters from below by 50px + fade-in
  return animate(
    el,
    [
      { transform: `translateY(${CFG.SLIDE_PX}px)`, opacity: 0 },
      { transform: "translateY(0)", opacity: 1 },
    ],
    { duration: CFG.ENTER_MS, easing: CFG.EASING, fill: "forwards" },
    {
      commitFinalStyles: {
        transform: "translateY(0)",
        opacity: "1",
        willChange: "",
      },
    },
  );
}

function animatePanelOutBack(el) {
  // outgoing panel fades/slides down by 50px then disappears
  return animate(
    el,
    [
      { transform: "translateY(0)", opacity: 1 },
      { transform: `translateY(${CFG.SLIDE_PX}px)`, opacity: 0 },
    ],
    { duration: CFG.BACK_CLOSE_MS, easing: CFG.EASING, fill: "forwards" },
    { removeOnFinish: true },
  );
}

function animatePanelDropToInset(el, insetPx) {
  // element is positioned at top=insetPx, but we show it initially at top=0 via transform(-insetPx)
  const from = { transform: `translateY(-${insetPx}px)`, opacity: 1 };
  const to = { transform: "translateY(0)", opacity: 1 };

  // set immediately to avoid 1-frame flash
  el.style.transform = from.transform;

  return animate(
    el,
    [from, to],
    { duration: CFG.ENTER_MS, easing: CFG.EASING, fill: "forwards" },
    {
      commitFinalStyles: {
        transform: "translateY(0)",
        opacity: "1",
        willChange: "",
      },
    },
  );
}

function promoteSnapshotToBackground(el, fromInsetPx) {
  if (!el || fromInsetPx <= 0) return;

  el.style.willChange = "transform";

  animate(
    el,
    [
      { transform: `translateY(${fromInsetPx}px)` },
      { transform: "translateY(0)" },
    ],
    { duration: CFG.ENTER_MS, easing: CFG.EASING, fill: "forwards" },
    {
      commitFinalStyles: {
        transform: "translateY(0)",
        willChange: "",
      },
    },
  );
}

/* ---------------------------------------
 * Overlay (top strip, constant height)
 * ------------------------------------- */

function syncOverlayVisibility() {
  if (!Pager.overlayEl) return;
  Pager.layers.length > 0 ? showOverlayNow() : hideOverlayNow();
}

function getTopInsetPx() {
  // constant: 48px whenever there is at least one background layer
  return Pager.layers.length > 0 ? CFG.STACK_PX : 0;
}

function updateOverlayGeometry() {
  if (!Pager.overlayEl) return;

  const h = `${getTopInsetPx()}px`;

  setStyles(Pager.overlayEl, {
    top: "0",
    left: "0",
    right: "0",
    bottom: "0",
    height: "100%",
  });
}

function showOverlayNow() {
  if (!Pager.overlayEl) return;
  updateOverlayGeometry();
  Pager.overlayEl.style.display = Pager.overlayIsFallback ? "block" : "";
}

function hideOverlayNow() {
  if (!Pager.overlayEl) return;
  Pager.overlayEl.style.display = "none";
}

/* ---------------------------------------
 * Menu sync (optional legacy behavior)
 * ------------------------------------- */

function memorizeBaseMenu() {
  const nav = qs(CFG.MENU_SEL);
  if (!nav) return;
  const current = nav.querySelector("li.current-menu-item");
  if (current) current.setAttribute("base-menu", "1");
}

function syncMenuStateFromUrl(urlLike) {
  const nav = qs(CFG.MENU_SEL);
  if (!nav) return;

  const target = normalizeUrl(urlLike);

  for (const li of nav.querySelectorAll("li")) {
    li.classList.remove("current-menu-item", "current-menu-parent");
  }

  let selectedLi = null;

  for (const a of nav.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href");
    if (!href) continue;
    if (normalizeUrl(href) === target) {
      selectedLi = a.closest("li");
      break;
    }
  }

  if (!selectedLi) {
    selectedLi = nav.querySelector('li[base-menu="1"]');
  }
  if (!selectedLi) return;

  selectedLi.classList.add("current-menu-item");

  const sub = selectedLi.closest("ul.sub-menu");
  const parentLi = sub?.closest("li");
  if (parentLi) parentLi.classList.add("current-menu-parent");
}

/* ---------------------------------------
 * Base snapshot lifecycle
 * ------------------------------------- */

function refreshBaseHomeSnapshot(container, url) {
  safeRemove(Pager.baseHomeSnap);

  const homeSnap = cloneForSnapshot(container);
  styleLayerSnapshot(homeSnap, 0, url);
  homeSnap.setAttribute("data-pos", "home");
  homeSnap.removeAttribute("data-order");

  setStyles(homeSnap, {
    zIndex: "200",
    pointerEvents: "none",
    visibility: "visible",
  });

  Pager.baseHomeSnap = homeSnap;
}

function cleanupTempBaseUnderlay() {
  safeRemove(Pager.tempBaseUnderlay);
  Pager.tempBaseUnderlay = null;
}

/* ---------------------------------------
 * Layer utilities
 * ------------------------------------- */

function getHost() {
  const host = qs(CFG.WRAPPER_SEL) || document.body;

  // il faut un contexte de positionnement pour l'absolu
  const pos = window.getComputedStyle(host).position;
  if (pos === "static") host.style.position = "relative";

  // utile dans un layout flex (évite des hauteurs bizarres)
  if (!host.style.minHeight) host.style.minHeight = "0";

  return host;
}

function clearAllLayers() {
  for (const layer of Pager.layers) {
    safeRemove(layer.el);
  }
  Pager.layers = [];
}

function getNextLayerOrder() {
  if (!Pager.layers.length) return 1;
  return Math.max(...Pager.layers.map((l) => l.order)) + 1;
}

function normalizeLayerOrderAndZ() {
  Pager.layers.sort((a, b) => a.order - b.order);

  Pager.layers.forEach((layer, idx) => {
    const order = idx + 1;
    layer.order = order;

    layer.el.setAttribute("data-pos", "p3");
    layer.el.setAttribute("data-order", String(order));
    setStyles(layer.el, { zIndex: String(200 + order) });
  });
}

function forceClearOutgoingBackSnap() {
  safeRemove(Pager.outgoingBackSnap);
  Pager.outgoingBackSnap = null;
  Pager.outgoingBackAnim = null;
}

/* ---------------------------------------
 * General utils
 * ------------------------------------- */

function safelyRebindProgressPath(next) {
  try {
    if (
      typeof rebindProgressPath === "function" &&
      typeof cursor !== "undefined"
    ) {
      rebindProgressPath(next, cursor);
    }
  } catch (e) {
    console.warn("[barba] rebindProgressPath ignoré:", e);
  }
}

function cloneForSnapshot(container) {
  const snap = container.cloneNode(true);
  snap.querySelectorAll?.("[id]")?.forEach((el) => el.removeAttribute("id"));
  return snap;
}

function normalizeUrl(urlLike) {
  try {
    const u = new URL(urlLike, window.location.href);
    let out = `${u.pathname}${u.search}${u.hash}`;
    if (out.length > 1 && out.endsWith("/")) out = out.slice(0, -1);
    return out;
  } catch {
    return String(urlLike || "");
  }
}

function findLastIndex(arr, value) {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] === value) return i;
  }
  return -1;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function setStyles(el, styles) {
  if (!el || !styles) return;
  Object.assign(el.style, styles);
}

function safeRemove(el) {
  if (!el) return;
  try {
    el.remove();
  } catch {}
}

function cssPx(n) {
  return `${n}px`;
}

function qs(sel, root = document) {
  return root.querySelector(sel);
}

function byId(id) {
  return document.getElementById(id);
}
