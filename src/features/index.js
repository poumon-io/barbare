/**
 * Fonction d'abréviation (réutilisable partout)
 */
function abbreviateNumber(num) {
  if (!num || num < 1000) return num?.toString() || "0";

  const units = ["", "k", "M", "G"];
  let unitIndex = 0;
  let value = num;

  while (value >= 1000 && unitIndex < units.length - 1) {
    value /= 1000;
    unitIndex++;
  }

  const formatted = value % 1 === 0 ? Math.floor(value) : value.toFixed(1);
  return formatted + units[unitIndex];
}

/**
 * Animation fluide de 0 → valeur finale (ease-out cubic)
 */
function animateCounter(element, target, options = {}) {
  if (!element || target === undefined || isNaN(target) || target < 0) {
    element && (element.textContent = "0");
    return;
  }

  const {
    duration = 200,
    suffix = "",
    abbreviate = false,
    locale = "fr-FR",
  } = options;

  let startTime = null;

  const step = (timestamp) => {
    if (!startTime) startTime = timestamp;
    const elapsed = timestamp - startTime;
    const progress = Math.min(elapsed / duration, 1);

    const ease = 1 - Math.pow(1 - progress, 3);
    const current = Math.floor(target * ease);

    element.textContent = current.toLocaleString(locale) + suffix;

    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      const final =
        abbreviate && target >= 1000
          ? abbreviateNumber(target)
          : target.toLocaleString(locale);
      element.textContent = final + suffix;
    }
  };

  requestAnimationFrame(step);
}

// ==================== CONFIGURATION CENTRALE ====================
const COUNTER_CONFIGS = [
  {
    id: "total-today-messages",
    type: "supabase",
    query: (sb) => {
      const now = new Date();
      const todayStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      ); // 00:00:00 aujourd'hui

      return sb
        .from("chat_messages")
        .select("*", { count: "exact" })
        .gte("created_at", todayStart.toISOString());
    },
    initText: "0 aujourd'hui",
    options: { suffix: " aujourd'hui" },
  },
  {
    id: "total-chat-messages",
    type: "supabase",
    query: (sb) => sb.from("chat_messages").select("*", { count: "exact" }),
    initText: "0",
    options: { abbreviate: true },
  },
  {
    id: "total-users",
    type: "static",
    getInitialValue: (el) =>
      parseInt(el.textContent.replace(/[^\d]/g, "")) || 0,
    initText: "0",
  },
  {
    id: "total-topics",
    type: "static",
    getInitialValue: () =>
      parseInt(
        document
          .querySelector("#mod-stats-topics")
          ?.textContent.replace(/[^\d]/g, "") || "0",
      ),
    initText: "0",
  },
  {
    id: "total-today-topics",
    type: "async",
    getInitialValue: async () => {
      try {
        const res = await fetch("/search?search_id=activetopics");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const html = await res.text();
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = html;
        return tempDiv.querySelectorAll(".topictitle").length;
      } catch (err) {
        console.error("Erreur fetch topics actifs:", err);
        return 0;
      }
    },
    initText: "0 aujourd'hui",
    options: { suffix: " aujourd'hui" },
  },
  {
    id: "total-users-online",
    type: "static",
    getInitialValue: (el) => {
      const match = el.textContent.match(/\d+/);
      return match ? parseInt(match[0], 10) : 0;
    },
    initText: "0 en ligne",
    options: { suffix: " en ligne" },
  },
];

// ==================== CLASSE UNIFORME POUR TOUTES LES ICÔNES ====================
// ← MODIFIE ICI UNE SEULE FOIS (taille, couleur, stroke, etc.)
const COMMON_ICON_CLASSES = "lucide w-3 h-3";

// Fonction qui wrappe TOUS les icônes avec la même classe
const createIcon = (innerContent) => `
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="${COMMON_ICON_CLASSES}">
    ${innerContent}
  </svg>
`;

// ==================== MAPPING COMPLET DES TYPES D'ACTIVITÉS (0 à 9) ====================
const ACTIVITY_TYPES = {
  0: {
    innerIcon: `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/>`,
    action: "S'est inscrit(e) sur le forum",
    bg: "from-emerald-400 to-teal-600",
  },
  1: {
    innerIcon: `<path d="M11.35 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v5.35" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5" />
      <path d="M14 19h6" />
      <path d="M17 16v6" />`,
    action: "A publié un nouveau sujet",
    bg: "from-blue-400 to-indigo-600",
  },
  2: {
    innerIcon: `<path d="M20 18v-2a4 4 0 0 0-4-4H4" />
      <path d="m9 17-5-5 5-5" />`,
    action: "A répondu au sujet",
    bg: "from-violet-400 to-purple-600",
  },
  3: {
    innerIcon: `<path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"></path>`,
    action: "A obtenu une récompense",
    bg: "from-amber-400 to-orange-600",
  },
  4: {
    innerIcon: `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><line x1="16" x2="8" y1="13" y2="13"></line><line x1="16" x2="8" y1="17" y2="17"></line><line x1="10" x2="8" y1="9" y2="9"></line>`,
    action: "A publié une publication",
    bg: "from-rose-400 to-pink-600",
  },
  5: {
    innerIcon: `<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>`,
    action: "A généré sa feuille de personnage",
    bg: "from-cyan-400 to-sky-600",
  },
  6: {
    innerIcon: `<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path>`,
    action: "A publié une petite annonce",
    bg: "from-fuchsia-400 to-purple-600",
  },
  7: {
    innerIcon: `<path d="M8 2v4"></path><path d="M16 2v4"></path><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><path d="M3 10h18"></path>`,
    action: "A publié un évènement",
    bg: "from-lime-400 to-green-600",
  },
  8: {
    innerIcon: `<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>`,
    action: "A modifié son pseudo",
    bg: "from-slate-400 to-zinc-600",
  },
  9: {
    innerIcon: `<path d="M3 3v18h18"></path><path d="M18 17V9"></path><path d="M13 17V5"></path><path d="M8 17v-4"></path>`,
    action: "A publié un sondage",
    bg: "from-orange-400 to-amber-600",
  },
};

/**
 * Charge le flux d'activité de /discover et le transforme en design moderne Tailwind
 * → Icônes uniformes via COMMON_ICON_CLASSES (1 seule modification)
 */
async function initRecentActivity(container) {
  const activityContainer = container.querySelector("#recent-activities");
  if (!activityContainer) return;

  activityContainer.innerHTML = `
    <div class="flex justify-center py-12">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>
  `;

  try {
    const res = await fetch("/discover");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");

    let htmlToInsert = "";

    doc.querySelectorAll(".activity-date-group").forEach((group) => {
      const dateTitle =
        group.querySelector("h2.table-title")?.textContent.trim() ||
        "Activités récentes";

      htmlToInsert += `
        <div class="mb-8 relative">
          <div class="flex items-center gap-3 mb-6">
            <div class="h-px flex-1 bg-linear-to-r from-zinc-200 dark:from-zinc-800"></div>
            <span class="text-sm font-semibold text-zinc-500 tracking-widest uppercase">${dateTitle}</span>
            <div class="h-px flex-1 bg-linear-to-l from-zinc-200 dark:from-zinc-800"></div>
          </div>
      `;

      group.querySelectorAll(".feed-item").forEach((item) => {
        const typeMatch = item.className.match(/activity-type-(\d+)/);
        const type = typeMatch ? parseInt(typeMatch[1]) : 2;
        const config = ACTIVITY_TYPES[type] || ACTIVITY_TYPES[2];

        const time =
          item.querySelector("time")?.textContent.trim() || "Maintenant";

        const textDiv = item.querySelector(".text");
        const userA = textDiv?.querySelector('a[href^="/u"]');
        const username = userA ? userA.textContent.trim() : "Utilisateur";
        const userHref = userA ? userA.getAttribute("href") : "#";

        const topicA = textDiv?.querySelector('a[href^="/t"], a[href^="/r"]');
        const topicTitle = topicA ? topicA.textContent.trim() : "";
        const topicHref = topicA ? topicA.getAttribute("href") : "#";

        const avatarStyle = item.getAttribute("style") || "";
        const avatarMatch = avatarStyle.match(/url\(['"]?([^'")]+)['"]?\)/);
        const avatarUrl = avatarMatch
          ? avatarMatch[1]
          : "https://via.placeholder.com/48";

        const hasTopic = !!topicA;

        // Icône avec classe uniforme (une seule ligne à changer en haut du fichier)
        const iconHTML = createIcon(config.innerIcon);

        htmlToInsert += `
          <div class="relative flex gap-6 mb-4">
            <div class="shrink-0 relative self-start">
              <img src="${avatarUrl}" class="w-10 h-10 rounded-full border-2 border-white dark:border-black shadow-sm" alt="${username}">
              <div class="absolute -right-1 -bottom-1 w-5 h-5 bg-linear-to-br ${config.bg} rounded-full flex items-center justify-center text-white">
                ${iconHTML}
              </div>
            </div>


            <div class="flex-1 flex-col">
              <div class="flex justify-between items-center gap-4 mb-0.5">
                <a href="${userHref}" class="font-semibold hover:underline">${username}</a>
                <span class="text-xs text-zinc-600 dark:text-zinc-400 inline-flex gap-2 items-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-clock-icon lucide-clock w-3 h-3"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                ${time}</span>
              </div>
              <p class="text-zinc-700 dark:text-zinc-300 text-sm">
                ${config.action}${hasTopic ? ` <a href="${topicHref}" class="font-semibold hover:text-indigo-600">"${topicTitle}"</a>` : ""}
              </p>
            </div>
          </div>
        `;
      });

      htmlToInsert += `</div>`;
    });

    activityContainer.innerHTML = htmlToInsert;
  } catch (err) {
    console.error("Erreur chargement /discover :", err);
    activityContainer.innerHTML = `<div class="text-center py-12 text-slate-500">Impossible de charger les activités récentes.</div>`;
  }
}

/**
 * Initialisation complète
 */
export const initIndex = (container = document, supabase) => {
  const targets = new Map();

  // PHASE 1 : Reset immédiat
  COUNTER_CONFIGS.forEach((config) => {
    const element = container.querySelector(`#${config.id}`);
    if (!element) return;

    if (
      config.type === "static" &&
      typeof config.getInitialValue === "function"
    ) {
      targets.set(config.id, config.getInitialValue(element));
    }

    element.textContent = config.initText;
  });

  // PHASE 2 : Animations
  COUNTER_CONFIGS.forEach((config, index) => {
    const element = container.querySelector(`#${config.id}`);
    if (!element) return;

    setTimeout(() => {
      if (config.type === "supabase") {
        config
          .query(supabase)
          .then(({ count = 0 }) =>
            animateCounter(element, count, config.options),
          )
          .catch(() => animateCounter(element, 0, config.options));
      } else if (config.type === "async") {
        config
          .getInitialValue()
          .then((count) => animateCounter(element, count, config.options));
      } else {
        const target = targets.get(config.id) || 0;
        animateCounter(element, target, config.options);
      }
    }, index * 0);
  });

  // PHASE 3 : Flux d'activité moderne (tous types 0-9)
  setTimeout(() => initRecentActivity(container), 300);
};
