// bbcode-editor.mjs

/**
 * Module BBCode qui expose un objet editor avec ses méthodes
 * + gestion attach/detach pour Barba.js
 */
export const BBcodeEditor = (function () {
  // Variables privées (closure)
  let textarea = null;
  let toolbar;
  let cleanupFns = [];
  let isActive = false;

  // ────────────────────────────────────────────────
  // Méthodes d’insertion (stockées dans l’objet editor)
  // ────────────────────────────────────────────────
  const editor = {
    insertText(startText, endText = "") {
      if (!textarea) return;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selected = textarea.value.slice(start, end);

      textarea.value =
        textarea.value.slice(0, start) +
        startText +
        selected +
        endText +
        textarea.value.slice(end);

      const newPos = start + startText.length + selected.length;
      textarea.setSelectionRange(newPos, newPos);
      textarea.focus();
    },

    wrap(tag) {
      this.insertText(`[${tag}]`, `[/${tag}]`);
    },

    bold() {
      this.wrap("b");
    },
    italic() {
      this.wrap("i");
    },
    underline() {
      this.wrap("u");
    },
    strike() {
      this.wrap("s");
    },

    left() {
      this.wrap("left");
    },
    center() {
      this.wrap("center");
    },
    right() {
      this.wrap("right");
    },
    justify() {
      this.wrap("justify");
    },

    quote() {
      this.wrap("quote");
    },
    code() {
      this.wrap("code");
    },

    list() {
      if (!textarea) return;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      let selected = textarea.value.slice(start, end);

      if (!selected.trim()) {
        this.insertText("[list]\n[*] ", "\n[/list]");
        return;
      }

      const lines = selected.split("\n");
      const bulleted = lines
        .map((line) => (line.trim() ? "[*] " + line.trim() : line))
        .join("\n");

      textarea.value =
        textarea.value.slice(0, start) +
        "[list]\n" +
        bulleted +
        "\n[/list]" +
        textarea.value.slice(end);

      textarea.setSelectionRange(start + 7, start + 7 + bulleted.length);
      textarea.focus();
    },

    image() {
      if (!textarea) return;
      const url = prompt("URL complète de l'image :", "https://")?.trim();
      if (!url || url === "https://") return;
      this.insertText(`[img]${url}[/img]`);
    },

    link() {
      if (!textarea) return;
      const url = prompt("URL du lien :", "https://")?.trim();
      if (!url || url === "https://") return;

      const selected = textarea.value.slice(
        textarea.selectionStart,
        textarea.selectionEnd,
      );

      if (selected.trim()) {
        this.insertText(`[url=${url}]`, "[/url]");
      } else {
        this.insertText(`[url=${url}]`, "[/url]");
      }
    },
  };

  // ────────────────────────────────────────────────
  // Mapping title → méthode de l’objet editor
  // ────────────────────────────────────────────────
  const titleToMethodName = {
    Gras: "bold",
    Italique: "italic",
    Souligné: "underline",
    Barré: "strike",

    "Aligné à gauche": "left",
    Centré: "center",
    "Aligné à droite": "right",
    Justifié: "justify",

    "Liste à puces": "list",
    Citation: "quote",
    Code: "code",

    "Insérer une image": "image",
    "Insérer un lien": "link",
  };

  // ────────────────────────────────────────────────
  // Attachement / Détachement
  // ────────────────────────────────────────────────
  function attach(container = document) {
    if (isActive) return;

    textarea = container.querySelector(".bbcode-textarea");
    toolbar = container.querySelector(".bbcode-toolbar");
    if (!textarea || !toolbar) return;

    // 1. Attacher les boutons via title
    toolbar.querySelectorAll("button[title]").forEach((btn) => {
      const title = btn.getAttribute("title");
      const methodName = titleToMethodName[title];
      if (methodName && typeof editor[methodName] === "function") {
        const handler = (e) => {
          e.preventDefault();
          editor[methodName]();
        };
        btn.addEventListener("click", handler);
        cleanupFns.push(() => btn.removeEventListener("click", handler));
      }
    });

    // 2. Raccourcis clavier
    const keydownHandler = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const key = e.key.toLowerCase();

      if (key === "b") {
        e.preventDefault();
        editor.bold();
      }
      if (key === "i") {
        e.preventDefault();
        editor.italic();
      }
      if (key === "u") {
        e.preventDefault();
        editor.underline();
      }
      if (key === "k") {
        e.preventDefault();
        editor.link();
      }
      // ← ajoute ici d’autres raccourcis si désiré
    };

    textarea.addEventListener("keydown", keydownHandler);
    cleanupFns.push(() =>
      textarea.removeEventListener("keydown", keydownHandler),
    );

    isActive = true;
    console.debug("[BBCode] attaché");
  }

  function detach() {
    if (!isActive) return;

    cleanupFns.reverse().forEach((fn) => fn());
    cleanupFns = [];

    textarea = null;
    toolbar = null;
    isActive = false;

    console.debug("[BBCode] détaché");
  }

  // ────────────────────────────────────────────────
  // API publique exposée
  // ────────────────────────────────────────────────
  return {
    // L’objet contenant toutes les méthodes d’édition
    editor,

    // Gestion du cycle de vie (Barba.js friendly)
    attach,
    detach,

    // État
    isActive: () => isActive,
  };
})();
