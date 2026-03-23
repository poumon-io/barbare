export const initSearch = () => {
  const DEBOUNCE = 280;

  /* ── style block — only what Tailwind can't do inline ── */
  const style = document.createElement("style");
  style.textContent = `
    #srch-overlay { opacity: 0; pointer-events: none; transition: opacity .15s ease; }
    #srch-overlay.open { opacity: 1; pointer-events: auto; }

    #srch-palette { opacity: 0; pointer-events: none; transform: translateX(-50%) translateY(-6px) scale(.98); transition: opacity .15s ease, transform .15s ease; }
    #srch-palette.open { opacity: 1; pointer-events: auto; transform: translateX(-50%) translateY(0) scale(1); }

    #srch-mirror::placeholder { color: #a1a1aa; }
    .dark #srch-mirror::placeholder { color: #71717a; }

    #srch-results::-webkit-scrollbar { width: 4px; }
    #srch-results::-webkit-scrollbar-thumb { background: #e4e4e7; border-radius: 4px; }
    .dark #srch-results::-webkit-scrollbar-thumb { background: #27272a; }

    .srch-item-title em { font-style: normal; background: #e4e4e7; color: #18181b; border-radius: 3px; padding: 0 2px; }
    .dark .srch-item-title em { background: #3f3f46; color: #fafafa; }

    .srch-active { background: #f4f4f5; }
    .dark .srch-active { background: #27272a; }
  `;
  document.head.appendChild(style);

  /* ── overlay ── */
  const overlay = document.createElement("div");
  overlay.id = "srch-overlay";
  overlay.className = "fixed inset-0 z-[9998] bg-black/50";

  /* ── palette ── */
  const palette = document.createElement("div");
  palette.id = "srch-palette";
  palette.setAttribute("role", "dialog");
  palette.setAttribute("aria-modal", "true");
  palette.setAttribute("aria-label", "Recherche rapide");
  palette.className = [
    "fixed top-[20vh] left-1/2 z-[9999]",
    "w-full max-w-[560px] mx-[4vw]",
    "bg-white dark:bg-zinc-950",
    "border border-zinc-200 dark:border-zinc-800",
    "rounded-xl overflow-hidden font-sans text-[13px]",
    "shadow-xl dark:shadow-[0_8px_32px_rgba(0,0,0,.6)]",
  ].join(" ");

  const SVG_SEARCH = `<svg class="shrink-0 text-zinc-400 dark:text-zinc-500" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
  const SVG_TOPIC = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;

  palette.innerHTML = `
    <div class="flex items-center gap-2 px-3.5 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
      ${SVG_SEARCH}
      <input id="srch-mirror" type="text" placeholder="Rechercher…" autocomplete="off" spellcheck="false"
        aria-autocomplete="list" aria-controls="srch-results"
        class="flex-1 bg-transparent border-none outline-none text-zinc-900 dark:text-zinc-100 font-[inherit] text-[13px] leading-normal caret-indigo-500">
    </div>

    <div id="srch-status"
      class="flex items-center gap-1.5 px-3.5 py-1.5 text-[11px] text-zinc-500 border-b border-zinc-200 dark:border-zinc-800 min-h-[27px] bg-white dark:bg-zinc-950">
    </div>

    <div id="srch-results" role="listbox"
      class="max-h-[360px] overflow-y-auto p-1 bg-white dark:bg-zinc-950 [scrollbar-width:thin] [scrollbar-color:#e4e4e7_transparent] dark:[scrollbar-color:#27272a_transparent]">
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(palette);

  const mirror = palette.querySelector("#srch-mirror");
  const status = palette.querySelector("#srch-status");
  const results = palette.querySelector("#srch-results");

  /* ── state ── */
  let activeIdx = -1;
  let debounceTimer = null;
  let lastQuery = "";
  let items = [];
  const showResults = "topics";

  /* ── open / close ── */
  const open = () => {
    overlay.classList.add("open");
    palette.classList.add("open");
    mirror.value = "";
    mirror.focus();
    setStatus("Tapez pour rechercher…");
    results.innerHTML = "";
    activeIdx = -1;
    items = [];
    lastQuery = "";
    document.body.style.overflow = "hidden";
  };

  const close = () => {
    overlay.classList.remove("open");
    palette.classList.remove("open");
    document.getElementById("js-search")?.blur();
    document.body.style.overflow = "";
  };

  /* ── status ── */
  const setStatus = (msg, loading = false) => {
    status.innerHTML = loading
      ? `<span class="inline-block w-2.5 h-2.5 rounded-full border-[1.5px] border-zinc-300 dark:border-zinc-700 border-t-indigo-500 animate-spin shrink-0"></span><span>${msg}</span>`
      : `<span>${msg}</span>`;
  };

  /* ── highlight ── */
  const highlight = (text, query) => {
    if (!query || !text) return text ?? "";
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return text.replace(new RegExp(`(${escaped})`, "gi"), "<em>$1</em>");
  };

  /* ── keyboard nav ── */
  const setActive = (idx) => {
    items.forEach((el, i) => {
      el.classList.toggle("srch-active", i === idx);
      el.setAttribute("aria-selected", i === idx ? "true" : "false");
    });
    activeIdx = idx;
    items[idx]?.scrollIntoView({ block: "nearest" });
  };

  /* ── render ── */
  const renderResults = (entries, query, mode) => {
    results.innerHTML = "";
    items = [];
    activeIdx = -1;

    if (!entries.length) {
      results.innerHTML = `
        <div class="py-7 px-3.5 text-center text-zinc-400 dark:text-zinc-500 text-[13px] leading-relaxed">
          <div class="flex justify-center mb-2 text-zinc-300 dark:text-zinc-700">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </div>
          Aucun résultat pour <strong class="text-zinc-600 dark:text-zinc-300">${query}</strong>
        </div>`;
      setStatus("Aucun résultat");
      return;
    }

    const count = entries.length;
    const label =
      mode === "topics"
        ? `sujet${count > 1 ? "s" : ""}`
        : `message${count > 1 ? "s" : ""}`;
    const icon = mode === "topics" ? SVG_TOPIC : SVG_POST;

    setStatus(`${count} ${label} trouvé${count > 1 ? "s" : ""}`);

    const section = document.createElement("div");
    section.className =
      "px-2.5 pt-2 pb-1 text-[10px] tracking-[.06em] uppercase text-zinc-400 dark:text-zinc-600 font-medium";
    section.textContent = mode === "topics" ? "Sujets" : "Messages";
    results.appendChild(section);

    entries.forEach((entry, i) => {
      const a = document.createElement("a");
      a.className = [
        "flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg",
        "cursor-pointer no-underline text-inherit transition-colors",
        "hover:bg-zinc-100 dark:hover:bg-zinc-800",
      ].join(" ");
      a.href = entry.url;
      a.setAttribute("role", "option");
      a.setAttribute("aria-selected", "false");
      a.innerHTML = `
        <span class="shrink-0 text-zinc-400 dark:text-zinc-600 flex items-center">${icon}</span>
        <span class="flex-1 min-w-0">
          <span class="srch-item-title block text-[13px] text-zinc-700 dark:text-zinc-200 truncate">${highlight(entry.title, query)}</span>
        </span>
        <svg class="shrink-0 text-zinc-300 dark:text-zinc-700" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
      `;
      a.addEventListener("click", () => close());
      a.addEventListener("mouseenter", () => setActive(i));
      results.appendChild(a);
      items.push(a);
    });
  };

  /* ── parse ── */
  const parseEntries = (doc) => {
    const seen = new Set();
    return Array.from(doc.querySelectorAll("a[href^='/t']")).reduce(
      (acc, el) => {
        const title = el.textContent.trim();
        const href = el.getAttribute("href");
        if (title && href && !seen.has(href)) {
          seen.add(href);
          acc.push({ title, url: href });
        }
        return acc;
      },
      [],
    );
  };

  /* ── fetch ── */
  const search = async (query, mode) => {
    if (!query.trim()) {
      results.innerHTML = "";
      setStatus("Tapez pour rechercher…");
      return;
    }
    if (query.trim().length < 4) {
      results.innerHTML = "";
      setStatus("Entrez au moins 4 caractères…");
      return;
    }

    setStatus("Recherche…", true);

    const url =
      `/search?mode=searchbox&search_by=text` +
      `&search_keywords=${encodeURIComponent(query)}` +
      `&show_results=${mode}`;

    try {
      const resp = await fetch(url, { credentials: "same-origin" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const doc = new DOMParser().parseFromString(
        await resp.text(),
        "text/html",
      );
      renderResults(parseEntries(doc).slice(0, 15), query, mode);
    } catch (err) {
      setStatus("Erreur lors de la recherche");
      console.warn("[srch-combobox]", err);
    }
  };

  /* ── debounce ── */
  const triggerSearch = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(
      () => search(mirror.value, showResults),
      DEBOUNCE,
    );
  };

  /* ── events ── */
  mirror.addEventListener("input", triggerSearch);

  mirror.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(activeIdx + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(activeIdx - 1, 0));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      items[activeIdx]?.click();
    } else if (e.key === "Escape") {
      close();
    }
  });

  document.getElementById("js-search")?.addEventListener("focus", () => open());
  overlay.addEventListener("click", () => close());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && palette.classList.contains("open")) close();
  });
};
