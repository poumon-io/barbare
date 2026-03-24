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
  // XP & NIVEAUX — CONFIG
  // ----------------------------
  const XP_PER_MESSAGE = 10; // +XP par message envoyé
  const XP_PER_REACTION = 5; // +XP par réaction donnée
  const XP_PER_MINUTE = 1; // +XP par minute dans le chat
  const XP_LEVEL_BASE = 100; // xp_to_next = XP_LEVEL_BASE × level²

  // ----------------------------
  // HELPERS
  // ----------------------------
  const normalize = (s) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .trim();

  const slugify = (s) => {
    return (
      normalize(s || "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "uncategorized-room"
    );
  };

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
      "img",
    ]);

    // Attributs autorisés par balise
    // — pre/code : on conserve "class" pour que Prism puisse lire language-xxx
    const ALLOWED_ATTRS = {
      a: ["href", "title", "target", "rel"],
      pre: ["class"],
      code: ["class", "data-lang"],
      img: ["src", "alt", "title", "loading", "width", "height"],
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

        if (tag === "img") {
          const src = node.getAttribute("src") || "";
          if (!safeUrl(src)) {
            node.removeAttribute("src");
          } else {
            node.classList.add("chat-image");
          }
        }

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

    const rawColor = String(
      ud.groupcolor ?? ud.group_color ?? ud.groupColor ?? "",
    ).trim();
    const normalizedColor = rawColor.startsWith("#")
      ? rawColor
      : rawColor
        ? `#${rawColor}`
        : "";
    const groupColor = /^#[0-9a-fA-F]{3,8}$/.test(normalizedColor)
      ? normalizedColor
      : null;

    return { externalId, username, avatarUrl, canWrite, isAdmin, groupColor };
  };

  const timeAgo = (() => {
    const rtf = new Intl.RelativeTimeFormat("fr-CA", { numeric: "always" });
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

  const formatFullDate = (() => {
    const fmt = new Intl.DateTimeFormat("fr-CA", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    return (iso) => {
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? "" : fmt.format(d);
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
  let typingChannel = null;

  let presenceTimer = null;
  let presenceCleanupTimer = null;
  let unreadTimer = null;

  const app = createApp({
    setup() {
      const me = reactive(readUserdata());
      me.avatarUrl = safeUrl(me.avatarUrl);

      // ----------------------------
      // XP STATE
      // ----------------------------
      const xpStats = reactive({
        xp: 0,
        level: 1,
        xp_to_next: XP_LEVEL_BASE,
        messages_sent: 0,
        reactions_given: 0,
        time_in_chat: 0, // en secondes
        leveledUp: false, // flag temporaire pour l'animation level-up
      });

      // Niveaux des autres utilisateurs : external_user_id → level (number)
      const userLevels = reactive({});

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

      const clearFirstUnread = () => {
        firstUnreadId.value = null;
      };

      const focusDraft = () => {
        draftEl.value?.focus({ preventScroll: true });
        clearFirstUnread();
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

      // ----------------------------
      // DELETE MESSAGE (soft delete)
      // ----------------------------
      const deleteMessage = async (m) => {
        if (!me.canWrite) return;
        if (!m) return;

        // L'auteur peut supprimer son message, l'admin peut tout supprimer
        if (m.external_user_id !== me.externalId && !me.isAdmin) return;

        // Refuse les messages locaux/optimistes
        const n = Number(m.id);
        if (!Number.isFinite(n)) return;

        const rid = m.room_id ?? roomId.value;

        const deletedBy =
          me.isAdmin && m.external_user_id !== me.externalId
            ? "admin"
            : "author";
        const deletedAt = new Date().toISOString();

        // Optimiste UI — marque le message comme supprimé sans le retirer
        const markDeleted = (arr) => {
          const idx = arr.findIndex((x) => String(x?.id) === String(m.id));
          if (idx >= 0)
            arr[idx] = {
              ...arr[idx],
              deleted_at: deletedAt,
              deleted_by: deletedBy,
            };
        };
        markDeleted(messages.value);

        // Persist Supabase
        const { error: e } = await supabase
          .from("chat_messages")
          .update({
            deleted_at: new Date().toISOString(),
            deleted_by:
              me.isAdmin && m.external_user_id !== me.externalId
                ? "admin"
                : "author",
          })
          .eq("id", m.id);

        if (e) {
          error.value = `Supprimer: ${e.message}`;
          // Rollback : recharge les messages de la room
          await loadLatestMessages(rid);
        }
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
      watch(roomId, (newRid) => {
        if (edit.id != null) cancelEdit();
        mention.open = false;
        reactionPicker.open = false;
        // Vide les réactions de l'ancienne room
        for (const k of Object.keys(reactions)) delete reactions[k];
        subscribeTyping(newRid);
      });

      // ----------------------------
      // unread (désactivé pour invités)
      // ----------------------------
      const enableUnread = computed(() => me.canWrite);
      const unread = reactive({});
      // ID du premier message non lu — pilote le séparateur "NOUVEAU"
      const firstUnreadId = ref(null);
      const unreadCount = (rid) => {
        if (!enableUnread.value) return 0;
        const k = String(rid ?? "");
        return unread[k] || 0;
      };
      const resetUnread = (rid) => {
        if (!enableUnread.value) return;
        unread[String(rid)] = 0;
      };

      // presence
      const presence = ref([]);

      // ----------------------------
      // STATUT DE FRAPPE
      // ----------------------------
      // Map : external_user_id → { username, avatar_url, at (timestamp) }
      const typingUsers = reactive({});

      // ----------------------------
      // MESSAGES ÉPINGLÉS
      // ----------------------------
      const pinnedMessages = ref([]); // messages épinglés de la room active
      const showPinned = ref(false); // popover ouvert/fermé
      const pinnedBtnEl = ref(null);
      const pinnedPopEl = ref(null);

      // ----------------------------
      // CLASSEMENT XP
      // ----------------------------
      const leaderboard = ref([]);
      const leaderboardLoading = ref(false);
      const showLeaderboard = ref(false);
      const leaderboardBtnEl = ref(null);
      const leaderboardPopEl = ref(null);

      const myLeaderboardRank = computed(() => {
        const idx = leaderboard.value.findIndex(
          (u) => u.external_user_id === me.externalId,
        );
        return idx === -1 ? null : idx + 1;
      });

      const loadLeaderboard = async () => {
        leaderboardLoading.value = true;
        const { data } = await supabase
          .from("user_stats")
          .select("external_user_id,username,avatar_url,xp,level")
          .order("level", { ascending: false })
          .order("xp", { ascending: false })
          .limit(10);
        leaderboard.value = (data || []).map((u) => ({
          ...u,
          avatar_url: safeUrl(u.avatar_url || ""),
          xp: u.xp ?? 0,
          level: u.level ?? 1,
        }));
        leaderboardLoading.value = false;
      };

      const onDocMouseDownLeaderboard = (ev) => {
        if (!showLeaderboard.value) return;
        if (leaderboardPopEl.value?.contains(ev.target)) return;
        if (leaderboardBtnEl.value?.contains(ev.target)) return;
        showLeaderboard.value = false;
      };

      watch(showLeaderboard, (v) => {
        if (v) loadLeaderboard();
      });

      // ----------------------------
      // RÉACTIONS
      // ----------------------------
      // Map : message_id (string) → [{ emoji, count, users: Set<external_user_id> }]
      const reactions = reactive({});

      const reactionPicker = reactive({
        open: false,
        messageId: null,
        query: "",
        category: "face-emotion",
        above: false, // true = picker au-dessus du bouton
      });
      const reactionPickerEl = ref(null);

      const normalizeReactions = (rows) => {
        const map = {};
        for (const r of rows || []) {
          const mid = String(r.message_id);
          if (!map[mid]) map[mid] = {};
          if (!map[mid][r.emoji])
            map[mid][r.emoji] = { emoji: r.emoji, count: 0, users: new Set() };
          map[mid][r.emoji].count++;
          map[mid][r.emoji].users.add(r.external_user_id);
        }
        const result = {};
        for (const [mid, emojis] of Object.entries(map)) {
          result[mid] = Object.values(emojis);
        }
        return result;
      };

      const loadReactions = async (rid) => {
        if (!rid) return;
        const ids = messages.value
          .map((m) => m.id)
          .filter((id) => Number.isFinite(Number(id)));
        if (!ids.length) return;
        const { data } = await supabase
          .from("message_reactions")
          .select("message_id,external_user_id,emoji")
          .in("message_id", ids);
        const normalized = normalizeReactions(data);
        for (const [mid, list] of Object.entries(normalized)) {
          reactions[mid] = list;
        }
      };

      const getReactions = (messageId) => reactions[String(messageId)] || [];

      const myReactionEmoji = (messageId) => {
        const list = reactions[String(messageId)] || [];
        return list.find((r) => r.users.has(me.externalId))?.emoji || null;
      };

      const toggleReaction = async (messageId, emoji) => {
        if (!me.canWrite) return;
        const mid = String(messageId);
        const current = myReactionEmoji(messageId);

        if (current === emoji) {
          // Toggle off — même emoji
          const idx = reactions[mid]?.findIndex((r) => r.emoji === emoji) ?? -1;
          if (idx >= 0) {
            reactions[mid][idx].count--;
            reactions[mid][idx].users.delete(me.externalId);
            if (reactions[mid][idx].count <= 0) reactions[mid].splice(idx, 1);
          }
          await supabase
            .from("message_reactions")
            .delete()
            .eq("message_id", messageId)
            .eq("external_user_id", me.externalId);
        } else {
          // Retire l'ancienne localement si elle existe
          if (current) {
            const oldIdx =
              reactions[mid]?.findIndex((r) => r.emoji === current) ?? -1;
            if (oldIdx >= 0) {
              reactions[mid][oldIdx].count--;
              reactions[mid][oldIdx].users.delete(me.externalId);
              if (reactions[mid][oldIdx].count <= 0)
                reactions[mid].splice(oldIdx, 1);
            }
          }
          // Ajoute la nouvelle
          if (!reactions[mid]) reactions[mid] = [];
          const existing = reactions[mid].find((r) => r.emoji === emoji);
          if (existing) {
            existing.count++;
            existing.users.add(me.externalId);
          } else
            reactions[mid].push({
              emoji,
              count: 1,
              users: new Set([me.externalId]),
            });
          // Upsert (remplace l'ancienne via UNIQUE constraint)
          await supabase.from("message_reactions").upsert(
            {
              message_id: messageId,
              external_user_id: me.externalId,
              username: me.username,
              emoji,
            },
            { onConflict: "message_id,external_user_id" },
          );
          void giveReactionXp();
        }
        reactionPicker.open = false;
      };

      const toggleReactionPicker = (messageId, event) => {
        if (
          reactionPicker.open &&
          reactionPicker.messageId === String(messageId)
        ) {
          reactionPicker.open = false;
          return;
        }

        // Détermine si le bouton est dans la moitié haute du conteneur scrollable
        const btn = event?.currentTarget ?? event?.target;
        const container = messagesEl.value;
        if (btn && container) {
          const btnRect = btn.getBoundingClientRect();
          const contRect = container.getBoundingClientRect();
          const relCenter = btnRect.top - contRect.top;
          reactionPicker.above = relCenter > contRect.height / 2;
        } else {
          reactionPicker.above = false;
        }

        reactionPicker.open = true;
        reactionPicker.messageId = String(messageId);
        reactionPicker.query = "";
        reactionPicker.category = "face-emotion";
      };

      const reactionPickerFiltered = computed(() => {
        const q = normalize(reactionPicker.query);
        if (q) {
          return EMOJI_INDEX.filter(
            (x) => x._s.includes(q) || x.emoji.includes(reactionPicker.query),
          ).slice(0, 81);
        }
        return EMOJI_INDEX.filter(
          (x) => x.category === reactionPicker.category,
        );
      });

      const onDocMouseDownReaction = (ev) => {
        if (!reactionPicker.open) return;
        if (reactionPickerEl.value?.contains(ev.target)) return;
        reactionPicker.open = false;
      };
      const mention = reactive({
        open: false,
        query: "",
        index: 0,
        triggerPos: -1, // position du @ dans draft
      });

      // Auteurs uniques ayant écrit dans la room courante
      const roomAuthors = ref([]); // [{ external_user_id, username, avatar_url }]

      const collectAuthors = (msgs) => {
        const seen = new Map();
        for (const m of msgs || []) {
          if (!m?.external_user_id || seen.has(m.external_user_id)) continue;
          seen.set(m.external_user_id, {
            external_user_id: m.external_user_id,
            username: m.username || "",
            avatar_url: safeUrl(m.avatar_url || ""),
          });
        }
        roomAuthors.value = [...seen.values()];
      };

      const mentionFiltered = computed(() => {
        if (!mention.open) return [];
        const q = normalize(mention.query);
        return roomAuthors.value
          .filter((u) => u.external_user_id !== me.externalId)
          .filter((u) => !q || normalize(u.username).includes(q))
          .slice(0, 6);
      });

      const isMentioned = (m) => {
        if (!me.canWrite || !me.username || m.deleted_at) return false;
        return String(m.content || "")
          .toLowerCase()
          .includes("@" + me.username.toLowerCase());
      };

      // Entoure les @mentions dans le HTML rendu
      const highlightMentions = (html) => {
        if (!html) return html;
        return html.replace(/@([a-zA-Z0-9_\-.]+)/g, (match, uname) => {
          const isSelf = normalize(uname) === normalize(me.username || "");
          const cls = isSelf
            ? "chat-mention chat-mention-self"
            : "chat-mention";
          return `<span class="${cls}">${match}</span>`;
        });
      };
      const renderWithMentions = (content) =>
        highlightMentions(renderMarkdown(content));

      // Ouvre l'autocomplete si on trouve @query avant le curseur
      const onDraftInput = () => {
        resizeDraft();
        const el = draftEl.value;
        if (!el) return;
        const pos = el.selectionStart ?? draft.value.length;
        const before = draft.value.slice(0, pos);
        const m = before.match(/@([^\s@]*)$/);
        if (m) {
          mention.open = true;
          mention.query = m[1];
          mention.triggerPos = pos - m[0].length;
          mention.index = 0;
        } else {
          mention.open = false;
        }
        if (draft.value.trim().length > 0) broadcastTyping();
      };

      // Insère @username au bon endroit dans le draft
      const insertMention = async (username) => {
        const el = draftEl.value;
        const pos = el?.selectionStart ?? draft.value.length;
        const before = draft.value.slice(0, mention.triggerPos);
        const after = draft.value.slice(pos);
        draft.value = `${before}@${username} ${after}`;
        mention.open = false;
        await nextTick();
        const newPos = mention.triggerPos + username.length + 2;
        try {
          el?.setSelectionRange(newPos, newPos);
        } catch {}
        el?.focus({ preventScroll: true });
        resizeDraft();
      };

      // Gestion clavier dans le textarea quand l'autocomplete est ouvert
      const onMentionKeydown = (e) => {
        if (!mention.open) return;
        if (e.key === "ArrowDown") {
          e.preventDefault();
          e.stopPropagation();
          mention.index = Math.min(
            mention.index + 1,
            mentionFiltered.value.length - 1,
          );
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          e.stopPropagation();
          mention.index = Math.max(mention.index - 1, 0);
        } else if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          const u = mentionFiltered.value[mention.index];
          if (u) insertMention(u.username);
        } else if (e.key === "Escape") {
          e.stopPropagation();
          mention.open = false;
        }
      };

      const pinnedCount = computed(() => pinnedMessages.value.length);

      const loadPinnedMessages = async (rid) => {
        if (!rid) {
          pinnedMessages.value = [];
          return;
        }
        const { data } = await supabase
          .from("chat_messages")
          .select(
            "id,room_id,external_user_id,username,avatar_url,group_color,content,created_at,pinned_at,pinned_by,deleted_at",
          )
          .eq("room_id", rid)
          .not("pinned_at", "is", null)
          .is("deleted_at", null)
          .order("pinned_at", { ascending: false });
        pinnedMessages.value = (data || []).map((m) => ({
          ...m,
          avatar_url: safeUrl(m.avatar_url),
        }));
      };

      const togglePin = async (m) => {
        if (!me.isAdmin) return;
        const n = Number(m.id);
        if (!Number.isFinite(n)) return;

        const isNowPinned = !m.pinned_at;
        const patch = isNowPinned
          ? { pinned_at: new Date().toISOString(), pinned_by: me.externalId }
          : { pinned_at: null, pinned_by: null };

        // Optimiste : met à jour dans messages.value
        const idx = messages.value.findIndex(
          (x) => String(x?.id) === String(m.id),
        );
        if (idx >= 0)
          messages.value[idx] = { ...messages.value[idx], ...patch };

        // Optimiste : met à jour pinnedMessages
        if (isNowPinned) {
          pinnedMessages.value = [{ ...m, ...patch }, ...pinnedMessages.value];
        } else {
          pinnedMessages.value = pinnedMessages.value.filter(
            (x) => String(x.id) !== String(m.id),
          );
        }

        const { error: e } = await supabase
          .from("chat_messages")
          .update(patch)
          .eq("id", m.id);

        if (e) {
          error.value = `Épingler: ${e.message}`;
          await loadPinnedMessages(roomId.value);
        }
      };

      const closePinned = () => {
        showPinned.value = false;
      };

      // Ferme le popover au clic extérieur
      const onDocMouseDownPinned = (ev) => {
        if (!showPinned.value) return;
        if (pinnedPopEl.value?.contains(ev.target)) return;
        if (pinnedBtnEl.value?.contains(ev.target)) return;
        showPinned.value = false;
      };
      const TYPING_TTL_MS = 4000; // délai avant de considérer que l'utilisateur a arrêté
      const TYPING_THROTTLE_MS = 2000; // fréquence max d'envoi du broadcast

      // Computed : liste des utilisateurs en train d'écrire (sauf soi-même, triés par activité)
      const typingList = computed(() => {
        const cutoff = Date.now() - TYPING_TTL_MS;
        return Object.values(typingUsers)
          .filter((u) => u.at >= cutoff && u.external_user_id !== me.externalId)
          .sort((a, b) => b.at - a.at);
      });

      // Nettoie périodiquement les entrées expirées
      let typingCleanupTimer = null;

      const subscribeTyping = (rid) => {
        // Désinscription de l'ancien channel si besoin
        if (typingChannel) {
          supabase.removeChannel(typingChannel);
          typingChannel = null;
        }
        // Vide les indicateurs de l'ancienne room
        for (const key of Object.keys(typingUsers)) delete typingUsers[key];
        if (!rid) return;

        typingChannel = supabase
          .channel(`typing-room-${rid}`)
          .on("broadcast", { event: "typing" }, ({ payload }) => {
            if (!payload?.external_user_id) return;
            if (payload.external_user_id === me.externalId) return;
            typingUsers[payload.external_user_id] = {
              external_user_id: payload.external_user_id,
              username: payload.username || "…",
              avatar_url: safeUrl(payload.avatar_url || ""),
              at: Date.now(),
            };
          })
          .on("broadcast", { event: "new-message" }, ({ payload }) => {
            const m = payload?.message;
            if (!m || m.id == null || m.room_id == null) return;

            const mid = Number(m.id);
            if (Number.isFinite(mid)) {
              const seen = getSeenSet(m.room_id);
              if (seen.has(mid)) return; // déjà affiché (optimiste ou postgres_changes)
            }

            // Défense supplémentaire : vérifie directement dans messages.value
            if (
              String(m.room_id) === String(roomId.value) &&
              messages.value.some((x) => x && String(x.id) === String(m.id))
            ) {
              // Le message est déjà affiché (ex. postgres_changes l'a ajouté)
              if (Number.isFinite(mid)) getSeenSet(m.room_id).add(mid);
              return;
            }

            m.avatar_url = safeUrl(m.avatar_url || "");

            if (m.external_user_id && m.external_user_id !== me.externalId) {
              void loadUserLevels([m.external_user_id]);
            }

            // Ajoute à roomAuthors si nouvel auteur
            if (
              m.external_user_id &&
              !roomAuthors.value.some(
                (u) => u.external_user_id === m.external_user_id,
              )
            ) {
              roomAuthors.value = [
                ...roomAuthors.value,
                {
                  external_user_id: m.external_user_id,
                  username: m.username || "",
                  avatar_url: safeUrl(m.avatar_url || ""),
                },
              ];
            }

            if (m.external_user_id && typingUsers[m.external_user_id]) {
              delete typingUsers[m.external_user_id];
            }

            // Si la room est active : affiche le message
            if (String(m.room_id) === String(roomId.value)) {
              if (Number.isFinite(mid)) getSeenSet(m.room_id).add(mid);
              messages.value.push(m);
              void scrollBottom();
              void markActiveRoomRead();
            } else {
              // Sinon : incrémente le badge de non-lus
              if (enableUnread.value) {
                const k = String(m.room_id);
                if (!(k in unread)) unread[k] = 0;
                unread[k] = unread[k] + 1;
              }
            }
          })
          .subscribe();
      };

      // Envoi throttlé du broadcast "typing"
      let _lastTypingBroadcast = 0;
      const broadcastTyping = () => {
        if (!me.canWrite || !roomId.value || !typingChannel) return;
        const now = Date.now();
        if (now - _lastTypingBroadcast < TYPING_THROTTLE_MS) return;
        _lastTypingBroadcast = now;
        typingChannel.send({
          type: "broadcast",
          event: "typing",
          payload: {
            external_user_id: me.externalId,
            username: me.username,
            avatar_url: me.avatarUrl || "",
            group_color: me.groupColor || null,
          },
        });
      };

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

      // Message ciblé par le picker emoji en mode réaction (null = mode draft normal)
      const reactionTarget = ref(null);

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
        if (reactionTarget.value) {
          // Mode réaction — applique sur le message ciblé
          await toggleReaction(reactionTarget.value, ch);
          reactionTarget.value = null;
          emoji.open = false;
          emoji.query = "";
        } else {
          // Mode draft — insère dans le textarea
          await insertAtCursor(ch);
          emoji.open = false;
          draftEl.value?.focus({ preventScroll: true });
        }
      };

      const openReactionPicker = async (m) => {
        reactionTarget.value = m;
        emoji.open = true;
        emoji.query = "";
        await nextTick();
        emojiSearchEl.value?.focus({ preventScroll: true });
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
        reactionTarget.value = null;
      };

      onMounted(() => {
        document.addEventListener("mousedown", onDocMouseDown);
        document.addEventListener("mousedown", onDocMouseDownPinned);
        document.addEventListener("mousedown", onDocMouseDownReaction);
        document.addEventListener("mousedown", onDocMouseDownLeaderboard);
      });
      onBeforeUnmount(() => {
        document.removeEventListener("mousedown", onDocMouseDown);
        document.removeEventListener("mousedown", onDocMouseDownPinned);
        document.removeEventListener("mousedown", onDocMouseDownReaction);
        document.removeEventListener("mousedown", onDocMouseDownLeaderboard);
      });

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

        if (extractGifUrl(raw)) return "🎞️ GIF";
        if (raw.includes("![") || raw.includes("<img")) return "📸 Image";

        const cleaned = raw.replace(
          /\[gif\]\s*https?:\/\/\S+\s*\[\/gif\]/gi,
          "🎞️ GIF",
        );

        if (isEmojiOnlyText(cleaned)) {
          const t = cleaned.trim();
          return t.length > 24 ? t.slice(0, 24).trimEnd() + "…" : t;
        }
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
      const scrollToMessage = async (id, { smooth = true } = {}) => {
        const container = messagesEl.value;
        if (!container) return;

        await nextTick();
        await nextTick();
        await new Promise((r) => requestAnimationFrame(r));

        // Attend que toutes les images du conteneur soient chargées
        // (même logique que scrollBottom — avatars, GIFs, images collées)
        const images = container.querySelectorAll("img");
        if (images.length > 0) {
          await new Promise((resolve) => {
            const fallback = setTimeout(resolve, 2000);
            let pending = 0;
            images.forEach((img) => {
              if (!img.complete) {
                pending++;
                const done = () => {
                  if (--pending === 0) {
                    clearTimeout(fallback);
                    resolve();
                  }
                };
                img.addEventListener("load", done, { once: true });
                img.addEventListener("error", done, { once: true });
              }
            });
            if (pending === 0) {
              clearTimeout(fallback);
              resolve();
            }
          });
        }

        // Recalcule après que les images ont modifié le layout
        await new Promise((r) => requestAnimationFrame(r));

        const target = container.querySelector(
          `[data-mid="${CSS.escape(String(id))}"]`,
        );
        if (!target) return;

        const containerRect = container.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const offset = targetRect.top - containerRect.top + container.scrollTop;
        const centeredTop =
          offset - container.clientHeight / 2 + target.offsetHeight / 2;

        container.scrollTo({
          top: Math.max(0, centeredTop),
          behavior: smooth ? "smooth" : "auto",
        });
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
      // XP & NIVEAUX
      // ----------------------------
      const computeXpToNext = (lvl) => XP_LEVEL_BASE * lvl * lvl;

      const loadUserStats = async () => {
        if (!me.canWrite) return;

        const { data } = await supabase
          .from("user_stats")
          .select(
            "xp,level,xp_to_next,messages_sent,reactions_given,time_in_chat",
          )
          .eq("external_user_id", me.externalId)
          .maybeSingle();

        if (data) {
          xpStats.xp = data.xp ?? 0;
          xpStats.level = data.level ?? 1;
          xpStats.xp_to_next = data.xp_to_next ?? computeXpToNext(1);
          xpStats.messages_sent = data.messages_sent ?? 0;
          xpStats.reactions_given = data.reactions_given ?? 0;
          xpStats.time_in_chat = data.time_in_chat ?? 0;
        } else {
          // Premier passage : initialise la ligne
          await supabase.from("user_stats").upsert(
            {
              external_user_id: me.externalId,
              username: me.username,
              avatar_url: me.avatarUrl || null,
              group_color: me.groupColor || null,
              xp: 0,
              level: 1,
              xp_to_next: computeXpToNext(1),
            },
            { onConflict: "external_user_id" },
          );
        }
      };

      const grantXp = async (amount, source = "misc") => {
        if (!me.canWrite || amount <= 0) return;

        let newXp = xpStats.xp + amount;
        let newLevel = xpStats.level;
        let xpToNext = xpStats.xp_to_next;

        // ── Boucle de level-up ──
        while (newXp >= xpToNext) {
          newXp -= xpToNext;
          newLevel++;
          xpToNext = computeXpToNext(newLevel);
        }

        const didLevelUp = newLevel > xpStats.level;

        // Compteurs spécifiques à la source
        const extra = {};
        if (source === "message")
          extra.messages_sent = xpStats.messages_sent + 1;
        if (source === "reaction")
          extra.reactions_given = xpStats.reactions_given + 1;
        if (source === "time")
          extra.time_in_chat =
            xpStats.time_in_chat + Math.round(amount / XP_PER_MINUTE) * 60;

        // Mise à jour locale (immédiate, réactive)
        xpStats.xp = newXp;
        xpStats.level = newLevel;
        xpStats.xp_to_next = xpToNext;
        if (extra.messages_sent != null)
          xpStats.messages_sent = extra.messages_sent;
        if (extra.reactions_given != null)
          xpStats.reactions_given = extra.reactions_given;
        if (extra.time_in_chat != null)
          xpStats.time_in_chat = extra.time_in_chat;

        if (didLevelUp) {
          xpStats.leveledUp = true;
          setTimeout(() => {
            xpStats.leveledUp = false;
          }, 4000);
        }

        // Persistance Supabase (fire & forget)
        supabase
          .from("user_stats")
          .upsert(
            {
              external_user_id: me.externalId,
              username: me.username,
              avatar_url: me.avatarUrl || null,
              group_color: me.groupColor || null,
              xp: newXp,
              level: newLevel,
              xp_to_next: xpToNext,
              ...extra,
            },
            { onConflict: "external_user_id" },
          )
          .then(({ error: e }) => {
            if (e) console.warn("[XP] persist error:", e.message);
          });
      };

      // Charge les niveaux d'une liste d'external_user_id (autres utilisateurs)
      const loadUserLevels = async (externalIds) => {
        if (!externalIds || externalIds.length === 0) return;

        // Filtre ceux qu'on n'a pas encore chargés
        const toFetch = externalIds.filter(
          (id) => id && id !== me.externalId && userLevels[id] == null,
        );
        if (toFetch.length === 0) return;

        const { data } = await supabase
          .from("user_stats")
          .select("external_user_id,level")
          .in("external_user_id", toFetch);

        for (const row of data || []) {
          if (row.external_user_id)
            userLevels[row.external_user_id] = row.level ?? 1;
        }
      };

      // Appelée depuis l'extérieur (bouton réaction / système de likes)
      const giveReactionXp = () => grantXp(XP_PER_REACTION, "reaction");

      // ⚙️ Test — déclenche l'animation level-up manuellement
      const testLevelUp = () => {
        xpStats.leveledUp = true;
        setTimeout(() => {
          xpStats.leveledUp = false;
        }, 4000);
      };

      // Suivi du temps en chat (déclenché à chaque ping de présence)
      let _lastXpPing = Date.now();
      const trackTimeXp = () => {
        if (!me.canWrite) return;
        const now = Date.now();
        const minutes = Math.floor((now - _lastXpPing) / 60_000);
        _lastXpPing = now;
        if (minutes > 0) void grantXp(minutes * XP_PER_MINUTE, "time");
      };

      // ----------------------------
      // IMAGE PASTE + STORAGE (avec slug du nom de la room)
      // ----------------------------
      const uploadAndSendImage = async (file) => {
        if (!me.canWrite || !activeRoom.value || ui.sending) return;
        if (!file.type.startsWith("image/")) return;

        const MAX_SIZE = 8 * 1024 * 1024;
        if (file.size > MAX_SIZE) {
          error.value = "Image trop volumineuse (max 8 Mo)";
          return;
        }

        const rid = roomId.value;
        const roomSlug = slugify(activeRoom.value?.name || `room-${rid}`);
        const ext = (file.name.split(".").pop() || "png").toLowerCase();
        const fileName = `rooms/${roomSlug}/${Date.now()}-${Math.random().toString(36).slice(2, 11)}.${ext}`;

        ui.sending = true;
        error.value = "";

        try {
          const { error: uploadErr } = await supabase.storage
            .from("chat-attachments")
            .upload(fileName, file, {
              contentType: file.type,
              cacheControl: "3600",
              metadata: {
                room_id: String(rid),
                room_slug: roomSlug,
                uploaded_by: me.externalId || "unknown",
                uploaded_at: new Date().toISOString(),
              },
            });

          if (uploadErr) throw uploadErr;

          const {
            data: { publicUrl },
          } = supabase.storage.from("chat-attachments").getPublicUrl(fileName);

          const { data: insertedImg, error: insertErr } = await supabase
            .from("chat_messages")
            .insert({
              room_id: rid,
              external_user_id: me.externalId,
              username: me.username,
              avatar_url: me.avatarUrl || null,
              group_color: me.groupColor || null,
              content: `![Image collée](${publicUrl})`,
              reply_to_message_id: reply.id || null,
              reply_to_username: reply.username || null,
              reply_to_excerpt: reply.excerpt || null,
            })
            .select()
            .single();

          if (insertErr) throw insertErr;
          cancelReply();

          // ✅ Broadcast Supabase
          if (typingChannel && insertedImg) {
            const mid = Number(insertedImg.id);
            if (Number.isFinite(mid)) getSeenSet(rid).add(mid);
            void typingChannel.send({
              type: "broadcast",
              event: "new-message",
              payload: {
                message: {
                  ...insertedImg,
                  avatar_url: safeUrl(insertedImg.avatar_url),
                },
              },
            });
          }
        } catch (e) {
          error.value = `Upload image : ${e.message}`;
          console.error(e);
        } finally {
          ui.sending = false;
        }
      };

      const handlePaste = (e) => {
        if (document.activeElement !== draftEl.value) return;
        for (const item of e.clipboardData?.items || []) {
          if (item.kind === "file" && item.type.indexOf("image") !== -1) {
            e.preventDefault();
            const file = item.getAsFile();
            if (file) uploadAndSendImage(file);
            return;
          }
        }
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

      watch(draft, () => {
        nextTick(resizeDraft);
      });

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
        await new Promise((r) => requestAnimationFrame(r));

        const el = messagesEl.value;
        if (!el) return;

        initPrismMarkdown(el);

        const doScroll = () => {
          el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
        };

        doScroll();

        // Rescroller à chaque fois que le layout change (images qui se chargent)
        await new Promise((resolve) => {
          let stableFrames = 0;
          let lastHeight = el.scrollHeight;
          const MAX_FRAMES = 60; // ~1s à 60fps
          let frames = 0;

          const ro = new ResizeObserver(() => doScroll());
          ro.observe(el);

          const check = () => {
            frames++;
            const h = el.scrollHeight;
            if (h !== lastHeight) {
              lastHeight = h;
              stableFrames = 0;
              doScroll();
            } else stableFrames++;

            if (stableFrames >= 3 || frames >= MAX_FRAMES) {
              ro.disconnect();
              doScroll();
              resolve();
            } else {
              requestAnimationFrame(check);
            }
          };
          requestAnimationFrame(check);
        });
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
            "id,room_id,external_user_id,username,avatar_url,group_color,content,created_at,reply_to_message_id,reply_to_username,reply_to_excerpt,deleted_at,deleted_by,pinned_at,pinned_by",
          )
          .eq("room_id", rid)
          .order("id", { ascending: false })
          .limit(PAGE_SIZE);

        ui.loadingMessages = false;

        if (e) {
          error.value = `Messages: ${e.message}`;
          messages.value = [];
          const st = getPaging(rid);
          st.oldestId = null;
          st.hasMore = false;
          return;
        }

        const desc = normalizeMessages(data);
        const asc = desc.slice().reverse();

        messages.value = asc;

        const st = getPaging(rid);
        st.oldestId = asc.length ? Number(asc[0].id) : null;
        st.hasMore = desc.length === PAGE_SIZE;

        const seen = getSeenSet(rid);
        seen.clear();
        for (const mm of asc) {
          const id = Number(mm?.id);
          if (Number.isFinite(id)) seen.add(id);
        }

        // Charge les niveaux des auteurs des messages
        const ids = [
          ...new Set(asc.map((mm) => mm?.external_user_id).filter(Boolean)),
        ];
        void loadUserLevels(ids);

        // Collecte les auteurs pour l'autocomplete @mention
        collectAuthors(asc);

        // Charge les réactions des messages
        void loadReactions(rid);

        // Charge les réactions de la room
        void loadReactions(rid);
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
            "id,room_id,external_user_id,username,avatar_url,group_color,content,created_at,reply_to_message_id,reply_to_username,reply_to_excerpt,deleted_at,deleted_by,pinned_at,pinned_by",
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

        const current = messages.value || [];
        const merged = [...olderAsc, ...current];

        messages.value = merged;

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
        if (!opts.force && rid === roomId.value) return;

        // Capture le nombre de non-lus AVANT de réinitialiser
        const pendingUnread = unreadCount(rid);

        roomId.value = rid;
        resetUnread(rid);
        showPinned.value = false;
        mention.open = false;
        firstUnreadId.value = null; // reset du séparateur

        messages.value = [];
        await loadLatestMessages(rid);

        // Positionne le séparateur sur le premier message non lu
        if (pendingUnread > 0 && messages.value.length > 0) {
          const realMessages = messages.value.filter(
            (m) => m && Number.isFinite(Number(m.id)),
          );
          const sepIndex = realMessages.length - pendingUnread;
          if (sepIndex >= 0 && sepIndex < realMessages.length) {
            firstUnreadId.value = realMessages[sepIndex].id;
          }
        }

        // Scroll : séparateur "NOUVEAU" > mention non lue > bas
        // La mention ne justifie un scroll que si elle est dans un message non lu
        const unreadMessages =
          pendingUnread > 0
            ? messages.value
                .filter((m) => m && Number.isFinite(Number(m.id)))
                .slice(-pendingUnread)
            : [];
        const firstUnreadMention = unreadMessages.find((m) => isMentioned(m));

        if (firstUnreadId.value) {
          await scrollToMessage("sep-new", { smooth: false });
        } else if (firstUnreadMention) {
          await scrollToMessage(firstUnreadMention.id, { smooth: false });
        } else {
          await scrollBottom();
        }

        await markActiveRoomRead();
        void loadPinnedMessages(rid);
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
          group_color: me.groupColor || null,
          content,
          created_at: new Date().toISOString(),
          _local: true,

          // reply (UI + optimistic)
          reply_to_message_id: replySnap.id,
          reply_to_username: replySnap.username,
          reply_to_excerpt: replySnap.excerpt,
        };

        messages.value.push(localMsg);

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
          group_color: me.groupColor || null,
          content,

          reply_to_message_id: replySnap.id,
          reply_to_username: replySnap.username,
          reply_to_excerpt: replySnap.excerpt,
        };

        const { data: inserted, error: e } = await supabase
          .from("chat_messages")
          .insert(payload)
          .select()
          .single();

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
        } else {
          void grantXp(XP_PER_MESSAGE, "message"); // ✅ XP message envoyé
          clearFirstUnread();

          // ✅ Remplace immédiatement le message local par la row serveur (ID réel)
          const pend = pendingLocalByRoom.get(String(rid));
          if (pend && inserted) {
            // Marque l'ID comme vu pour éviter un doublon via Realtime
            const mid = Number(inserted.id);
            if (Number.isFinite(mid)) getSeenSet(rid).add(mid);

            const idx = messages.value.findIndex(
              (x) => String(x?.id) === String(pend.tempId),
            );
            if (idx >= 0) {
              inserted.avatar_url = safeUrl(inserted.avatar_url);
              messages.value[idx] = { ...messages.value[idx], ...inserted };
            }
            pendingLocalByRoom.delete(String(rid));
          }

          // ✅ Broadcast Supabase — synchronise les autres clients
          // (postgres_changes n'est pas fiable sans config publication/RLS côté Supabase)
          if (typingChannel && inserted) {
            void typingChannel.send({
              type: "broadcast",
              event: "new-message",
              payload: { message: inserted },
            });
          }
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
          group_color: me.groupColor || null,
          content,
          created_at: new Date().toISOString(),
          _local: true,

          reply_to_message_id: replySnap.id,
          reply_to_username: replySnap.username,
          reply_to_excerpt: replySnap.excerpt,
        };

        messages.value.push(localMsg);

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
          group_color: me.groupColor || null,
          content,

          reply_to_message_id: replySnap.id,
          reply_to_username: replySnap.username,
          reply_to_excerpt: replySnap.excerpt,
        };

        const { data: inserted, error: e } = await supabase
          .from("chat_messages")
          .insert(payload)
          .select()
          .single();

        ui.sending = false;

        if (e) {
          // rollback local
          const idx = messages.value.findIndex(
            (x) => String(x?.id) === String(tempId),
          );
          if (idx >= 0) messages.value.splice(idx, 1);
          pendingLocalByRoom.delete(String(rid));
          error.value = `Envoyer GIF: ${e.message}`;
        } else {
          void grantXp(XP_PER_MESSAGE, "message"); // ✅ XP gif envoyé

          // ✅ Remplace immédiatement le message local par la row serveur (ID réel)
          const pend = pendingLocalByRoom.get(String(rid));
          if (pend && inserted) {
            // Marque l'ID comme vu pour éviter un doublon via Realtime
            const mid = Number(inserted.id);
            if (Number.isFinite(mid)) getSeenSet(rid).add(mid);

            const idx = messages.value.findIndex(
              (x) => String(x?.id) === String(pend.tempId),
            );
            if (idx >= 0) {
              inserted.avatar_url = safeUrl(inserted.avatar_url);
              messages.value[idx] = { ...messages.value[idx], ...inserted };
            }
            pendingLocalByRoom.delete(String(rid));
          }

          // ✅ Broadcast Supabase
          if (typingChannel && inserted) {
            void typingChannel.send({
              type: "broadcast",
              event: "new-message",
              payload: { message: inserted },
            });
          }
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
          .select(
            "page_key,external_user_id,username,avatar_url,group_color,last_seen",
          )
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
        trackTimeXp(); // ✅ comptabilise le temps passé dans le chat
        const row = {
          page_key: PRESENCE_PAGE_KEY,
          external_user_id: me.externalId,
          username: me.username,
          avatar_url: me.avatarUrl || null,
          group_color: me.groupColor || null,
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
            { event: "INSERT", schema: "public", table: "message_reactions" },
            (payload) => {
              const r = payload?.new;
              if (!r || !r.message_id) return;
              const k = String(r.message_id);
              if (!reactions[k]) reactions[k] = [];
              // Évite les doublons (optimiste déjà inséré)
              if (
                !reactions[k].some(
                  (x) =>
                    x.id === r.id || x.external_user_id === r.external_user_id,
                )
              ) {
                reactions[k].push(r);
              }
            },
          )
          .on(
            "postgres_changes",
            { event: "UPDATE", schema: "public", table: "message_reactions" },
            (payload) => {
              const r = payload?.new;
              if (!r || !r.message_id) return;
              const k = String(r.message_id);
              if (!reactions[k]) return;
              const idx = reactions[k].findIndex((x) => x.id === r.id);
              if (idx >= 0) reactions[k][idx] = r;
            },
          )
          .on(
            "postgres_changes",
            { event: "DELETE", schema: "public", table: "message_reactions" },
            (payload) => {
              const r = payload?.old;
              if (!r?.message_id) return;
              const k = String(r.message_id);
              if (!reactions[k]) return;
              reactions[k] = reactions[k].filter((x) => x.id !== r.id);
            },
          )
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "chat_messages" },
            (payload) => {
              const m = payload?.new;
              if (!m || m.id == null || m.room_id == null) return;

              const rid = m.room_id;

              // Dédup : vérifie si déjà traité, mais ne marque PAS comme vu
              // tant que le message n'est pas effectivement affiché.
              // Sinon, le broadcast (fallback fiable) serait bloqué à tort.
              const mid = Number(m.id);
              if (Number.isFinite(mid)) {
                const seen = getSeenSet(rid);
                if (seen.has(mid)) return;
              }

              m.avatar_url = safeUrl(m.avatar_url);

              // Charge le niveau si c'est un nouvel auteur qu'on ne connaît pas encore
              if (m.external_user_id && m.external_user_id !== me.externalId) {
                void loadUserLevels([m.external_user_id]);
              }

              // Ajoute à roomAuthors si nouvel auteur
              if (
                m.external_user_id &&
                !roomAuthors.value.some(
                  (u) => u.external_user_id === m.external_user_id,
                )
              ) {
                roomAuthors.value = [
                  ...roomAuthors.value,
                  {
                    external_user_id: m.external_user_id,
                    username: m.username || "",
                    avatar_url: safeUrl(m.avatar_url || ""),
                  },
                ];
              }

              // Efface l'indicateur de frappe dès que le message arrive
              if (m.external_user_id && typingUsers[m.external_user_id]) {
                delete typingUsers[m.external_user_id];
              }

              // Comparaison en String pour éviter tout problème de type number vs string
              if (String(rid) === String(roomId.value)) {
                // ✅ Marque comme vu MAINTENANT (le message va être affiché)
                if (Number.isFinite(mid)) getSeenSet(rid).add(mid);

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

                scrollBottom();
                markActiveRoomRead();
              } else {
                // ⚠️ NE PAS marquer comme vu ici : on laisse le broadcast
                // gérer l'affichage si l'utilisateur est dans cette room.
                if (enableUnread.value) {
                  const k = String(rid);
                  // Initialise la clé si elle n'existe pas encore (nouvelle room)
                  if (!(k in unread)) unread[k] = 0;
                  unread[k] = unread[k] + 1;
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

              // Soft delete reçu en Realtime → met à jour le message (garde la ligne visible)
              if (m.deleted_at) {
                if (rid === roomId.value) {
                  const idx = messages.value.findIndex(
                    (x) => String(x?.id) === String(m.id),
                  );
                  if (idx >= 0)
                    messages.value[idx] = {
                      ...messages.value[idx],
                      deleted_at: m.deleted_at,
                      deleted_by: m.deleted_by ?? "author",
                    };
                }
                pinnedMessages.value = pinnedMessages.value.filter(
                  (x) => String(x.id) !== String(m.id),
                );
                return;
              }

              // Pin / unpin reçu en Realtime
              if (rid === roomId.value) {
                if (m.pinned_at) {
                  const pi = pinnedMessages.value.findIndex(
                    (x) => String(x.id) === String(m.id),
                  );
                  const entry = { ...m, avatar_url: safeUrl(m.avatar_url) };
                  if (pi >= 0) pinnedMessages.value[pi] = entry;
                  else pinnedMessages.value = [entry, ...pinnedMessages.value];
                } else {
                  pinnedMessages.value = pinnedMessages.value.filter(
                    (x) => String(x.id) !== String(m.id),
                  );
                }
              }

              if (rid === roomId.value) {
                const idx = messages.value.findIndex(
                  (x) => String(x?.id) === String(m.id),
                );
                if (idx >= 0)
                  messages.value[idx] = { ...messages.value[idx], ...m };
              }
            },
          )
          .subscribe();

        // Channel réactions
        supabase
          .channel("rt-reactions")
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "message_reactions" },
            ({ payload: p }) => {
              const r = p?.new;
              if (!r?.message_id || !r?.emoji) return;
              const mid = String(r.message_id);
              if (!reactions[mid]) reactions[mid] = [];
              const existing = reactions[mid].find((x) => x.emoji === r.emoji);
              if (existing) {
                existing.count++;
                existing.users.add(r.external_user_id);
              } else
                reactions[mid].push({
                  emoji: r.emoji,
                  count: 1,
                  users: new Set([r.external_user_id]),
                });
            },
          )
          .on(
            "postgres_changes",
            { event: "DELETE", schema: "public", table: "message_reactions" },
            ({ payload: p }) => {
              const r = p?.old;
              if (!r?.message_id || !r?.emoji) return;
              const mid = String(r.message_id);
              const idx =
                reactions[mid]?.findIndex((x) => x.emoji === r.emoji) ?? -1;
              if (idx >= 0) {
                reactions[mid][idx].count--;
                reactions[mid][idx].users.delete(r.external_user_id);
                if (reactions[mid][idx].count <= 0)
                  reactions[mid].splice(idx, 1);
              }
            },
          )
          .subscribe();
      };
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

        await selectRoom(data.id, { force: true });
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
        if (target) await selectRoom(target, { force: true });
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
        await loadUserStats(); // ✅ charge les stats XP de l'utilisateur
        presenceTimer = window.setInterval(upsertPresence, PRESENCE_PING_MS);
        presenceCleanupTimer = window.setInterval(() => {
          const cutoff = Date.now() - ACTIVE_MINUTES * 60_000;
          presence.value = presence.value.filter(
            (u) => new Date(u.last_seen).getTime() >= cutoff,
          );
        }, 60_000);
        typingCleanupTimer = window.setInterval(() => {
          const cutoff = Date.now() - TYPING_TTL_MS;
          for (const [key, u] of Object.entries(typingUsers)) {
            if (u.at < cutoff) delete typingUsers[key];
          }
        }, 1000);

        // Rafraîchit les compteurs de non-lus toutes les 15s
        // (couvre le cas où le Realtime ne reçoit pas les messages des autres rooms)
        unreadTimer = window.setInterval(async () => {
          if (enableUnread.value) await loadPersistentUnread();
        }, 15_000);

        if (target) await selectRoom(target, { force: true });

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
        if (typingChannel) supabase.removeChannel(typingChannel);

        if (presenceTimer) window.clearInterval(presenceTimer);
        if (presenceCleanupTimer) window.clearInterval(presenceCleanupTimer);
        if (typingCleanupTimer) window.clearInterval(typingCleanupTimer);
        if (unreadTimer) window.clearInterval(unreadTimer);
      });

      // ----------------------------
      // SÉPARATEURS PAR JOUR
      // ----------------------------
      const dayLabelFmt = new Intl.DateTimeFormat("fr-CA", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });

      const dayKey = (iso) => {
        const d = new Date(iso);
        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      };

      const dayLabel = (iso) => {
        const now = new Date();
        const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        const yesterdayKey = `${yesterday.getFullYear()}-${yesterday.getMonth()}-${yesterday.getDate()}`;
        const k = dayKey(iso);
        if (k === todayKey) return "Aujourd'hui";
        if (k === yesterdayKey) return "Hier";
        return dayLabelFmt.format(new Date(iso));
      };

      const GROUP_DELAY_MS = 5 * 60_000; // 5 minutes

      const messagesWithSeparators = computed(() => {
        const result = [];
        let lastKey = null;
        let newMsgInserted = false;

        // Grouping state — reset on any separator
        let groupUserId = null;
        let groupAnchorTs = 0;

        for (const m of messages.value) {
          if (!m?.created_at) {
            result.push(m);
            groupUserId = null; // reset group
            continue;
          }

          let separatorInserted = false;

          // Séparateur "NOUVEAU" — avant le premier message non lu
          if (
            !newMsgInserted &&
            firstUnreadId.value != null &&
            String(m.id) === String(firstUnreadId.value)
          ) {
            result.push({ type: "new-messages", key: "sep-new" });
            newMsgInserted = true;
            separatorInserted = true;
          }

          const k = dayKey(m.created_at);
          if (k !== lastKey) {
            lastKey = k;
            result.push({
              type: "day-separator",
              key: "sep-" + k,
              label: dayLabel(m.created_at),
            });
            separatorInserted = true;
          }

          // Détermine si ce message appartient au groupe précédent
          const ts = new Date(m.created_at).getTime();
          const sameUser =
            !separatorInserted &&
            groupUserId != null &&
            m.external_user_id === groupUserId;
          const withinDelay = sameUser && ts - groupAnchorTs < GROUP_DELAY_MS;
          const grouped = sameUser && withinDelay && !m.deleted_at;

          if (!grouped) {
            // Nouveau groupe
            groupUserId = m.external_user_id;
            groupAnchorTs = ts;
          }

          result.push({ ...m, _grouped: grouped });
        }
        return result;
      });

      // ----------------------------
      // PROFIL URL
      // ----------------------------
      /** Retourne le lien vers le profil forum d'un utilisateur, ex. "/u123" */
      const profileUrl = (externalUserId) => {
        const id = String(externalUserId ?? "").trim();
        if (!id || id === "0" || id === "-1") return null;
        return `/u${id}`;
      };

      /**
       * Retourne la couleur de groupe d'un message (hex validé) ou null.
       * Utilisable dans le template : :style="groupColorOf(m) ? { color: groupColorOf(m) } : null"
       */
      const groupColorOf = (m) => {
        const raw = m?.group_color ?? null;
        if (!raw) return null;
        const c = raw.startsWith("#") ? raw : `#${raw}`;
        return /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : null;
      };

      return {
        me,
        ui,
        profileUrl,
        groupColorOf,

        roomsSafe,
        roomId,
        activeRoom,
        isTopicRoom,
        roomLabel,

        messages,
        messagesWithSeparators,
        messagesEl,
        onMessagesScroll,
        timeAgo,
        formatFullDate,

        draft,
        draftEl,
        resizeDraft,
        sendFromDraft,
        onDraftArrowUp,
        handlePaste,

        // edit
        edit,
        editEl,
        isEditing,
        startEditMessage,
        resizeEdit,
        saveEdit,
        cancelEdit,
        deleteMessage,

        newRoomName,
        createRoom,

        unreadCount,
        firstUnreadId,
        selectRoom,

        activeUsersStack,
        activeUsersOverflow,

        typingList,

        // réactions
        reactions,
        getReactions,
        myReactionEmoji,
        toggleReaction,
        reactionPicker,
        reactionPickerEl,
        reactionPickerFiltered,
        toggleReactionPicker,

        // classement XP
        leaderboard,
        leaderboardLoading,
        showLeaderboard,
        leaderboardBtnEl,
        leaderboardPopEl,
        myLeaderboardRank,

        pinnedMessages,
        pinnedCount,
        showPinned,
        pinnedBtnEl,
        pinnedPopEl,
        togglePin,
        scrollToMessage,

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
        replyExcerptLabel,

        // réactions
        reactions,
        reactionTarget,
        toggleReaction,
        openReactionPicker,

        // markdown + mentions
        renderMarkdown,
        renderWithMentions,
        isMentioned,
        mention,
        mentionFiltered,
        insertMention,
        onDraftInput,
        onMentionKeydown,

        // XP & niveaux
        xpStats,
        userLevels,
        giveReactionXp,
        testLevelUp,
      };
    },
  });

  const el = document.getElementById("chat");
  if (!el) return;

  app.mount(el);
  window.__faChatUnmount = () => app.unmount();
};
