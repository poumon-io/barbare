import { getEmojis } from "unicode-emoji";
import { marked } from "marked";
import { initPrismMarkdown } from "../features/prism.js";

export const initChat = (supabase) => {
  const {
    createApp,
    ref,
    reactive,
    computed,
    onMounted,
    nextTick,
    onBeforeUnmount,
    watch,
  } = Vue;

  // ----------------------------
  // CONFIG
  // ----------------------------
  const PAGE_SIZE = 50;
  const SCROLL_TOP_THRESHOLD_PX = 60;

  const PRESENCE_PAGE_KEY = "forumactif-chat";
  const ACTIVE_MINUTES = 8;
  const PRESENCE_PING_MS = 45_000;
  const MAX_STACK = 4;

  // ----------------------------
  // HELPERS
  // ----------------------------
  const normalize = (s) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .trim();

  const safeUrl = (u) => {
    if (!u) return "";
    try {
      const url = new URL(u, window.location.href);
      return url.protocol === "http:" || url.protocol === "https:"
        ? url.href
        : "";
    } catch {
      return "";
    }
  };

  // ----------------------------
  // MARKDOWN RENDERER
  // ----------------------------
  // Attend que marked soit disponible (chargé via <script> dans le HTML)
  const renderMarkdown = (() => {
    // Balises HTML autorisées dans les messages
    const ALLOWED_TAGS = new Set([
      "b",
      "strong",
      "i",
      "em",
      "u",
      "s",
      "del",
      "code",
      "pre",
      "a",
      "br",
      "ul",
      "ol",
      "li",
      "blockquote",
      "p",
      "span",
      "h1",
      "h2",
      "h3",
    ]);

    // Attributs autorisés par balise
    // — pre/code : on conserve "class" pour que Prism puisse lire language-xxx
    const ALLOWED_ATTRS = {
      a: ["href", "title", "target", "rel"],
      pre: ["class"],
      code: ["class", "data-lang"],
    };

    // Sanitisation : retire balises et attributs non autorisés
    const sanitize = (html) => {
      const div = document.createElement("div");
      div.innerHTML = html;

      const walk = (node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        const tag = node.tagName.toLowerCase();

        // ✅ si tag non autorisé : unwrap (conserve les enfants) au lieu de remplacer par du texte
        if (!ALLOWED_TAGS.has(tag)) {
          const parent = node.parentNode;
          if (!parent) return;

          // insère tous les enfants avant le node
          while (node.firstChild) parent.insertBefore(node.firstChild, node);

          // supprime le wrapper interdit
          parent.removeChild(node);
          return;
        }

        // ✅ tag autorisé : filtre les attributs
        const allowed = ALLOWED_ATTRS[tag] || [];
        for (const attr of [...node.attributes]) {
          if (!allowed.includes(attr.name)) node.removeAttribute(attr.name);
        }

        if (tag === "a") {
          node.setAttribute("target", "_blank");
          node.setAttribute("rel", "noopener noreferrer");
          const href = node.getAttribute("href") || "";
          if (!safeUrl(href)) node.removeAttribute("href");
        }

        // ✅ ajoute codebox sur pre
        if (tag === "pre") node.classList.add("codebox");

        // continue à descendre
        for (const child of [...node.childNodes]) walk(child);
      };

      for (const child of [...div.childNodes]) walk(child);
      return div.innerHTML;
    };

    return (text) => {
      if (!text) return "";
      const s = String(text);

      if (typeof marked === "undefined") {
        const div = document.createElement("div");
        div.textContent = s;
        return div.innerHTML;
      }

      try {
        const html = marked.parse(s, {
          breaks: true,
          gfm: true,
          mangle: false,
          headerIds: false,
        });
        return sanitize(html);
      } catch {
        const div = document.createElement("div");
        div.textContent = s;
        return div.innerHTML;
      }
    };
  })();

  const readUserdata = () => {
    const ud = window._userdata || {};

    const txt = (v, fallback) => {
      if (typeof v !== "string") return fallback;
      const d = document.createElement("div");
      d.innerHTML = v;
      return (d.textContent || "").trim() || fallback;
    };

    const avatar = (v) => {
      if (!v || typeof v !== "string") return "";
      if (v.includes("<img")) {
        const d = document.createElement("div");
        d.innerHTML = v;
        return d.querySelector("img")?.getAttribute("src") || "";
      }
      return v;
    };

    const rawId = ud.user_id ?? ud.userId ?? ud.id ?? ud.userid ?? ud.uid ?? "";
    const externalId = String(rawId ?? "").trim();

    const username = txt(
      ud.username ?? ud.user_name ?? ud.name ?? "",
      "Invité",
    );
    const avatarUrl = avatar(
      ud.avatar ?? ud.user_avatar ?? ud.avatar_url ?? "",
    );

    const rawLevel = ud.user_level ?? ud.userlevel ?? ud.level ?? "";
    const userLevel = Number(String(rawLevel).trim() || "0");
    const isAdmin = userLevel === 1;

    const canWrite =
      externalId !== "" && externalId !== "0" && externalId !== "-1";
    return { externalId, username, avatarUrl, canWrite, isAdmin };
  };

  const timeAgo = (() => {
    const rtf = new Intl.RelativeTimeFormat("fr-CA", { numeric: "auto" });
    const units = [
      ["year", 31536000],
      ["month", 2592000],
      ["day", 86400],
      ["hour", 3600],
      ["minute", 60],
      ["second", 1],
    ];
    return (iso) => {
      const d = new Date(iso);
      const t = d.getTime();
      if (Number.isNaN(t)) return "";
      const diff = Math.round((t - Date.now()) / 1000);
      const abs = Math.abs(diff);
      for (const [unit, sec] of units) {
        if (abs >= sec || unit === "second") {
          const value = Math.round(diff / sec);
          return rtf.format(value, unit);
        }
      }
      return "";
    };
  })();

  // Anti double-mount (Barba)
  try {
    window.__faChatUnmount?.();
  } catch {}
  window.__faChatUnmount = null;

  let roomsChannel = null;
  let messagesChannel = null;
  let presenceChannel = null;

  let presenceTimer = null;
  let presenceCleanupTimer = null;

  const app = createApp({
    setup() {
      const me = reactive(readUserdata());
      me.avatarUrl = safeUrl(me.avatarUrl);

      // ----------------------------
      // UI STATE
      // ----------------------------
      const ui = reactive({
        booting: true,
        open: true,
        showCreate: false,
        loadingRooms: true,
        loadingMessages: true,
        loadingOlder: false,
        creatingRoom: false,
        sending: false,
      });

      // ----------------------------
      // DATA
      // ----------------------------
      const rooms = ref([]);
      const adminRooms = ref([]);
      const autoRoom = ref(null);

      const roomId = ref(null);
      const messages = ref([]);

      const draft = ref("");
      const draftEl = ref(null);

      const messagesEl = ref(null);

      const newRoomName = ref("");
      const error = ref("");

      // cache des messages par room (référence vers le tableau affiché si room active)
      const messagesCache = new Map(); // rid -> Array

      // paging state par room
      const paging = new Map(); // rid -> { oldestId: number|null, hasMore: boolean }
      const getPaging = (rid) => {
        const k = String(rid);
        let s = paging.get(k);
        if (!s) {
          s = { oldestId: null, hasMore: true };
          paging.set(k, s);
        }
        return s;
      };

      // Déduplication (double subscription / reconnect)
      const seenIdsByRoom = new Map(); // rid -> Set<number>
      const getSeenSet = (rid) => {
        const key = String(rid);
        let s = seenIdsByRoom.get(key);
        if (!s) {
          s = new Set();
          seenIdsByRoom.set(key, s);
        }
        return s;
      };

      // message local optimiste (remplacé par Realtime)
      const pendingLocalByRoom = new Map(); // rid -> { tempId, content, at }

      // ----------------------------
      // EDIT MESSAGE (Discord-like)
      // ----------------------------
      // 1 édition à la fois (dans la room active)
      const edit = reactive({ id: null, room_id: null, text: "" });
      const editEl = ref(null);

      const isEditing = (m) =>
        edit.id != null && String(m?.id) === String(edit.id);

      const resizeEdit = () => {
        const el = editEl.value;
        if (!el) return;

        el.style.height = "auto";
        const cs = window.getComputedStyle(el);
        const lineHeight = parseFloat(cs.lineHeight) || 20;
        const paddingTop = parseFloat(cs.paddingTop) || 0;
        const paddingBottom = parseFloat(cs.paddingBottom) || 0;
        const maxHeight = lineHeight * 3 + paddingTop + paddingBottom;

        const next = Math.min(el.scrollHeight, maxHeight);
        el.style.height = `${next}px`;
        el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
      };

      const focusDraft = () => {
        draftEl.value?.focus({ preventScroll: true });
      };

      const cancelEdit = async () => {
        edit.id = null;
        edit.room_id = null;
        edit.text = "";
        await nextTick();
        focusDraft();
      };

      // Démarre l'édition d'un message précis (réutilisable depuis le bouton ou le raccourci clavier)
      const startEditMessage = async (m) => {
        if (!me.canWrite) return;
        if (!roomId.value) return;
        if (!m) return;

        // Refuse les messages locaux/optimistes (id non numérique)
        const n = Number(m.id);
        if (!Number.isFinite(n)) return;

        // Seul l'auteur peut éditer son message
        if (m.external_user_id !== me.externalId) return;

        edit.id = m.id;
        edit.room_id = roomId.value;
        edit.text = String(m.content || "");

        await nextTick();
        await nextTick();

        const textarea = editEl.value;
        if (!textarea || textarea.tagName?.toUpperCase() !== "TEXTAREA") return;

        try {
          textarea.focus({ preventScroll: true });
          const len = textarea.value.length;
          textarea.setSelectionRange(len, len);
        } catch (err) {
          console.error("Erreur focus/selection :", err);
        }

        resizeEdit();
      };

      const startEditLastMine = async () => {
        if (edit.id != null) return;
        if (draft.value.trim().length !== 0) return;

        // Recherche du dernier message de l'utilisateur courant
        let target = null;
        for (let i = messages.value.length - 1; i >= 0; i--) {
          const m = messages.value[i];
          if (!m) continue;
          if (m.external_user_id !== me.externalId) continue;
          const n = Number(m.id);
          if (!Number.isFinite(n)) continue;
          target = m;
          break;
        }
        if (!target) return;

        await startEditMessage(target);
      };

      const saveEdit = async () => {
        if (edit.id == null) return;
        if (!me.canWrite) return;

        // si on a changé de room pendant l'édition
        if (String(edit.room_id) !== String(roomId.value)) return cancelEdit();

        const newText = String(edit.text || "").trimEnd();
        if (newText.length === 0) return; // refuse vide

        const idx = messages.value.findIndex(
          (m) => String(m?.id) === String(edit.id),
        );
        const cur = idx >= 0 ? messages.value[idx] : null;

        if (cur && String(cur.content || "") === newText) {
          return cancelEdit(); // rien n'a changé
        }

        // Optimiste UI (la realtime UPDATE recadrera si besoin)
        if (idx >= 0) {
          messages.value[idx] = {
            ...messages.value[idx],
            content: newText,
            _edited: true,
          };
        }

        const { error: e } = await supabase
          .from("chat_messages")
          .update({ content: newText })
          .eq("id", edit.id);

        if (e) {
          error.value = `Modifier: ${e.message}`;
          return;
        }

        await cancelEdit();
      };

      const onDraftArrowUp = async (e) => {
        // Discord-like: flèche haut quand le draft est vide -> édite le dernier message
        if (!e) return;
        if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
        if (draft.value.trim().length !== 0) return;

        // seulement si le caret est au début (évite de “voler” la navigation)
        try {
          if (draftEl.value && draftEl.value.selectionStart > 0) return;
        } catch {}

        e.preventDefault();
        await startEditLastMine();
      };

      // si on change de room, on annule l'édition
      watch(roomId, () => {
        if (edit.id != null) cancelEdit();
      });

      // ----------------------------
      // unread (désactivé pour invités)
      // ----------------------------
      const enableUnread = computed(() => me.canWrite);
      const unread = reactive({});
      const unreadCount = (rid) => {
        if (!enableUnread.value) return 0;
        const k = String(rid ?? "");
        const v = unread[k];
        return Number.isFinite(v) ? v : 0;
      };
      const resetUnread = (rid) => {
        if (!enableUnread.value) return;
        unread[String(rid)] = 0;
      };

      // presence
      const presence = ref([]);

      // ----------------------------
      // COMPUTED
      // ----------------------------
      const roomsSafe = computed(() =>
        (Array.isArray(rooms.value) ? rooms.value : []).filter(
          (r) => r && r.id != null && typeof r.name === "string",
        ),
      );

      const activeRoom = computed(
        () => roomsSafe.value.find((r) => r.id === roomId.value) || null,
      );

      const canSend = computed(
        () =>
          !!activeRoom.value &&
          me.canWrite &&
          draft.value.trim().length > 0 &&
          !ui.sending,
      );

      const activeUsers = computed(() => {
        const cutoff = Date.now() - ACTIVE_MINUTES * 60_000;
        const byId = new Map();

        for (const u of presence.value) {
          if (!u?.external_user_id) continue;
          const t = new Date(u.last_seen).getTime();
          if (!Number.isFinite(t) || t < cutoff) continue;

          const prev = byId.get(u.external_user_id);
          if (!prev || new Date(prev.last_seen).getTime() < t)
            byId.set(u.external_user_id, u);
        }

        return [...byId.values()].sort(
          (a, b) =>
            new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime(),
        );
      });

      const activeUsersStack = computed(() =>
        activeUsers.value.slice(0, MAX_STACK),
      );
      const activeUsersOverflow = computed(() =>
        Math.max(0, activeUsers.value.length - MAX_STACK),
      );

      // ----------------------------
      // EMOJI PICKER (catégories + recherche keywords)
      // ----------------------------
      const emojiBtnEl = ref(null);
      const emojiPopEl = ref(null);
      const emojiSearchEl = ref(null);

      // catégories
      const ALL_EMOJIS = getEmojis();
      const EMOJI_SET = new Set(ALL_EMOJIS.map((x) => x.emoji));
      const GRAPHEME_SEGMENTER =
        "Segmenter" in Intl
          ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
          : null;

      const emojiCategories = [
        { key: "face-emotion", label: "🙂" },
        { key: "person-people", label: "🧑" },
        { key: "animals-nature", label: "🐻" },
        { key: "food-drink", label: "🍕" },
        { key: "travel-places", label: "✈️" },
        { key: "activities-events", label: "⚽" },
        { key: "objects", label: "💡" },
        { key: "symbols", label: "❤️" },
        { key: "flags", label: "🏳️" },
      ];

      const emoji = reactive({
        open: false,
        query: "",
        category: "face-emotion",
      });

      // IMPORTANT : index de recherche pré-normalisé (perfs)
      const EMOJI_INDEX = ALL_EMOJIS.map((x) => ({
        emoji: x.emoji,
        description: x.description,
        category: x.category,
        keywords: x.keywords || [],
        _s: normalize([x.description, ...(x.keywords || [])].join(" ")),
      }));

      const isEmojiOnlyText = (text) => {
        const s = String(text || "").trim();
        if (!s) return false;

        let count = 0;

        if (GRAPHEME_SEGMENTER) {
          for (const { segment } of GRAPHEME_SEGMENTER.segment(s)) {
            // ignore tout whitespace
            if (/^\s+$/u.test(segment)) continue;

            if (!EMOJI_SET.has(segment)) return false;
            count++;
          }
          return count > 0;
        }

        // Fallback (moins précis): découpe par codepoints
        // (ça peut rater certaines séquences ZWJ, donc mieux avec Intl.Segmenter)
        const parts = Array.from(s);
        for (const p of parts) {
          if (/^\s+$/u.test(p)) continue;
          if (!EMOJI_SET.has(p)) return false;
          count++;
        }
        return count > 0;
      };

      const emojiFiltered = computed(() => {
        const q = normalize(emoji.query);
        const cat = emoji.category;

        let list = EMOJI_INDEX.filter((x) => x.category === cat);

        if (!q) return list;

        // recherche sur CLDR keywords + description (déjà normalisés)
        return list.filter(
          (x) => x._s.includes(q) || x.emoji.includes(emoji.query),
        );
      });

      const toggleEmoji = async () => {
        emoji.open = !emoji.open;
        if (emoji.open) {
          await nextTick();
          emojiSearchEl.value?.focus({ preventScroll: true });
        }
      };

      const insertAtCursor = async (text) => {
        const el = draftEl.value;
        const current = draft.value ?? "";

        if (!el) {
          draft.value = current + text;
          return;
        }

        const start =
          typeof el.selectionStart === "number"
            ? el.selectionStart
            : current.length;
        const end =
          typeof el.selectionEnd === "number"
            ? el.selectionEnd
            : current.length;

        draft.value = current.slice(0, start) + text + current.slice(end);

        await nextTick();

        // remets focus + curseur après insertion
        el.focus({ preventScroll: true });
        const pos = start + text.length;
        try {
          el.setSelectionRange(pos, pos);
        } catch {}

        resizeDraft?.();
      };

      const pickEmoji = async (ch) => {
        await insertAtCursor(ch);
        emoji.open = false;
        draftEl.value?.focus({ preventScroll: true });
      };

      // close on click outside
      const onDocMouseDown = (ev) => {
        const t = ev.target;

        // emoji
        if (emoji.open) {
          if (emojiPopEl.value && emojiPopEl.value.contains(t)) return;
          if (emojiBtnEl.value && emojiBtnEl.value.contains(t)) return;
        }

        // gif
        if (gif.open) {
          if (gifPopEl.value && gifPopEl.value.contains(t)) return;
          if (gifBtnEl.value && gifBtnEl.value.contains(t)) return;
        }

        emoji.open = false;
        gif.open = false;
      };

      onMounted(() => document.addEventListener("mousedown", onDocMouseDown));
      onBeforeUnmount(() =>
        document.removeEventListener("mousedown", onDocMouseDown),
      );

      // ----------------------------
      // REPLY (discord-like)
      // ----------------------------
      const reply = reactive({
        id: null, // bigint
        username: "",
        excerpt: "",
      });

      const hasReply = computed(() => reply.id != null);

      const makeExcerpt = (text, max = 120) => {
        const s = String(text || "")
          .replace(/\s+/g, " ")
          .trim();
        if (s.length <= max) return s;
        return s.slice(0, max).trimEnd() + "…";
      };

      const makeReplyExcerptFromMessage = (m, max = 140) => {
        const raw = String(m?.content || "");

        // Cas 1: le message est un GIF "pur" ([gif]url[/gif]) -> on affiche un label propre
        if (extractGifUrl(raw)) return "🎞️ GIF";

        // Cas 2: le message contient un token gif au milieu -> on remplace le token par un label
        const cleaned = raw.replace(
          /\[gif\]\s*https?:\/\/\S+\s*\[\/gif\]/gi,
          "🎞️ GIF",
        );

        // Emoji-only (si tu veux conserver l’emphase)
        if (isEmojiOnlyText(cleaned)) {
          const t = cleaned.trim();
          return t.length > 24 ? t.slice(0, 24).trimEnd() + "…" : t;
        }

        // Texte normal
        return makeExcerpt(cleaned, max);
      };

      const replyExcerptLabel = (m) => {
        const ex = String(m?.reply_to_excerpt || "");
        if (extractGifUrl(ex)) return "🎞️ GIF"; // si l'extrait stocké est un token gif complet
        return ex;
      };

      const cancelReply = () => {
        reply.id = null;
        reply.username = "";
        reply.excerpt = "";
      };

      const setReply = async (m) => {
        if (!me.canWrite) return;
        if (!m) return;

        const idNum = Number(m.id);
        if (!Number.isFinite(idNum)) return; // ignore messages locaux "local-..."

        reply.id = idNum;
        reply.username = String(m.username || "");
        reply.excerpt = makeReplyExcerptFromMessage(m, 140);

        await nextTick();
        focusDraft(); // tu l'as déjà :contentReference[oaicite:2]{index=2}
      };

      // optionnel: jump si le message est présent dans le DOM
      const scrollToMessage = async (id) => {
        const el = messagesEl.value;
        if (!el) return;
        await nextTick();
        const target = el.querySelector(
          `[data-mid="${CSS.escape(String(id))}"]`,
        );
        if (target)
          target.scrollIntoView({ block: "center", behavior: "smooth" });
      };

      // ----------------------------
      // GIF PICKER (GIPHY) — token [gif]URL[/gif]
      // ----------------------------
      const GIPHY_API_KEY = "J5hSdMgUZ6yuPnR9dtGnJa3ydn05xbmC"; // ⚠️ visible côté client
      const GIPHY_LIMIT = 27;
      const GIPHY_RATING = "g"; // safe-ish

      const gif = reactive({
        open: false,
        query: "",
        items: [], // { id, title, previewUrl, url }
        loading: false,
        error: "",
        offset: 0,
        hasMore: true,
        loadedQuery: "",
      });

      const gifBtnEl = ref(null);
      const gifPopEl = ref(null);
      const gifSearchEl = ref(null);
      const gifResultsEl = ref(null);

      let gifReqToken = 0;

      const resetGifResults = async () => {
        // invalide toutes les requêtes en vol
        gifReqToken++;

        gif.items = [];
        gif.offset = 0;
        gif.hasMore = true;
        gif.error = "";
        gif.loadedQuery = "";

        await nextTick();
        if (gifResultsEl.value) gifResultsEl.value.scrollTop = 0;
      };

      const makeGifToken = (url) => `[gif]${url}[/gif]`;

      const extractGifUrl = (content) => {
        const s = String(content || "").trim();
        const m = s.match(/^\[gif\](https?:\/\/\S+)\[\/gif\]$/i);
        if (!m) return "";
        return safeUrl(m[1]); // réutilise ton safeUrl
      };

      const isGifMessage = (m) => !!extractGifUrl(m?.content);

      const fetchGiphy = async (path, params) => {
        const u = new URL(`https://api.giphy.com/v1/gifs/${path}`);
        u.searchParams.set("api_key", GIPHY_API_KEY);
        for (const [k, v] of Object.entries(params || {})) {
          if (v == null) continue;
          u.searchParams.set(k, String(v));
        }

        const res = await fetch(u.toString());
        if (!res.ok) throw new Error(`GIPHY ${res.status}`);
        return res.json();
      };

      const mapGiphyItems = (json) => {
        const arr = Array.isArray(json?.data) ? json.data : [];
        return arr
          .map((g) => {
            const previewUrl =
              safeUrl(g?.images?.fixed_width_small?.url) ||
              safeUrl(g?.images?.fixed_height_small?.url) ||
              safeUrl(g?.images?.downsized_small?.mp4); // fallback
            const url =
              safeUrl(g?.images?.original?.url) ||
              safeUrl(g?.images?.fixed_width?.url);

            if (!url) return null;
            return {
              id: g.id,
              title: g.title || "GIF",
              previewUrl: previewUrl || url,
              url,
            };
          })
          .filter(Boolean);
      };

      const loadGifs = async ({ append = false } = {}) => {
        if (!GIPHY_API_KEY) {
          gif.error = "Ajoute une clé GIPHY (GIPHY_API_KEY).";
          return;
        }

        // si on est en mode recherche (query non vide) et qu'on n'append pas, on repart de 0
        const qNorm = normalize(gif.query);
        const isSearch = qNorm.length > 0;
        const q = normalize(gif.query);

        // si on essaie d'append alors que la query a changé => on repart en "replace"
        if (append && gif.loadedQuery && q !== gif.loadedQuery) {
          return loadGifs({ append: false });
        }

        // token anti-race: seule la dernière requête peut modifier l'UI
        const token = ++gifReqToken;

        gif.loading = true;
        gif.error = "";

        try {
          const offset = append ? gif.offset : 0;

          const json = isSearch
            ? await fetchGiphy("search", {
                q: gif.query,
                limit: GIPHY_LIMIT,
                offset,
                rating: GIPHY_RATING,
                lang: "fr",
              })
            : await fetchGiphy("trending", {
                limit: GIPHY_LIMIT,
                offset,
                rating: GIPHY_RATING,
              });

          // si une requête plus récente est partie, on ignore ces résultats
          if (token !== gifReqToken) return;

          const items = mapGiphyItems(json);

          if (append) {
            // append uniquement pour le scroll infini
            gif.items.push(...items);
          } else {
            // ✅ recherche / trending initial = remplace la liste
            gif.loadedQuery = normalize(gif.query);
            gif.items = items;
            gif.offset = items.length;
            await nextTick();
            if (gifResultsEl.value) gifResultsEl.value.scrollTop = 0;
          }

          gif.offset = offset + items.length;
          gif.hasMore = items.length === GIPHY_LIMIT;
        } catch (e) {
          if (token !== gifReqToken) return;
          gif.error = `GIF: ${e.message || String(e)}`;
        } finally {
          if (token === gifReqToken) gif.loading = false;
        }
      };

      let gifTimer = null;
      watch(
        () => gif.query,
        () => {
          clearTimeout(gifTimer);
          gifTimer = setTimeout(async () => {
            await resetGifResults();
            await loadGifs({ append: false });
          }, 250);
        },
      );

      const toggleGif = async () => {
        gif.open = !gif.open;
        if (gif.open) {
          await nextTick();
          gifSearchEl.value?.focus({ preventScroll: true });
          if (gif.items.length === 0) loadGifs({ append: false }); // trending initial
        }
      };

      const pickGif = async (item, ev) => {
        // Alt+clic = insérer dans le draft au lieu d'envoyer
        if (ev?.altKey) {
          await insertAtCursor(makeGifToken(item.url));
          gif.open = false;
          focusDraft?.();
          return;
        }

        await sendGifNow(item.url);
      };

      // infinite scroll dans le popover (optionnel)
      const onGifScroll = async (ev) => {
        const el = ev?.target;
        if (!el || gif.loading || !gif.hasMore) return;

        // ✅ n'append jamais si on n'a pas encore une page chargée
        if (gif.items.length === 0) return;

        // ✅ n'append jamais si la query actuelle ne correspond pas à la liste affichée
        if (gif.loadedQuery && normalize(gif.query) !== gif.loadedQuery) return;

        if (el.scrollTop + el.clientHeight < el.scrollHeight - 120) return;
        await loadGifs({ append: true });
      };

      // ----------------------------
      // TEXTAREA (autosize)
      // ----------------------------
      const resizeDraft = () => {
        const el = draftEl.value;
        if (!el) return;

        el.style.height = "auto";
        const cs = window.getComputedStyle(el);
        const lineHeight = parseFloat(cs.lineHeight) || 20;
        const paddingTop = parseFloat(cs.paddingTop) || 0;
        const paddingBottom = parseFloat(cs.paddingBottom) || 0;
        const maxHeight = lineHeight * 3 + paddingTop + paddingBottom;

        const next = Math.min(el.scrollHeight, maxHeight);
        el.style.height = `${next}px`;
        el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
      };

      watch(draft, () => nextTick(resizeDraft));

      // ----------------------------
      // ROOM LABELS (topic rooms)
      // ----------------------------
      const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

      const makeAutoRoomName = (topicId) => {
        const og = document
          .querySelector('meta[property="og:title"]')
          ?.content?.trim();
        const base = (og || document.title || "").trim();
        const label = `Sujet #${topicId}`;
        if (!base) return label;
        return truncate(`${label} — ${base}`, 80);
      };

      const getTopicIdFromHref = (href = window.location.href) => {
        let u;
        try {
          u = new URL(href, window.location.href);
        } catch {
          u = new URL(window.location.href);
        }

        const pathname = u.pathname || window.location.pathname;

        const mt = pathname.match(/^\/t(\d+)/i);
        if (mt) return mt[1];

        const t = u.searchParams?.get("t");
        if (t && /^\d+$/.test(t)) return t;

        return null;
      };

      const isTopicRoom = (r) => {
        if (!r) return false;
        if (r.is_auto === true && r.kind === "t") return true;
        const rk = String(r.room_key || "");
        const pk = String(r.path_key || "");
        return rk.startsWith("path:/t") || pk.startsWith("/t");
      };

      const roomLabel = (r) => {
        const name = String(r?.name || "");
        if (!isTopicRoom(r)) return name;
        const stripped = name.replace(/^Sujet\s*#?\d+\s*[—-]\s*/i, "").trim();
        return stripped || name;
      };

      // ----------------------------
      // SCROLL (bottom + load older)
      // ----------------------------
      const scrollBottom = async () => {
        await nextTick();
        await nextTick();
        // Attendre que le navigateur ait calculé le layout (paint cycle).
        // nextTick garantit la mise à jour Vue, mais pas le reflow/paint du DOM.
        await new Promise((r) => requestAnimationFrame(r));
        const el = messagesEl.value;
        if (!el) return;

        initPrismMarkdown(el);

        const prevScrollBehavior = el.style.scrollBehavior;
        el.style.scrollBehavior = "auto";

        const doScroll = () => {
          el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
        };

        doScroll();

        // ─── Attente des images (avatars + GIFs) ───
        const images = el.querySelectorAll("img");
        if (images.length === 0) {
          el.style.scrollBehavior = prevScrollBehavior || "";
          return;
        }

        let loaded = 0;
        const total = images.length;

        // Timeout de sécurité : si une image ne déclenche jamais load/error
        // (ex. bloquée par un ad-blocker ou timeout réseau), on scroll quand même.
        const fallbackTimer = setTimeout(() => {
          doScroll();
          el.style.scrollBehavior = prevScrollBehavior || "";
        }, 2000);

        const onLoadOrError = () => {
          loaded++;
          if (loaded === total) {
            clearTimeout(fallbackTimer);
            doScroll(); // dernier scroll une fois tout chargé
            el.style.scrollBehavior = prevScrollBehavior || "";
          }
        };

        images.forEach((img) => {
          if (img.complete) {
            loaded++; // déjà chargé (cache)
          } else {
            img.addEventListener("load", onLoadOrError, { once: true });
            img.addEventListener("error", onLoadOrError, { once: true });
          }
        });

        // Si toutes les images étaient déjà en cache, on scroll tout de suite
        if (loaded === total) {
          clearTimeout(fallbackTimer);
          doScroll();
          el.style.scrollBehavior = prevScrollBehavior || "";
        }
      };

      const onMessagesScroll = async () => {
        const el = messagesEl.value;
        if (!el) return;
        if (ui.loadingOlder || ui.loadingMessages) return;
        if (el.scrollTop > SCROLL_TOP_THRESHOLD_PX) return;

        const rid = roomId.value;
        if (!rid) return;

        const st = getPaging(rid);
        if (!st.hasMore || !st.oldestId) return;

        ui.loadingOlder = true;
        try {
          await loadOlderMessages(rid);
        } finally {
          ui.loadingOlder = false;
        }
      };

      // ----------------------------
      // DATA LOADERS (messages paging)
      // ----------------------------
      const normalizeMessages = (list) =>
        (list || []).map((m) => ({ ...m, avatar_url: safeUrl(m.avatar_url) }));

      const loadLatestMessages = async (rid) => {
        ui.loadingMessages = true;
        error.value = "";

        const { data, error: e } = await supabase
          .from("chat_messages")
          .select(
            "id,room_id,external_user_id,username,avatar_url,content,created_at,reply_to_message_id,reply_to_username,reply_to_excerpt",
          )
          .eq("room_id", rid)
          .order("id", { ascending: false })
          .limit(PAGE_SIZE);

        ui.loadingMessages = false;

        if (e) {
          error.value = `Messages: ${e.message}`;
          messages.value = [];
          messagesCache.set(rid, messages.value);
          const st = getPaging(rid);
          st.oldestId = null;
          st.hasMore = false;
          return;
        }

        const desc = normalizeMessages(data);
        const asc = desc.slice().reverse();

        messages.value = asc;
        messagesCache.set(rid, messages.value);

        const st = getPaging(rid);
        st.oldestId = asc.length ? Number(asc[0].id) : null;
        st.hasMore = desc.length === PAGE_SIZE;

        const seen = getSeenSet(rid);
        seen.clear();
        for (const mm of asc) {
          const id = Number(mm?.id);
          if (Number.isFinite(id)) seen.add(id);
        }
      };

      const loadOlderMessages = async (rid) => {
        const st = getPaging(rid);
        if (!st.oldestId) return;

        const el = messagesEl.value;
        const prevHeight = el ? el.scrollHeight : 0;
        const prevTop = el ? el.scrollTop : 0;

        const { data, error: e } = await supabase
          .from("chat_messages")
          .select(
            "id,room_id,external_user_id,username,avatar_url,content,created_at,reply_to_message_id,reply_to_username,reply_to_excerpt",
          )
          .eq("room_id", rid)
          .lt("id", st.oldestId)
          .order("id", { ascending: false })
          .limit(PAGE_SIZE);

        if (e) {
          error.value = `Older: ${e.message}`;
          return;
        }

        const desc = normalizeMessages(data);
        if (!desc.length) {
          st.hasMore = false;
          return;
        }

        const olderAsc = desc.slice().reverse();

        const current = messagesCache.get(rid) || messages.value || [];
        const merged = [...olderAsc, ...current];

        messages.value = merged;
        messagesCache.set(rid, messages.value);

        st.oldestId = Number(olderAsc[0].id);
        st.hasMore = desc.length === PAGE_SIZE;

        const seen = getSeenSet(rid);
        for (const mm of olderAsc) {
          const id = Number(mm?.id);
          if (Number.isFinite(id)) seen.add(id);
        }

        await nextTick();
        initPrismMarkdown(messagesEl.value);

        if (el) {
          const newHeight = el.scrollHeight;
          const delta = newHeight - prevHeight;
          el.scrollTop = prevTop + delta;
        }
      };

      // ----------------------------
      // ROOMS (admin + auto topic room)
      // ----------------------------
      const loadAdminRooms = async () => {
        const { data, error: e } = await supabase
          .from("chatrooms")
          .select("id,name,created_at,is_auto,room_key,path_key,kind")
          .or("is_auto.is.null,is_auto.eq.false")
          .order("created_at", { ascending: true });

        if (e) {
          adminRooms.value = [];
          throw e;
        }
        adminRooms.value = (data || []).filter((r) => r && r.id != null);
      };

      const ensureAutoTopicRoom = async (topicId) => {
        const pathKey = `/t${topicId}`;
        const roomKey = `path:${pathKey}`;

        const { data: existing } = await supabase
          .from("chatrooms")
          .select("id,name,created_at,is_auto,room_key,path_key,kind")
          .eq("room_key", roomKey)
          .limit(1)
          .maybeSingle();

        if (existing) return existing;

        const row = {
          name: makeAutoRoomName(topicId),
          is_auto: true,
          room_key: roomKey,
          path_key: pathKey,
          kind: "t",
          created_by_external_id: me.externalId || null,
          created_by_username: me.username || null,
          created_by_avatar_url: me.avatarUrl || null,
        };

        const { data: inserted, error: insErr } = await supabase
          .from("chatrooms")
          .insert(row)
          .select("id,name,created_at,is_auto,room_key,path_key,kind")
          .single();

        if (!insErr) return inserted;

        const { data: again } = await supabase
          .from("chatrooms")
          .select("id,name,created_at,is_auto,room_key,path_key,kind")
          .eq("room_key", roomKey)
          .limit(1)
          .maybeSingle();

        return again || null;
      };

      const buildRoomsForHref = async (href = window.location.href) => {
        ui.loadingRooms = true;
        error.value = "";
        try {
          await loadAdminRooms();

          const topicId = getTopicIdFromHref(href);
          if (topicId) {
            autoRoom.value = await ensureAutoTopicRoom(topicId);
          } else {
            autoRoom.value = null;
          }

          rooms.value = autoRoom.value
            ? [autoRoom.value, ...adminRooms.value]
            : [...adminRooms.value];

          if (enableUnread.value) {
            for (const r of rooms.value) unread[String(r.id)] ??= 0;
          }

          const target = autoRoom.value?.id ?? rooms.value[0]?.id ?? null;
          return target;
        } catch (e) {
          error.value = `Rooms: ${e.message || String(e)}`;
          rooms.value = [];
          return null;
        } finally {
          ui.loadingRooms = false;
        }
      };

      // ----------------------------
      // UNREAD PERSISTENT (skip invités)
      // ----------------------------
      const loadPersistentUnread = async () => {
        if (!enableUnread.value) return;
        const { data, error: e } = await supabase.rpc("list_unread_counts", {
          p_external_user_id: me.externalId,
        });
        if (e) return;

        for (const k of Object.keys(unread)) delete unread[k];
        for (const row of data || [])
          unread[String(row.room_id)] = Number(row.unread_count) || 0;
      };

      const markActiveRoomRead = async () => {
        if (!enableUnread.value) return;
        if (!roomId.value) return;

        let lastId = 0;
        for (let i = messages.value.length - 1; i >= 0; i--) {
          const n = Number(messages.value[i]?.id);
          if (Number.isFinite(n)) {
            lastId = n;
            break;
          }
        }

        await supabase.rpc("mark_room_read", {
          p_room_id: roomId.value,
          p_external_user_id: me.externalId,
          p_last_read_message_id: lastId,
        });

        unread[String(roomId.value)] = 0;
      };

      // ----------------------------
      // SELECT ROOM
      // ----------------------------
      const selectRoom = async (rid, opts = {}) => {
        if (rid == null) return;
        const preferCache = opts.preferCache !== false;

        if (!opts.force && rid === roomId.value) return;

        roomId.value = rid;
        resetUnread(rid);

        const cached = messagesCache.get(rid);

        if (preferCache && cached) {
          messages.value = cached;
          ui.loadingMessages = false;
        } else {
          messages.value = [];
          await loadLatestMessages(rid);
        }

        // Toujours scroller en bas après un changement de room,
        // que les messages viennent du cache ou d'un fetch réseau.
        await scrollBottom();

        await markActiveRoomRead();
      };

      // ----------------------------
      // SEND (optimistic + focus)
      // ----------------------------
      const send = async () => {
        if (!canSend.value) return;
        if (ui.sending) return;

        // Si on est en train d’éditer, Enter dans le composer ne doit pas envoyer
        if (edit.id != null) return;

        const rid = roomId.value;
        const content = draft.value.trim();
        if (!content) return;

        ui.sending = true;
        error.value = "";

        // ✅ snapshot de la reply AVANT de la vider
        const replySnap = {
          id: reply.id,
          username: reply.username || null,
          excerpt: reply.excerpt || null,
        };

        const tempId = `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const localMsg = {
          id: tempId,
          room_id: rid,
          external_user_id: me.externalId,
          username: me.username,
          avatar_url: me.avatarUrl || null,
          content,
          created_at: new Date().toISOString(),
          _local: true,

          // reply (UI + optimistic)
          reply_to_message_id: replySnap.id,
          reply_to_username: replySnap.username,
          reply_to_excerpt: replySnap.excerpt,
        };

        messages.value.push(localMsg);
        messagesCache.set(rid, messages.value);

        // ✅ garde aussi le snapshot dans le pending (fallback au replace)
        pendingLocalByRoom.set(String(rid), {
          tempId,
          content,
          at: Date.now(),
          reply: replySnap,
        });

        draft.value = "";
        cancelReply(); // ✅ maintenant OK (on a déjà snapshot)
        await nextTick();
        resizeDraft();
        focusDraft();
        void scrollBottom();

        // ✅ payload basé sur replySnap (pas reply.*)
        const payload = {
          room_id: rid,
          external_user_id: me.externalId,
          username: me.username,
          avatar_url: me.avatarUrl || null,
          content,

          reply_to_message_id: replySnap.id,
          reply_to_username: replySnap.username,
          reply_to_excerpt: replySnap.excerpt,
        };

        const { error: e } = await supabase
          .from("chat_messages")
          .insert(payload);

        ui.sending = false;

        if (e) {
          const pend = pendingLocalByRoom.get(String(rid));
          if (pend) {
            const idx = messages.value.findIndex(
              (x) => String(x?.id) === String(pend.tempId),
            );
            if (idx >= 0) messages.value.splice(idx, 1);
            pendingLocalByRoom.delete(String(rid));
          }
          error.value = `Envoyer: ${e.message}`;
        }
      };

      const sendGifNow = async (url) => {
        if (!activeRoom.value) return;
        if (!me.canWrite) return;
        if (ui.sending) return;
        if (edit?.id != null) return; // ne pas envoyer pendant une édition

        const rid = roomId.value;
        const content = makeGifToken(url);

        ui.sending = true;
        error.value = "";

        // snapshot reply (si tu veux autoriser répondre + gif)
        const replySnap = {
          id: reply?.id ?? null,
          username: reply?.username || null,
          excerpt: reply?.excerpt || null,
        };

        // optimistic local message
        const tempId = `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const localMsg = {
          id: tempId,
          room_id: rid,
          external_user_id: me.externalId,
          username: me.username,
          avatar_url: me.avatarUrl || null,
          content,
          created_at: new Date().toISOString(),
          _local: true,

          reply_to_message_id: replySnap.id,
          reply_to_username: replySnap.username,
          reply_to_excerpt: replySnap.excerpt,
        };

        messages.value.push(localMsg);
        messagesCache.set(rid, messages.value);

        // si tu utilises pendingLocalByRoom pour remplacer via realtime
        pendingLocalByRoom.set(String(rid), {
          tempId,
          content,
          at: Date.now(),
          reply: replySnap,
        });

        // ferme le popover + reset reply
        gif.open = false;
        if (replySnap.id != null) cancelReply?.();

        await nextTick();
        focusDraft?.();
        void scrollBottom?.();

        const payload = {
          room_id: rid,
          external_user_id: me.externalId,
          username: me.username,
          avatar_url: me.avatarUrl || null,
          content,

          reply_to_message_id: replySnap.id,
          reply_to_username: replySnap.username,
          reply_to_excerpt: replySnap.excerpt,
        };

        const { error: e } = await supabase
          .from("chat_messages")
          .insert(payload);

        ui.sending = false;

        if (e) {
          // rollback local
          const idx = messages.value.findIndex(
            (x) => String(x?.id) === String(tempId),
          );
          if (idx >= 0) messages.value.splice(idx, 1);
          pendingLocalByRoom.delete(String(rid));
          error.value = `Envoyer GIF: ${e.message}`;
        }
      };

      const sendFromDraft = async (ev) => {
        // Shift+Enter = nouvelle ligne
        if (ev?.shiftKey) return;

        if (!canSend.value) return;
        await send();
        await nextTick();
        resizeDraft();
        focusDraft();
      };

      // ----------------------------
      // PRESENCE
      // ----------------------------
      const loadPresence = async () => {
        const cutoffIso = new Date(
          Date.now() - ACTIVE_MINUTES * 60_000,
        ).toISOString();
        const { data } = await supabase
          .from("chat_presence")
          .select("page_key,external_user_id,username,avatar_url,last_seen")
          .eq("page_key", PRESENCE_PAGE_KEY)
          .gte("last_seen", cutoffIso)
          .order("last_seen", { ascending: false })
          .limit(50);

        presence.value = (data || []).map((u) => ({
          ...u,
          avatar_url: u.avatar_url ? safeUrl(u.avatar_url) : "",
        }));
      };

      const upsertPresence = async () => {
        if (!me.externalId) return;
        const row = {
          page_key: PRESENCE_PAGE_KEY,
          external_user_id: me.externalId,
          username: me.username,
          avatar_url: me.avatarUrl || null,
          last_seen: new Date().toISOString(),
        };
        await supabase
          .from("chat_presence")
          .upsert(row, { onConflict: "page_key,external_user_id" });
      };

      const subscribePresence = () => {
        presenceChannel = supabase
          .channel("rt-presence")
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "chat_presence",
              filter: `page_key=eq.${PRESENCE_PAGE_KEY}`,
            },
            (payload) => {
              const u = payload?.new;
              if (!u?.external_user_id) return;

              const fixed = {
                ...u,
                avatar_url: u.avatar_url ? safeUrl(u.avatar_url) : "",
              };
              const idx = presence.value.findIndex(
                (x) => x?.external_user_id === fixed.external_user_id,
              );
              if (idx >= 0) presence.value[idx] = fixed;
              else presence.value.unshift(fixed);
            },
          )
          .subscribe();
      };

      // ----------------------------
      // REALTIME
      // ----------------------------
      const subscribeRealtime = () => {
        roomsChannel = supabase
          .channel("rt-chatrooms")
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "chatrooms" },
            (payload) => {
              const r = payload?.new;
              if (!r || r.id == null || typeof r.name !== "string") return;
              if (r.is_auto === true) return;

              if (!adminRooms.value.some((x) => x && x.id === r.id))
                adminRooms.value.push(r);
              rooms.value = autoRoom.value
                ? [autoRoom.value, ...adminRooms.value]
                : [...adminRooms.value];
            },
          )
          .subscribe();

        messagesChannel = supabase
          .channel("rt-chat-messages")
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "chat_messages" },
            (payload) => {
              const m = payload?.new;
              if (!m || m.id == null || m.room_id == null) return;

              const rid = m.room_id;

              const mid = Number(m.id);
              if (Number.isFinite(mid)) {
                const seen = getSeenSet(rid);
                if (seen.has(mid)) return;
                seen.add(mid);
              }

              m.avatar_url = safeUrl(m.avatar_url);

              if (rid === roomId.value) {
                const pend = pendingLocalByRoom.get(String(rid));
                if (
                  pend &&
                  m.external_user_id === me.externalId &&
                  m.content === pend.content &&
                  Date.now() - pend.at < 20_000
                ) {
                  const idx = messages.value.findIndex(
                    (x) => String(x?.id) === String(pend.tempId),
                  );
                  if (idx >= 0) {
                    // ✅ merge : garde les champs du local si Realtime ne les renvoie pas
                    const prev = messages.value[idx];

                    // fallback reply depuis pending si besoin
                    if (!m.reply_to_message_id && pend?.reply?.id) {
                      m.reply_to_message_id = pend.reply.id;
                      m.reply_to_username = pend.reply.username;
                      m.reply_to_excerpt = pend.reply.excerpt;
                    }

                    messages.value[idx] = { ...prev, ...m };
                  } else {
                    messages.value.push(m);
                  }
                  pendingLocalByRoom.delete(String(rid));
                } else {
                  messages.value.push(m);
                }

                messagesCache.set(rid, messages.value);
                scrollBottom();
                markActiveRoomRead();
              } else {
                const cached = messagesCache.get(rid);
                if (cached) cached.push(m);

                if (enableUnread.value) {
                  unread[String(rid)] = (unread[String(rid)] || 0) + 1;
                }
              }
            },
          )
          .on(
            "postgres_changes",
            { event: "UPDATE", schema: "public", table: "chat_messages" },
            (payload) => {
              const m = payload?.new;
              if (!m || m.id == null || m.room_id == null) return;

              const rid = m.room_id;
              m.avatar_url = safeUrl(m.avatar_url);

              if (rid === roomId.value) {
                const idx = messages.value.findIndex(
                  (x) => String(x?.id) === String(m.id),
                );
                if (idx >= 0) {
                  messages.value[idx] = { ...messages.value[idx], ...m };
                }
              }

              const cached = messagesCache.get(rid);
              if (cached) {
                const j = cached.findIndex(
                  (x) => String(x?.id) === String(m.id),
                );
                if (j >= 0) cached[j] = { ...cached[j], ...m };
              }
            },
          )
          .subscribe();
      };

      // ----------------------------
      // CREATE ROOM (admin only)
      // ----------------------------
      const createRoom = async () => {
        if (!me.isAdmin) {
          error.value = "Création de room réservée aux administrateurs.";
          return;
        }

        const name = newRoomName.value.trim();
        if (!name) return;

        ui.creatingRoom = true;
        error.value = "";

        const { data, error: e } = await supabase
          .from("chatrooms")
          .insert({
            name,
            created_by_external_id: me.externalId || null,
            created_by_username: me.username || null,
            created_by_avatar_url: me.avatarUrl || null,
          })
          .select("id,name,created_at,is_auto,room_key,path_key,kind")
          .single();

        ui.creatingRoom = false;

        if (e) {
          error.value = `Créer room: ${e.message}`;
          return;
        }

        if (!data || data.id == null) return;

        adminRooms.value.push(data);
        rooms.value = autoRoom.value
          ? [autoRoom.value, ...adminRooms.value]
          : [...adminRooms.value];

        newRoomName.value = "";
        ui.showCreate = false;

        await selectRoom(data.id, { force: true, preferCache: false });
      };

      // ----------------------------
      // BARBA SYNC (optional)
      // ----------------------------
      let pathSyncToken = 0;
      const syncPath = async (href = window.location.href) => {
        const token = ++pathSyncToken;
        await new Promise((r) => requestAnimationFrame(r));

        const target = await buildRoomsForHref(href);
        if (token !== pathSyncToken) return;
        if (target)
          await selectRoom(target, { force: true, preferCache: true });
      };
      window.__faChatSyncPath = (href) => syncPath(href);

      // ----------------------------
      // INIT
      // ----------------------------
      onMounted(async () => {
        ui.booting = true;
        ui.loadingRooms = true;
        ui.loadingMessages = true;

        const target = await buildRoomsForHref(window.location.href);
        if (enableUnread.value) await loadPersistentUnread();
        subscribeRealtime();

        await loadPresence();
        subscribePresence();
        await upsertPresence();
        presenceTimer = window.setInterval(upsertPresence, PRESENCE_PING_MS);
        presenceCleanupTimer = window.setInterval(() => {
          const cutoff = Date.now() - ACTIVE_MINUTES * 60_000;
          presence.value = presence.value.filter(
            (u) => new Date(u.last_seen).getTime() >= cutoff,
          );
        }, 60_000);

        if (target)
          await selectRoom(target, { force: true, preferCache: false });

        ui.booting = false;

        await nextTick();
        resizeDraft();
        await nextTick();
        await scrollBottom();
      });

      onBeforeUnmount(() => {
        if (roomsChannel) supabase.removeChannel(roomsChannel);
        if (messagesChannel) supabase.removeChannel(messagesChannel);
        if (presenceChannel) supabase.removeChannel(presenceChannel);

        if (presenceTimer) window.clearInterval(presenceTimer);
        if (presenceCleanupTimer) window.clearInterval(presenceCleanupTimer);
      });

      return {
        me,
        ui,

        roomsSafe,
        roomId,
        activeRoom,
        isTopicRoom,
        roomLabel,

        messages,
        messagesEl,
        onMessagesScroll,
        timeAgo,

        draft,
        draftEl,
        resizeDraft,
        sendFromDraft,
        onDraftArrowUp,

        // edit
        edit,
        editEl,
        isEditing,
        startEditMessage,
        resizeEdit,
        saveEdit,
        cancelEdit,

        newRoomName,
        createRoom,

        unreadCount,
        selectRoom,

        activeUsersStack,
        activeUsersOverflow,

        error,
        canSend,

        emoji,
        emojiBtnEl,
        emojiPopEl,
        emojiSearchEl,
        emojiCategories,
        emojiFiltered,
        toggleEmoji,
        pickEmoji,
        isEmojiOnlyText,

        gif,
        gifBtnEl,
        gifPopEl,
        gifSearchEl,
        gifResultsEl,
        toggleGif,
        pickGif,
        onGifScroll,
        isGifMessage,
        extractGifUrl,

        reply,
        hasReply,
        setReply,
        cancelReply,
        scrollToMessage,
        replyExcerptLabel,

        // markdown
        renderMarkdown,
      };
    },
  });

  const el = document.getElementById("chat");
  if (!el) return;

  app.mount(el);
  window.__faChatUnmount = () => app.unmount();
};
