import { icons, forumTheme } from "../core/sidebar.js";
import { initPrism } from "../features/prism.js";
import { TAG_PRESETS } from "../features/tag-editor.js";

export const addIconToCategory = (root = document) => {
  const category = root.querySelector("#topic-category");
  const nav = category.querySelector(".nav");
  nav.classList.add("flex");
  const m = nav?.href?.match(/\/f(\d+)-/);
  if (m) {
    const id = m[1];
    const icon = icons["f" + id];
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

    if (url.origin !== origin) return;
    if (!a.dataset.originalText) a.dataset.originalText = a.textContent ?? "";
    a.classList.add(className, "bg-zinc-100", "dark:bg-zinc-900");

    let path = url.pathname || "/";
    try {
      path = decodeURIComponent(path);
    } catch {}
    a.textContent = path;
  });
}

export const addColorToPost = (root = document) => {
  const post = root.querySelector(".postbody");
  if (!post) return;
  const category = root.querySelector("#topic-category .nav");
  const m = category?.href?.match(/\/f(\d+)-/);
  let color = "gray";
  if (m) {
    const id = m[1];
    color = forumTheme["f" + id]?.color || color;
  }
  root.body.style.setProperty("--author-color", `var(--color-${color}-500)`);
};

// ────────────────────────────────────────────────
// Tags entre crochets — [tag1, tag2, tag3]
// ────────────────────────────────────────────────

const COLOR_MAP = {
  emerald: {
    bg: "bg-emerald-100",
    text: "text-emerald-700",
    darkBg: "dark:bg-emerald-950",
    darkText: "dark:text-emerald-300",
  },
  blue: {
    bg: "bg-blue-100",
    text: "text-blue-700",
    darkBg: "dark:bg-blue-950",
    darkText: "dark:text-blue-300",
  },
  purple: {
    bg: "bg-purple-100",
    text: "text-purple-700",
    darkBg: "dark:bg-purple-950",
    darkText: "dark:text-purple-300",
  },
  amber: {
    bg: "bg-amber-100",
    text: "text-amber-700",
    darkBg: "dark:bg-amber-950",
    darkText: "dark:text-amber-300",
  },
  rose: {
    bg: "bg-rose-100",
    text: "text-rose-700",
    darkBg: "dark:bg-rose-950",
    darkText: "dark:text-rose-300",
  },
  cyan: {
    bg: "bg-cyan-100",
    text: "text-cyan-700",
    darkBg: "dark:bg-cyan-950",
    darkText: "dark:text-cyan-300",
  },
  lime: {
    bg: "bg-lime-100",
    text: "text-lime-700",
    darkBg: "dark:bg-lime-950",
    darkText: "dark:text-lime-300",
  },
  indigo: {
    bg: "bg-indigo-100",
    text: "text-indigo-700",
    darkBg: "dark:bg-indigo-950",
    darkText: "dark:text-indigo-300",
  },
  orange: {
    bg: "bg-orange-100",
    text: "text-orange-700",
    darkBg: "dark:bg-orange-950",
    darkText: "dark:text-orange-300",
  },
};

const COLOR_KEYS = Object.keys(COLOR_MAP);

function hashColor(tag) {
  let h = 0;
  for (let i = 0; i < tag.length; i++)
    h = ((h << 5) - h + tag.charCodeAt(i)) | 0;
  return COLOR_MAP[COLOR_KEYS[Math.abs(h) % COLOR_KEYS.length]];
}

/** Recherche insensible à la casse/accents dans TAG_PRESETS */
export function resolvePreset(key) {
  if (TAG_PRESETS[key]) return { preset: TAG_PRESETS[key], canonical: key };
  const lower = key.toLowerCase();
  const found = Object.keys(TAG_PRESETS).find((k) => k.toLowerCase() === lower);
  return found
    ? { preset: TAG_PRESETS[found], canonical: found }
    : { preset: null, canonical: key };
}

function tagColor(key) {
  const { preset } = resolvePreset(key);
  if (preset?.color && COLOR_MAP[preset.color]) return COLOR_MAP[preset.color];
  return hashColor(key);
}

function tagLabel(key) {
  const { preset } = resolvePreset(key);
  return preset?.label || key;
}

function tagIcon(key) {
  const { preset } = resolvePreset(key);
  return preset?.icon || null;
}

const BRACKET_TAGS_RE = /\[([^\]]+)\]\s*$/;

export const stripBracketTags = (raw) => {
  const match = (raw || "").match(BRACKET_TAGS_RE);
  if (!match) return { cleaned: raw || "", tags: [] };

  const tags = match[1]
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const cleaned = (raw || "")
    .slice(0, match.index)
    .replace(/[\s\-–—:;,.|]+$/g, "")
    .trim();

  return { cleaned, tags };
};

const clearBadges = (container) => {
  container.querySelectorAll("[data-tag-badge]").forEach((el) => el.remove());
};

export const createTagBadge = (key) => {
  const color = tagColor(key);
  const icon = tagIcon(key);
  const label = tagLabel(key);

  const span = document.createElement("span");
  span.setAttribute("data-tag-badge", key);
  span.className = [
    "inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full",
    color.bg,
    color.text,
    color.darkBg,
    color.darkText,
  ].join(" ");

  if (icon) {
    const iconSpan = document.createElement("span");
    iconSpan.className = "inline-flex items-center [&>svg]:size-3";
    iconSpan.innerHTML = icon;
    span.appendChild(iconSpan);
  }

  const labelSpan = document.createElement("span");
  labelSpan.textContent = label;
  span.appendChild(labelSpan);

  return span;
};

// ────────────────────────────────────────────────
// Fonction principale — affichage des tags
// ────────────────────────────────────────────────

export const extractTagfromTitle = (root = document) => {
  const titleEl = root.querySelector("#topic-title");
  const container = root.querySelector("#tags-container");
  if (!titleEl || !container) return;

  const host = titleEl.querySelector("a") || titleEl;

  const text = (host.textContent || "").trim();
  if (!text) return;

  const { cleaned, tags } = stripBracketTags(text);

  if (cleaned !== text) {
    host.textContent = cleaned;
  }

  clearBadges(container);

  // checkbox tags (résolu) en premier
  const sorted = [...tags].sort((a, b) => {
    const aCheck = resolvePreset(a).preset?.checkbox ? 0 : 1;
    const bCheck = resolvePreset(b).preset?.checkbox ? 0 : 1;
    return aCheck - bCheck;
  });

  sorted.forEach((key) => {
    container.appendChild(createTagBadge(key));
  });
};

// ────────────────────────────────────────────────

const appendFirstPost = (root = document) => {
  const articles = root.querySelectorAll("article");
  if (!articles.length) return;

  articles.forEach((article, index) => {
    if (index === 0) {
      const content = article.querySelector("#topic-content");
      if (content) {
        const reminder = content.querySelector("strong");
        if (
          reminder &&
          reminder.textContent.trim().startsWith("Rappel du premier message")
        ) {
          let node = reminder.nextSibling;
          let brToRemove = 2;
          while (node && brToRemove > 0) {
            if (
              node.nodeType === Node.TEXT_NODE &&
              node.textContent.trim() === ""
            ) {
              const toClean = node;
              node = node.nextSibling;
              toClean.remove();
              continue;
            }
            if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "BR") {
              const br = node;
              node = node.nextSibling;
              br.remove();
              brToRemove--;
              continue;
            }
            break;
          }
          reminder.remove();
        }
      }
    } else {
      article.remove();
    }
  });

  const firstPostWrapper = root.querySelector(
    "#forum-replies > div:first-child",
  );
  if (firstPostWrapper && !firstPostWrapper.querySelector("article")) {
    firstPostWrapper.remove();
  }
};

export const initViewtopic = (root = document) => {
  appendFirstPost(root);
  addIconToCategory(root);
  addColorToPost();
  markInternalLinks();
  extractTagfromTitle(root);
  initPrism(root);
};
