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

  const PRESENCE_PAGE_KEY = "forumactif-chat"; // ou un truc par forum/section
  const ACTIVE_MINUTES = 8; // 5 à 10 -> je mets 10
  const PRESENCE_PING_MS = 45_000; // heartbeat
  const MAX_STACK = 4;

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
      const diff = Math.round((t - Date.now()) / 1000); // seconds (+ future / - past)
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

  const app = createApp({
    setup() {
      const me = reactive(readUserdata());
      me.avatarUrl = safeUrl(me.avatarUrl);

      const rooms = ref([]);
      const adminRooms = ref([]);
      const autoRoom = ref(null);
      const roomId = ref(null);
      const messages = ref([]);

      const draft = ref("");
      const draftEl = ref(null);
      const newRoomName = ref("");
      const error = ref("");

      const presence = ref([]);
      const presenceMap = new Map();

      const enableUnread = computed(() => me.canWrite);

      const ui = reactive({
        open: true,
        showCreate: false,
        loadingRooms: false,
        loadingMessages: false,
        creatingRoom: false,
        sending: false,
      });

      const messagesEl = ref(null);

      // Map unread: { [roomId]: number }
      const unread = reactive({});
      const unreadCount = (rid) => {
        if (!enableUnread.value) return 0;
        const k = String(rid ?? "");
        const v = unread[k];
        return Number.isFinite(v) ? v : 0;
      };

      const resetUnread = (rid) => {
        if (!enableUnread.value) return;
        const k = String(rid ?? "");
        unread[k] = 0;
      };
      // Déduplication des messages (protège contre double subscription / reconnect)
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

      // Message local optimiste en attente par room
      const pendingLocalByRoom = new Map(); // rid -> { tempId, content, at }

      const roomsSafe = computed(() =>
        (Array.isArray(rooms.value) ? rooms.value : []).filter(
          (r) => r && r.id != null && typeof r.name === "string",
        ),
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

      const activeRoom = computed(
        () => roomsSafe.value.find((r) => r.id === roomId.value) || null,
      );

      const resizeDraft = () => {
        const el = draftEl.value;
        if (!el) return;

        // reset pour recalculer
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

      const sendFromDraft = async () => {
        if (!canSend.value) return;
        await send(); // ton send() existant (insert supabase + draft="")
        await nextTick(); // attendre que draft soit vidé
        resizeDraft(); // revient à 1 ligne
        draftEl.value?.focus({ preventScroll: true });
      };

      // optionnel mais utile au premier render / si draft est modifié par code
      onMounted(() => nextTick(resizeDraft));
      watch(draft, () => nextTick(resizeDraft));

      /* auto rooms */
      const getAutoSpecFromPath = (pathname) => {
        // Forumactif: /t123-... (on ignore /f...)
        const mt = pathname.match(/^\/t(\d+)/i);
        if (!mt) return null;

        const id = mt[1];
        const pathKey = `/t${id}`;
        return {
          kind: "t",
          id,
          pathKey,
          roomKey: `path:${pathKey}`,
          name: makeAutoRoomName("t", id),
        };
      };

      const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

      const makeAutoRoomName = (kind, id) => {
        const og = document.querySelector("title")?.content?.trim();
        const base = (og || document.title || "").trim();
        const label = kind === "t" ? `Sujet #${id}` : `Forum #${id}`;
        if (!base) return label;
        return truncate(`${label} — ${base}`, 80);
      };

      const ensureAutoRoom = async (spec) => {
        // 1) try select
        const { data: existing, error: selErr } = await supabase
          .from("chatrooms")
          .select("id,name,created_at,is_auto,room_key,path_key,kind")
          .eq("room_key", spec.roomKey)
          .limit(1)
          .maybeSingle();

        if (existing) return existing;

        // 2) insert (may race -> unique constraint)
        const row = {
          name: spec.name,
          is_auto: true,
          room_key: spec.roomKey,
          path_key: spec.pathKey,
          kind: spec.kind,
          // champs existants
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
      };

      const isTopicRoom = (r) => {
        if (!r) return false;
        // selon ton schéma: is_auto + kind === "t"
        if (r.is_auto === true && r.kind === "t") return true;

        // fallback si tu n’as pas kind partout
        const rk = String(r.room_key || "");
        const pk = String(r.path_key || "");
        return rk.startsWith("path:/t") || pk.startsWith("/t");
      };

      const roomLabel = (r) => {
        const name = String(r?.name || "");
        if (!isTopicRoom(r)) return name;

        // retire: "Sujet #123 — " (tolère espaces/—/-)
        const stripped = name.replace(/^Sujet\s*#?\d+\s*[—-]\s*/i, "").trim();
        return stripped || name;
      };

      const loadAdminRooms = async () => {
        ui.loadingRooms = true;
        error.value = "";

        const { data, error: e } = await supabase
          .from("chatrooms")
          .select("id,name,created_at,is_auto,room_key,path_key,kind")
          // admin rooms = is_auto false (ou null si anciennes rows)
          .or("is_auto.is.null,is_auto.eq.false")
          .order("created_at", { ascending: true });

        ui.loadingRooms = false;
        if (e) {
          error.value = `Rooms: ${e.message}`;
          adminRooms.value = [];
          return;
        }

        adminRooms.value = (data || []).filter((r) => r && r.id != null);
      };

      const syncRoomsForCurrentPath = async () => {
        await loadAdminRooms();

        const spec = getAutoSpecFromPath(window.location.pathname);
        if (spec) {
          try {
            autoRoom.value = await ensureAutoRoom(spec);
          } catch (e) {
            error.value = `Auto-room: ${e.message || String(e)}`;
            autoRoom.value = null;
          }
        } else {
          autoRoom.value = null;
        }

        // ✅ rooms list = admin rooms + (auto room seulement si on est sur ce path)
        rooms.value = autoRoom.value
          ? [autoRoom.value, ...adminRooms.value]
          : [...adminRooms.value];

        // auto-select: si on est sur /t ou /f, on bascule sur la room auto
        if (autoRoom.value?.id && roomId.value !== autoRoom.value.id) {
          await selectRoom(autoRoom.value.id);
        } else if (!autoRoom.value && rooms.value.length && !roomId.value) {
          await selectRoom(rooms.value[0].id);
        }
      };

      const canSend = computed(
        () =>
          !!activeRoom.value &&
          me.canWrite &&
          draft.value.trim().length > 0 &&
          !ui.sending,
      );

      const loadPersistentUnread = async () => {
        if (!enableUnread.value) return;
        const { data, error: e } = await supabase.rpc("list_unread_counts", {
          p_external_user_id: me.externalId,
        });
        if (e) {
          // optionnel: error.value = `Unread: ${e.message}`;
          return;
        }

        // reset puis remplissage
        for (const k of Object.keys(unread)) delete unread[k];
        for (const row of data || []) {
          unread[String(row.room_id)] = Number(row.unread_count) || 0;
        }
      };

      const markActiveRoomRead = async () => {
        if (!enableUnread.value) return;
        if (!roomId.value) return;

        const lastId = messages.value.length
          ? Number(messages.value[messages.value.length - 1].id)
          : 0;

        await supabase.rpc("mark_room_read", {
          p_room_id: roomId.value,
          p_external_user_id: me.externalId,
          p_last_read_message_id: lastId,
        });

        unread[String(roomId.value)] = 0;
      };

      const scrollBottom = async () => {
        await nextTick();
        const el = messagesEl.value;
        if (!el) return;

        // 1) saute direct en bas
        el.scrollTop = el.scrollHeight;

        // 2) puis re-saute après layout (images/fonts/padding/sticky)
        requestAnimationFrame(() => {
          const el2 = messagesEl.value;
          if (!el2) return;
          el2.scrollTop = el2.scrollHeight;

          requestAnimationFrame(() => {
            const el3 = messagesEl.value;
            if (!el3) return;
            el3.scrollTop = el3.scrollHeight;
          });
        });
      };

      const loadPresence = async () => {
        const cutoffIso = new Date(
          Date.now() - ACTIVE_MINUTES * 60_000,
        ).toISOString();
        const { data, error: e } = await supabase
          .from("chat_presence")
          .select("page_key,external_user_id,username,avatar_url,last_seen")
          .eq("page_key", PRESENCE_PAGE_KEY)
          .gte("last_seen", cutoffIso)
          .order("last_seen", { ascending: false })
          .limit(50);

        if (!e) {
          presence.value = (data || []).map((u) => ({
            ...u,
            avatar_url: u.avatar_url ? safeUrl(u.avatar_url) : "",
          }));
        }
      };

      const upsertPresence = async () => {
        // si invité sans id, on peut ignorer la présence
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

      let presenceTimer = null;
      let presenceChannel = null;

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

              // upsert local (par id)
              const idx = presence.value.findIndex(
                (x) => x?.external_user_id === fixed.external_user_id,
              );
              if (idx >= 0) presence.value[idx] = fixed;
              else presence.value.unshift(fixed);
            },
          )
          .subscribe();
      };

      const loadRooms = async () => {
        ui.loadingRooms = true;
        error.value = "";
        const { data, error: e } = await supabase
          .from("chatrooms")
          .select("id,name,created_at")
          .order("created_at", { ascending: true });

        ui.loadingRooms = false;

        if (e) {
          error.value = `Rooms: ${e.message}`;
          rooms.value = [];
          return;
        }

        rooms.value = (data || []).filter((r) => r && r.id != null);
        // init unread keys
        for (const r of rooms.value) unread[String(r.id)] ??= 0;
      };

      const loadMessages = async (rid) => {
        ui.loadingMessages = true;
        error.value = "";
        const { data, error: e } = await supabase
          .from("chat_messages")
          .select(
            "id,room_id,external_user_id,username,avatar_url,content,created_at",
          )
          .eq("room_id", rid)
          .order("created_at", { ascending: true })
          .limit(200);

        ui.loadingMessages = false;

        if (e) {
          error.value = `Messages: ${e.message}`;
          messages.value = [];
          return;
        }

        messages.value = (data || []).map((m) => ({
          ...m,
          avatar_url: safeUrl(m.avatar_url),
        }));

        // reset seen set for this room
        const seen = getSeenSet(rid);
        seen.clear();
        for (const mm of messages.value) {
          const id = Number(mm?.id);
          if (Number.isFinite(id)) seen.add(id);
        }

        await scrollBottom();
      };

      const selectRoom = async (rid) => {
        if (rid == null) return;
        roomId.value = rid;
        resetUnread(rid);
        messages.value = [];
        await loadMessages(rid);
        await markActiveRoomRead();
      };

      const createRoom = async () => {
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
          .select("id,name,created_at")
          .single();

        ui.creatingRoom = false;

        if (e) {
          error.value = `Créer room: ${e.message}`;
          return;
        }

        if (!data || data.id == null) return;

        // add if missing
        if (!rooms.value.some((r) => r && r.id === data.id)) {
          rooms.value.push(data);
        }
        unread[String(data.id)] ??= 0;

        newRoomName.value = "";
        ui.showCreate = false;

        await selectRoom(data.id);
      };

      const send = async () => {
        if (!canSend.value) return;
        if (ui.sending) return;

        const rid = roomId.value;
        const content = draft.value.trim();
        if (!content) return;

        ui.sending = true;
        error.value = "";

        // UI optimiste: afficher tout de suite, sans attendre Realtime
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
        };

        messages.value.push(localMsg);
        pendingLocalByRoom.set(String(rid), {
          tempId,
          content,
          at: Date.now(),
        });
        draft.value = "";
        void scrollBottom();

        // insert DB
        const payload = {
          room_id: rid,
          external_user_id: me.externalId,
          username: me.username,
          avatar_url: me.avatarUrl || null,
          content,
        };

        const { error: e } = await supabase
          .from("chat_messages")
          .insert(payload);

        ui.sending = false;

        if (e) {
          // rollback optimiste
          const pend = pendingLocalByRoom.get(String(rid));
          if (pend) {
            const idx = messages.value.findIndex(
              (x) => String(x?.id) === String(pend.tempId),
            );
            if (idx >= 0) messages.value.splice(idx, 1);
            pendingLocalByRoom.delete(String(rid));
          }
          error.value = `Envoyer: ${e.message}`;
          return;
        }

        // le message réel arrive via realtime (on remplacera le local)
      };

      const subscribeRealtime = () => {
        // rooms inserts
        roomsChannel = supabase
          .channel("rt-chatrooms")
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "chatrooms" },
            (payload) => {
              const r = payload?.new;
              if (!r || r.id == null || typeof r.name !== "string") return;

              unread[String(r.id)] ??= 0;
              if (!rooms.value.some((x) => x && x.id === r.id))
                rooms.value.push(r);
            },
          )
          .subscribe();

        // messages inserts (global) -> unread si pas la room active
        messagesChannel = supabase
          .channel("rt-chat-messages")
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "chat_messages" },
            (payload) => {
              const m = payload?.new;
              if (!m || m.id == null || m.room_id == null) return;

              const rid = m.room_id;

              // init unread key
              if (enableUnread.value) unread[String(rid)] ??= 0;

              // déduplication par id (protège contre double subscription / reconnect)
              const mid = Number(m.id);
              if (Number.isFinite(mid)) {
                const seen = getSeenSet(rid);
                if (seen.has(mid)) return;
                seen.add(mid);
              }

              m.avatar_url = safeUrl(m.avatar_url);

              // message pour la room active ?
              if (rid === roomId.value) {
                // remplace le message local optimiste correspondant (si présent)
                const pend = pendingLocalByRoom.get(String(rid));
                if (
                  pend &&
                  m.external_user_id === me.externalId &&
                  m.content === pend.content &&
                  Date.now() - pend.at < 15_000
                ) {
                  const idx = messages.value.findIndex(
                    (x) => String(x?.id) === String(pend.tempId),
                  );
                  if (idx >= 0) {
                    messages.value[idx] = m;
                  } else {
                    messages.value.push(m);
                  }
                  pendingLocalByRoom.delete(String(rid));
                } else {
                  messages.value.push(m);
                }

                scrollBottom();
                if (enableUnread.value) markActiveRoomRead();
              } else {
                if (enableUnread.value) {
                  unread[String(rid)] = (unread[String(rid)] || 0) + 1;
                }
              }
            },
          )
          .subscribe();
      };

      onMounted(async () => {
        await loadRooms();
        await syncRoomsForCurrentPath();
        if (enableUnread.value) await loadPersistentUnread();
        subscribeRealtime();

        // auto-select first room
        if (roomsSafe.value.length > 0) {
          await selectRoom(roomsSafe.value[0].id);
        }
      });

      onBeforeUnmount(() => {
        if (roomsChannel) supabase.removeChannel(roomsChannel);
        if (messagesChannel) supabase.removeChannel(messagesChannel);
      });

      onMounted(async () => {
        await loadPresence();
        subscribePresence();

        // ping immédiatement puis interval
        await upsertPresence();
        presenceTimer = window.setInterval(upsertPresence, PRESENCE_PING_MS);

        // (optionnel) nettoyage local toutes les minutes
        window.setInterval(() => {
          const cutoff = Date.now() - ACTIVE_MINUTES * 60_000;
          presence.value = presence.value.filter(
            (u) => new Date(u.last_seen).getTime() >= cutoff,
          );
        }, 60_000);
      });

      onBeforeUnmount(() => {
        if (presenceTimer) window.clearInterval(presenceTimer);
        if (presenceChannel) supabase.removeChannel(presenceChannel);
      });

      window.__faChatSyncPath = () => syncRoomsForCurrentPath();

      return {
        me,
        ui,
        roomsSafe,
        roomId,
        activeRoom,
        messages,
        draft,
        draftEl,
        resizeDraft,
        sendFromDraft,
        newRoomName,
        error,
        isTopicRoom,
        roomLabel,

        messagesEl,
        timeAgo,

        unreadCount,
        selectRoom,
        createRoom,
        send,
        canSend,

        activeUsersStack,
        activeUsersOverflow,
      };
    },
  });

  // IMPORTANT: le #chat doit exister dans le DOM au moment du mount (Barba)
  const el = document.getElementById("chat");
  if (!el) return;

  app.mount(el);
  window.__faChatUnmount = () => app.unmount();
};
