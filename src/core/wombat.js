export const initWombat = (supabase) => {
  if (!window.Wombat) return;

  const fmt = (n) => {
    if (typeof n !== "number") return "—";
    return n >= 1000
      ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k"
      : String(n);
  };

  const set = (aside, id, val) => {
    const el = aside.querySelector("#" + id);
    if (el) el.textContent = val;
  };

  /**
   * Parse le div #stats-fields en un objet { label: valeur }
   * ex: { "Date d'inscription": "28/08/2025", "Localisation": "Paris", ... }
   */
  const parseFields = (aside) => {
    const container = aside.querySelector("#stat-fields");
    if (!container) return {};

    const fields = {};
    container.querySelectorAll("[id^='field_id']").forEach((field) => {
      const label = field
        .querySelector("dt")
        ?.textContent.replace(/\s*:\s*$/, "")
        .trim();
      const value = field
        .querySelector(".field_uneditable")
        ?.textContent.replace(/&nbsp;/g, "")
        .trim();

      if (label && value && value !== "-") fields[label] = value;
    });
    return fields;
  };

  new Wombat({
    afterLoad: async function (aside, overlay) {
      const fields = parseFields(aside);
      // Exemples d'utilisation :
      // fields["Date d'inscription"] → "28/08/2025"
      // fields["Localisation"]       → "Paris"
      // fields["Messages"]           → "69"
      //
      console.log(fields);
      const raw = fields["Date d'inscription"];
      const [day, month, year] = (raw ?? "").split("/");
      const date = new Date(year, month - 1, day);
      const label = date.toLocaleDateString("fr-FR", {
        month: "long",
        year: "numeric",
      });
      set(aside, "stat-join", raw ? `Membre depuis ${label}` : "—");

      const wombatEl = aside.querySelector("#wombat");
      const externalId = wombatEl?.dataset?.externalId?.trim();
      if (!externalId || externalId === "0") return;

      const { data } = await supabase
        .from("user_stats")
        .select("xp,level,xp_to_next,messages_sent,reactions_given")
        .eq("external_user_id", externalId)
        .maybeSingle();

      if (!data) return;

      set(aside, "stat-messages", fmt(data.messages_sent ?? 0));
      set(aside, "stat-posts", fields["Messages"]);
      set(aside, "stat-reactions", fmt(data.reactions_given ?? 0));
      set(aside, "stat-xp", fmt(data.xp ?? 0));

      const xp = data.xp ?? 0;
      const xpNext = data.xp_to_next ?? 100;
      const level = data.level ?? 1;
      const pct = Math.min(100, Math.round((xp / xpNext) * 100));

      set(aside, "xp-label", "Niveau " + level + " → " + (level + 1));

      requestAnimationFrame(() => {
        const bar = aside.querySelector("#xp-bar");
        if (bar) bar.style.width = pct + "%";
      });
    },
  });
};
