// src/features/prism.js
import Prism from "prismjs";

// Langs (important: markup-templating avant php)
import "prismjs/components/prism-markup";
import "prismjs/components/prism-markup-templating";
import "prismjs/components/prism-css";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-php";

function extractCodeText(codeEl) {
  const html = codeEl.innerHTML ?? "";

  // Reconstruit le texte si le forum injecte <br>, &nbsp;, spans...
  if (/<br\s*\/?>/i.test(html) || /&nbsp;|<span\b|<div\b/i.test(html)) {
    const tmp = document.createElement("div");
    tmp.innerHTML = html.replace(/<br\s*\/?>/gi, "\n");
    return (tmp.textContent ?? "").replace(/\u00A0/g, " ").trimEnd();
  }

  return (codeEl.textContent ?? "").replace(/\u00A0/g, " ").trimEnd();
}

/**
 * Détection "au contenu" -> renvoie un id Prism :
 * - markup (HTML)
 * - php
 * - css
 * - javascript
 * - text (fallback)
 */
function detectPrismLang(code) {
  const s = (code || "").trim();
  if (!s) return "text";

  // PHP fort (balises)
  if (/<\?(php|=)?/i.test(s) && !/<\?xml/i.test(s)) return "php";

  // CSS très reconnaissable : "prop: value;" + blocs { }
  const cssPropHits = (s.match(/\b[a-z-]+\s*:\s*[^;{}\n]+;/gi) || []).length;
  const cssScore =
    (cssPropHits >= 2 ? 5 : cssPropHits === 1 ? 2 : 0) +
    (/@(media|supports|keyframes|import)\b/i.test(s) ? 2 : 0) +
    (/[.#][\w-]+\s*(,|\{|:)/.test(s) ? 1 : 0) +
    (/{[\s\S]*}/.test(s) ? 1 : 0);

  // HTML/markup (tags, doctype, attributs)
  const tagHits = (s.match(/<\/?[a-z][\w:-]*(\s+[^>]+)?>/gi) || []).length;
  const htmlScore =
    (/<\!doctype\s+html/i.test(s) ? 6 : 0) +
    (tagHits >= 2 ? 4 : tagHits === 1 ? 2 : 0) +
    (/\b(class|id|href|src|data-)\s*=/.test(s) ? 2 : 0);

  // JS (mots-clés + patterns)
  const jsScore =
    (/\b(const|let|var|function|return|class|new|throw|try|catch|await|async)\b/.test(
      s,
    )
      ? 3
      : 0) +
    (/\b(import|export|from)\b/.test(s) ? 3 : 0) +
    (/=>/.test(s) ? 2 : 0) +
    (/\b(document|window|console|fetch|JSON)\b/.test(s) ? 2 : 0);

  // PHP sans balises (moins fort, mais utile)
  const phpScore =
    (/\$\w+/.test(s) ? 2 : 0) +
    (/\b(namespace|use|function|public|private|protected|echo|foreach|elseif)\b/i.test(
      s,
    )
      ? 2
      : 0) +
    (/->|::/.test(s) ? 2 : 0);

  // Choix par score
  const candidates = [
    ["php", phpScore],
    ["markup", htmlScore],
    ["css", cssScore],
    ["javascript", jsScore],
  ].sort((a, b) => b[1] - a[1]);

  const [best, score] = candidates[0];
  return score >= 3 ? best : "text";
}

function guessLangFromEl(codeEl, codeText) {
  // 1) data-lang explicite
  const dl = codeEl.getAttribute("data-lang");
  if (dl) return normalizeLang(dl);

  // 2) class language-xxx / lang-xxx
  const cls = codeEl.className || "";
  const m =
    cls.match(/\blanguage-([a-z0-9#+.-]+)\b/i) ||
    cls.match(/\blang-([a-z0-9#+.-]+)\b/i);
  if (m?.[1]) return normalizeLang(m[1]);

  // 3) contenu
  return detectPrismLang(codeText);
}

function normalizeLang(v) {
  const x = String(v || "")
    .trim()
    .toLowerCase();
  if (x === "html") return "markup";
  if (x === "js") return "javascript";
  return x || "text";
}

function ensurePreWrapper(codeEl, lang) {
  // Prism aime bien <pre><code class="language-...">
  let pre = codeEl.closest("pre");
  if (!pre) {
    pre = document.createElement("pre");
    // conserve ton hook .codebox .code : on garde la classe .code sur codeEl
    codeEl.replaceWith(pre);
    pre.appendChild(codeEl);
  }
  pre.classList.add(`language-${lang}`);
  return pre;
}

function copyText(text) {
  const t = String(text ?? "");

  // Voie moderne (HTTPS + permissions)
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(t);
  }

  // Fallback (anciennes contraintes)
  return new Promise((resolve, reject) => {
    const ta = document.createElement("textarea");
    ta.value = t;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try {
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error("copy failed"));
    } catch (e) {
      document.body.removeChild(ta);
      reject(e);
    }
  });
}

export function prependCopyButton(root = document) {
  const codes = Array.from(
    root.querySelectorAll('.codebox code.code:not([data-copybtn="1"])'),
  );
  const copyHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3 lucide lucide-copy-icon lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
  const copyCheckHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3 h-3 lucide lucide-copy-check-icon lucide-copy-check"><path d="m12 15 2 2 4-4"/><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;

  for (const code of codes) {
    code.setAttribute("data-copybtn", "1");

    const host = code.closest("pre") || code.parentElement || code;

    // évite doublon si déjà présent
    if (host.querySelector(':scope > button[data-role="copy-code"]')) continue;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("data-role", "copy-code");
    btn.className =
      "text-zinc-800 dark:text-zinc-200 p-1 rounded-md text-inherit bg-white dark:bg-zinc-700 text-xs shadow-sm right-4 top-4 absolute";
    btn.innerHTML = copyHTML;

    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const text = code.textContent || "";
      try {
        await copyText(text);
        btn.innerHTML = copyCheckHTML;
        setTimeout(() => (btn.innerHTML = copyHTML), 900);
      } catch {
        btn.innerHTML = "Erreur";
        setTimeout(() => (btn.innerHTML = copyHTML), 1200);
      }
    });

    host.prepend(btn);
  }
}

export function initPrism(root = document) {
  const blocks = Array.from(
    root.querySelectorAll('.codebox code:not([data-prism="1"])'),
  );
  if (!blocks.length) return;

  for (const codeEl of blocks) {
    const code = extractCodeText(codeEl);
    const lang = guessLangFromEl(codeEl, code);

    // Normalise le contenu en texte pur (évite que Prism parse du HTML)
    codeEl.textContent = code;

    // classes Prism
    codeEl.classList.add("code", `language-${lang}`);
    ensurePreWrapper(codeEl, lang);

    codeEl.setAttribute("data-prism", "1");
    codeEl.parentElement.classList.add(
      "relative",
      "border",
      "border-zinc-300",
      "dark:border-zinc-700",
    );
    Prism.highlightElement(codeEl);
    prependCopyButton(codeEl.parentElement);
  }
}

/**
 * Variante dédiée aux blocs générés par marked (via renderMarkdown).
 * marked produit déjà un <pre class="codebox"><code class="language-xxx">
 * propre — pas besoin de reconstruction HTML ni de détection lourde.
 */
export function initPrismMarkdown(root = document) {
  const blocks = Array.from(
    root.querySelectorAll('pre > code:not([data-prism="1"])'),
  );
  if (!blocks.length) return;

  for (const codeEl of blocks) {
    // marked génère du texte propre, pas de <br>/&nbsp; à reconstruire
    const code = (codeEl.textContent ?? "").replace(/\u00A0/g, " ").trimEnd();
    const lang = guessLangFromEl(codeEl, code);

    // Remet le contenu en texte pur avant highlight
    codeEl.textContent = code;
    codeEl.classList.add("code", `language-${lang}`);

    const pre = codeEl.closest("pre");
    pre.classList.add(
      `language-${lang}`,
      "relative",
      "border",
      "border-zinc-300",
      "dark:border-zinc-700",
    );

    // Marque avant highlight pour éviter tout double-traitement
    codeEl.setAttribute("data-prism", "1");
    Prism.highlightElement(codeEl);
    prependCopyButton(pre);
  }
}
