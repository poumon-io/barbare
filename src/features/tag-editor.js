// tag-editor.js

/**
 * Éditeur de tags avec combobox — entièrement autonome.
 *
 * Les tags prédéfinis sont définis dans TAG_PRESETS ci-dessous.
 * Le module construit tout son UI dans #tag-editor :
 *   - Checkbox « Résolu » (raccourci dédié, label/icône/couleur depuis TAG_PRESETS)
 *   - Combobox (pills + dropdown des autres tags prédéfinis)
 *
 * Se branche sur :
 *   - input[name="subject"]  → source de vérité
 *   - #tag-editor            → conteneur vide
 *
 * Barba :
 *   registerModule({ mount(c) { TagEditor.attach(c); return () => TagEditor.detach(); } });
 */

// ────────────────────────────────────────────────
// Tags prédéfinis
// ────────────────────────────────────────────────
// Clé       = valeur sérialisée dans le titre [clé1, clé2]
// label     : texte affiché (dropdown, pills, checkbox)
// icon      : HTML inline (SVG) — optionnel
// color     : surcharge la couleur (clé Tailwind) — optionnel, sinon hash auto
// checkbox  : true → affiché comme toggle dédié, exclu du dropdown

export const TAG_PRESETS = {
  résolu: {
    label: "Résolu",
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 lucide lucide-circle-check-big-icon lucide-circle-check-big"><path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/></svg>`,
    color: "emerald",
    checkbox: true,
  },
  "avis bienvenus": {
    label: "Avis bienvenus",
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 lucide lucide-thumbs-up-icon lucide-thumbs-up"><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/><path d="M7 10v12"/></svg>`,
    color: "blue",
  },
  html: {
    label: "HTML",
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/></svg>`,
    color: "orange",
  },
  javascript: {
    label: "JavaScript",
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/></svg>`,
    color: "amber",
  },
  php: {
    label: "PHP",
    color: "indigo",
  },
  responsive: {
    label: "Responsive",
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><path d="M12 18h.01"/></svg>`,
  },
  seo: {
    label: "SEO",
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
  },
  accessibilité: {
    label: "Accessibilité",
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="16" cy="4" r="1"/><path d="m18 19 1-7-6 1"/><path d="m5 8 3-3 5.5 3-2.36 3.5"/><path d="M4.24 14.5a5 5 0 0 0 6.88 6"/><path d="M13.76 17.5a5 5 0 0 0-6.88-6"/></svg>`,
    color: "purple",
  },
  performance: {
    label: "Performance",
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m13 2-2 2.5h3L12 7"/><path d="M12 22v-3"/><circle cx="12" cy="14" r="5"/></svg>`,
    color: "lime",
  },
  design: {
    label: "Design",
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 13 5-5 5 5"/><path d="m22 13-5-5-5 5"/><path d="M12 22V8"/></svg>`,
    color: "rose",
  },
  "base de données": {
    label: "Base de données",
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></svg>`,
    color: "cyan",
  },
  api: {
    label: "API",
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11h16"/><path d="M12 3v8"/><path d="m8 7-4 4 4 4"/><path d="m16 7 4 4-4 4"/><path d="M4 19h16"/></svg>`,
  },
  sécurité: {
    label: "Sécurité",
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/></svg>`,
    color: "indigo",
  },
};

// Clés des tags qui ont checkbox: true
const CHECKBOX_KEYS = Object.keys(TAG_PRESETS).filter(
  (k) => TAG_PRESETS[k].checkbox,
);

// Nombre max de tags hors checkbox (résolu ne compte pas)
const MAX_COMBO_TAGS = 3;

// ────────────────────────────────────────────────

export const TagEditor = (function () {
  // ── état ──
  let subjectInput = null;
  let containerEl = null;
  let editorEl = null;
  let checkboxes = {}; // { key: HTMLInputElement }
  let dropdownEl = null;
  let comboInput = null;
  let tags = [];
  let baseTitle = "";
  let highlightIdx = -1;
  let changeCb = null;
  let cleanupFns = [];
  let isActive = false;

  // ── palette ──
  const COLOR_MAP = {
    emerald: {
      bg: "bg-emerald-100",
      text: "text-emerald-700",
      darkBg: "dark:bg-emerald-950",
      darkText: "dark:text-emerald-300",
      checked: "checked:border-emerald-600 checked:bg-emerald-600",
      focus: "focus-visible:outline-emerald-600",
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

  /** Recherche insensible à la casse dans TAG_PRESETS */
  function resolvePreset(key) {
    if (TAG_PRESETS[key]) return TAG_PRESETS[key];
    const lower = key.toLowerCase();
    const found = Object.keys(TAG_PRESETS).find(
      (k) => k.toLowerCase() === lower,
    );
    return found ? TAG_PRESETS[found] : null;
  }

  function tagColor(key) {
    const preset = resolvePreset(key);
    if (preset?.color && COLOR_MAP[preset.color])
      return COLOR_MAP[preset.color];
    return hashColor(key);
  }

  function tagLabel(key) {
    return resolvePreset(key)?.label || key;
  }

  function tagIcon(key) {
    return resolvePreset(key)?.icon || null;
  }

  function isCheckboxTag(key) {
    return !!resolvePreset(key)?.checkbox;
  }

  // ────────────────────────────────────────────────
  // Parsing
  // ────────────────────────────────────────────────

  const BRACKET_TAGS_RE = /\[([^\]]+)\]\s*$/;

  function parseSubject(raw) {
    const match = (raw || "").match(BRACKET_TAGS_RE);
    if (!match) return { base: (raw || "").trim(), tags: [] };

    const parsed = match[1]
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const base = (raw || "")
      .slice(0, match.index)
      .replace(/[\s\-–—:;,.|]+$/g, "")
      .trim();

    return { base, tags: parsed };
  }

  function buildSubject() {
    if (tags.length === 0) return baseTitle;
    return `${baseTitle} [${tags.join(", ")}]`;
  }

  // ────────────────────────────────────────────────
  // Actions
  // ────────────────────────────────────────────────

  /** Nombre de tags non-checkbox actuellement sélectionnés */
  function comboTagCount() {
    return tags.filter((t) => !isCheckboxTag(t)).length;
  }

  function addTag(key) {
    const k = key.trim();
    if (!k) return false;

    const lower = k.toLowerCase();
    if (tags.some((x) => x.toLowerCase() === lower)) return false;

    // limite : les tags checkbox ne comptent pas
    if (!isCheckboxTag(k) && comboTagCount() >= MAX_COMBO_TAGS) return false;

    tags.push(k);
    syncAll();
    return true;
  }

  function removeTag(key) {
    const lower = key.toLowerCase();
    const idx = tags.findIndex((x) => x.toLowerCase() === lower);
    if (idx === -1) return false;
    tags.splice(idx, 1);
    syncAll();
    return true;
  }

  function toggleCheckboxTag(key, checked) {
    const has = tags.some((t) => t.toLowerCase() === key.toLowerCase());
    if (checked && !has) {
      tags.push(key);
      syncAll();
    } else if (!checked && has) {
      tags = tags.filter((t) => t.toLowerCase() !== key.toLowerCase());
      syncAll();
    }
  }

  function hasTag(key) {
    return tags.some((t) => t.toLowerCase() === key.toLowerCase());
  }

  function syncAll() {
    if (subjectInput) subjectInput.value = buildSubject();
    syncCheckboxes();
    renderPills();
    if (changeCb) changeCb(buildSubject(), [...tags]);
  }

  function syncCheckboxes() {
    for (const key of CHECKBOX_KEYS) {
      if (checkboxes[key]) {
        checkboxes[key].checked = hasTag(key);
      }
    }
  }

  // ────────────────────────────────────────────────
  // Dropdown
  // ────────────────────────────────────────────────

  function getAvailableKeys(query) {
    const q = (query || "").toLowerCase();
    const selectedLower = tags.map((t) => t.toLowerCase());

    return Object.keys(TAG_PRESETS).filter((key) => {
      if (TAG_PRESETS[key].checkbox) return false; // exclus du dropdown
      if (selectedLower.includes(key.toLowerCase())) return false;
      if (!q) return true;
      return (
        key.toLowerCase().includes(q) ||
        (TAG_PRESETS[key].label || "").toLowerCase().includes(q)
      );
    });
  }

  function showDropdown() {
    if (!dropdownEl) return;

    // limite atteinte → pas de dropdown
    if (comboTagCount() >= MAX_COMBO_TAGS) {
      hideDropdown();
      return;
    }

    const query = comboInput?.value || "";
    const available = getAvailableKeys(query);

    dropdownEl.innerHTML = "";
    highlightIdx = -1;

    if (available.length === 0) {
      dropdownEl.classList.add("hidden");
      return;
    }

    available.forEach((key) => {
      const color = tagColor(key);
      const icon = tagIcon(key);
      const label = tagLabel(key);

      const opt = mk(
        "div",
        [
          "flex items-center gap-2.5 px-3 py-1.5 text-sm cursor-pointer",
          "hover:bg-zinc-100 dark:hover:bg-zinc-800",
          "transition-colors",
        ].join(" "),
      );
      opt.setAttribute("data-combo-option", key);
      opt.setAttribute("role", "option");

      if (icon) {
        const iconWrap = mk(
          "span",
          [
            "inline-flex items-center justify-center size-5 shrink-0 rounded",
            color.bg,
            color.text,
            color.darkBg,
            color.darkText,
          ].join(" "),
        );
        iconWrap.innerHTML = icon;
        opt.appendChild(iconWrap);
      } else {
        const dot = mk(
          "span",
          [
            "inline-block size-2.5 rounded-full shrink-0",
            color.bg,
            color.darkBg,
          ].join(" "),
        );
        opt.appendChild(dot);
      }

      const labelEl = mk("span", "dark:text-zinc-200");
      labelEl.textContent = label;
      opt.appendChild(labelEl);

      opt.addEventListener("mousedown", (e) => {
        e.preventDefault();
        addTag(key);
        if (comboInput) comboInput.value = "";
        showDropdown(); // réouvre avec la liste mise à jour
      });

      dropdownEl.appendChild(opt);
    });

    dropdownEl.classList.remove("hidden");
  }

  function hideDropdown() {
    if (!dropdownEl) return;
    dropdownEl.classList.add("hidden");
    highlightIdx = -1;
  }

  function highlightOption(idx) {
    if (!dropdownEl) return;
    const options = dropdownEl.querySelectorAll("[data-combo-option]");
    options.forEach((opt, i) => {
      opt.classList.toggle("bg-zinc-100", i === idx);
      opt.classList.toggle("dark:bg-zinc-800", i === idx);
    });
    highlightIdx = idx;
    if (options[idx]) options[idx].scrollIntoView({ block: "nearest" });
  }

  // ────────────────────────────────────────────────
  // Pills (tags non-checkbox uniquement)
  // ────────────────────────────────────────────────

  function renderPills() {
    if (!editorEl) return;
    const zone = editorEl.querySelector("[data-pill-zone]");
    if (!zone) return;

    zone.querySelectorAll("[data-tag-pill]").forEach((el) => el.remove());

    const displayTags = tags.filter((t) => !isCheckboxTag(t));
    const input = zone.querySelector("input[data-tag-input]");

    displayTags.forEach((key) => {
      zone.insertBefore(createPill(key), input);
    });

    if (input) {
      const atLimit = displayTags.length >= MAX_COMBO_TAGS;
      input.disabled = atLimit;
      input.placeholder = atLimit
        ? `${MAX_COMBO_TAGS} tags max`
        : displayTags.length
          ? "Ajouter…"
          : "Ajouter un tag…";
    }
  }

  function createPill(key) {
    const color = tagColor(key);
    const icon = tagIcon(key);
    const label = tagLabel(key);

    const pill = mk(
      "span",
      [
        "inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 text-xs font-medium rounded-full",
        "transition-colors",
        color.bg,
        color.text,
        color.darkBg,
        color.darkText,
      ].join(" "),
    );
    pill.setAttribute("data-tag-pill", key);

    if (icon) {
      const iconSpan = mk("span", "inline-flex items-center [&>svg]:size-3");
      iconSpan.innerHTML = icon;
      pill.appendChild(iconSpan);
    }

    const labelSpan = document.createElement("span");
    labelSpan.textContent = label;
    pill.appendChild(labelSpan);

    const btn = mk(
      "button",
      [
        "inline-flex items-center justify-center size-4 rounded-full",
        "hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer",
      ].join(" "),
    );
    btn.type = "button";
    btn.setAttribute("aria-label", `Supprimer le tag ${label}`);
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;

    const handler = (e) => {
      e.stopPropagation();
      removeTag(key);
    };
    btn.addEventListener("click", handler);
    cleanupFns.push(() => btn.removeEventListener("click", handler));

    pill.appendChild(btn);
    return pill;
  }

  function mk(tag, className) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    return e;
  }

  // ────────────────────────────────────────────────
  // Construction du widget
  // ────────────────────────────────────────────────

  function buildCheckboxRow(key) {
    const preset = TAG_PRESETS[key];
    const color = tagColor(key);

    const row = mk("div", "flex gap-2 items-center");
    const grid = mk("div", "group grid size-4 grid-cols-1");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = `tag-cb-${key}`;
    cb.name = key;
    cb.checked = hasTag(key);
    cb.className = [
      "col-start-1 row-start-1 appearance-none rounded-sm border",
      "border-zinc-200 bg-white",
      "dark:bg-zinc-950 dark:border-zinc-800 dark:text-zinc-950",
      "checked:border-indigo-600 checked:bg-indigo-600",
      "indeterminate:border-indigo-600 indeterminate:bg-indigo-600",
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600",
      "disabled:border-zinc-300 disabled:bg-zinc-100 disabled:checked:bg-zinc-100",
      "forced-colors:appearance-auto",
    ].join(" ");

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add(
      "pointer-events-none",
      "col-start-1",
      "row-start-1",
      "size-3.5",
      "self-center",
      "justify-self-center",
      "stroke-white",
      "dark:stroke-zinc-950",
      "group-has-disabled:stroke-gray-950/25",
    );
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M20 6 9 17l-5-5");
    svg.appendChild(path);

    grid.append(cb, svg);

    const label = mk("label", "text-sm select-none cursor-pointer");
    label.setAttribute("for", `tag-cb-${key}`);
    label.textContent = preset.label;

    row.append(grid, label);

    const handler = () => toggleCheckboxTag(key, cb.checked);
    cb.addEventListener("change", handler);
    cleanupFns.push(() => cb.removeEventListener("change", handler));

    checkboxes[key] = cb;

    return row;
  }

  function buildEditor() {
    editorEl = mk("div", "flex flex-1 gap-4");

    // ── 1) Checkboxes pour les tags marqués checkbox: true ──
    for (const key of CHECKBOX_KEYS) {
      editorEl.appendChild(buildCheckboxRow(key));
    }

    // ── 2) Combobox ──
    const comboWrapper = mk("div", "relative flex-1");

    const pillZone = mk(
      "div",
      [
        "flex flex-1 flex-wrap gap-1.5 items-center rounded-xl",
        "bg-zinc-100 dark:bg-zinc-900 px-3 py-2 text-sm",
        "cursor-text",
        "outline-none border border-transparent focus-within:outline-none focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-400/30",
      ].join(" "),
    );
    pillZone.setAttribute("data-pill-zone", "1");

    comboInput = document.createElement("input");
    comboInput.type = "text";
    comboInput.setAttribute("data-tag-input", "1");
    comboInput.setAttribute("role", "combobox");
    comboInput.setAttribute("aria-expanded", "false");
    comboInput.setAttribute("aria-haspopup", "listbox");
    comboInput.setAttribute("autocomplete", "off");
    comboInput.placeholder = "Ajouter un tag…";
    comboInput.className = [
      "text-sm bg-transparent outline-none min-w-[80px] flex-1",
      "placeholder:text-zinc-400 dark:placeholder:text-zinc-500",
      "dark:text-zinc-100",
    ].join(" ");
    pillZone.appendChild(comboInput);

    const zoneClick = () => comboInput.focus();
    pillZone.addEventListener("click", zoneClick);
    cleanupFns.push(() => pillZone.removeEventListener("click", zoneClick));

    dropdownEl = mk(
      "div",
      [
        "hidden absolute left-0 right-0 mt-1 z-50",
        "max-h-48 overflow-y-auto",
        "rounded-lg border border-zinc-200 dark:border-zinc-700",
        "bg-white dark:bg-zinc-900",
        "shadow-lg py-1",
      ].join(" "),
    );
    dropdownEl.setAttribute("role", "listbox");

    const onInput = () => {
      showDropdown();
      comboInput.setAttribute(
        "aria-expanded",
        !dropdownEl.classList.contains("hidden") ? "true" : "false",
      );
    };
    comboInput.addEventListener("input", onInput);
    cleanupFns.push(() => comboInput.removeEventListener("input", onInput));

    const onFocus = () => showDropdown();
    comboInput.addEventListener("focus", onFocus);
    cleanupFns.push(() => comboInput.removeEventListener("focus", onFocus));

    const onBlur = () => setTimeout(() => hideDropdown(), 150);
    comboInput.addEventListener("blur", onBlur);
    cleanupFns.push(() => comboInput.removeEventListener("blur", onBlur));

    const onKeydown = (e) => {
      const options = dropdownEl.querySelectorAll("[data-combo-option]");
      const isOpen = !dropdownEl.classList.contains("hidden");

      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (!isOpen) {
          showDropdown();
          return;
        }
        highlightOption(
          highlightIdx + 1 < options.length ? highlightIdx + 1 : 0,
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (!isOpen) return;
        highlightOption(
          highlightIdx - 1 >= 0 ? highlightIdx - 1 : options.length - 1,
        );
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (isOpen && highlightIdx >= 0 && options[highlightIdx]) {
          addTag(options[highlightIdx].getAttribute("data-combo-option"));
          comboInput.value = "";
          showDropdown(); // réouvre avec la liste mise à jour
        }
        return;
      }
      if (e.key === "Escape") {
        hideDropdown();
        return;
      }
      if (e.key === "Backspace" && !comboInput.value) {
        const display = tags.filter((t) => !isCheckboxTag(t));
        if (display.length) removeTag(display[display.length - 1]);
      }
    };
    comboInput.addEventListener("keydown", onKeydown);
    cleanupFns.push(() => comboInput.removeEventListener("keydown", onKeydown));

    comboWrapper.append(pillZone, dropdownEl);
    editorEl.appendChild(comboWrapper);

    return editorEl;
  }

  // ────────────────────────────────────────────────
  // attach / detach
  // ────────────────────────────────────────────────

  function attach(root = document) {
    if (isActive) return;

    subjectInput = root.querySelector('input[name="subject"]');
    containerEl = root.querySelector("#tag-editor");
    if (!containerEl || !subjectInput) return;

    const parsed = parseSubject(subjectInput.value);
    baseTitle = parsed.base;
    tags = [...parsed.tags];
    subjectInput.value = buildSubject();

    const inputHandler = () => {
      const p = parseSubject(subjectInput.value);
      baseTitle = p.base;
      tags = [...p.tags];
      syncCheckboxes();
      renderPills();
      if (changeCb) changeCb(buildSubject(), [...tags]);
    };
    subjectInput.addEventListener("input", inputHandler);
    cleanupFns.push(() =>
      subjectInput.removeEventListener("input", inputHandler),
    );

    containerEl.innerHTML = "";
    containerEl.appendChild(buildEditor());
    renderPills();

    isActive = true;
    console.debug(
      "[TagEditor] attaché —",
      tags.length,
      "tag(s),",
      Object.keys(TAG_PRESETS).length,
      "prédéfinis",
    );
  }

  function detach() {
    if (!isActive) return;

    cleanupFns.forEach((fn) => fn());
    cleanupFns = [];

    if (editorEl) {
      editorEl.remove();
      editorEl = null;
    }
    dropdownEl = null;
    comboInput = null;
    checkboxes = {};
    subjectInput = null;
    containerEl = null;
    tags = [];
    baseTitle = "";
    highlightIdx = -1;
    isActive = false;

    console.debug("[TagEditor] détaché");
  }

  function onChange(cb) {
    changeCb = cb;
  }

  return {
    attach,
    detach,
    onChange,
    isActive: () => isActive,
    addTag,
    removeTag,
    getTags: () => [...tags],
    getSubject: buildSubject,
  };
})();
