const rtfAuto = new Intl.RelativeTimeFormat("fr-CA", { numeric: "auto" });
const rtfAlways = new Intl.RelativeTimeFormat("fr-CA", { numeric: "always" });
const MS_DAY = 24 * 60 * 60 * 1000;

function stripAccents(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normWord(s) {
  return stripAccents(s).toLowerCase().replace(/[.,]/g, "").trim();
}

function capFirst(s) {
  s = String(s ?? "");
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function todayNoon() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 12, 0, 0, 0);
}

// Date-only: jamais heures + jamais "hier/avant-hier" (numeric: "always")
function fromNowDateOnly(targetDate) {
  const a = todayNoon();
  const b = new Date(
    targetDate.getFullYear(),
    targetDate.getMonth(),
    targetDate.getDate(),
    12,
    0,
    0,
    0,
  );

  const diffDays = Math.round((b.getTime() - a.getTime()) / MS_DAY);
  const abs = Math.abs(diffDays);

  if (diffDays === 0) return "Aujourd’hui"; // évite "il y a 0 jour"

  if (abs < 14) return rtfAlways.format(diffDays, "day");
  if (abs < 60) return rtfAlways.format(Math.round(diffDays / 7), "week");
  if (abs < 365) return rtfAlways.format(Math.round(diffDays / 30), "month");
  return rtfAlways.format(Math.round(diffDays / 365), "year");
}

const MONTHS = {
  // FR
  janv: 0,
  janvier: 0,
  jan: 0,
  fev: 1,
  fevr: 1,
  fevrier: 1,
  fevrier_: 1, // au cas où
  mars: 2,
  mar: 2,
  avr: 3,
  avril: 3,
  apr: 3,
  april: 3,
  mai: 4,
  may: 4,
  juin: 5,
  jun: 5,
  june: 5,
  juil: 6,
  juillet: 6,
  jul: 6,
  july: 6,
  aout: 7,
  ao: 7,
  aug: 7,
  august: 7,
  sept: 8,
  septembre: 8,
  sep: 8,
  september: 8,
  oct: 9,
  octobre: 9,
  october: 9,
  nov: 10,
  novembre: 10,
  november: 10,
  dec: 11,
  decembre: 11,
  december: 11,
};

function parseYear(y) {
  const n = Number(y);
  if (!Number.isFinite(n)) return null;
  if (String(y).length === 2) return n < 70 ? 2000 + n : 1900 + n;
  return n;
}

function parseTime(h, m, s, ampm) {
  let hh = Number(h),
    mm = Number(m),
    ss = Number(s ?? 0);
  if (![hh, mm, ss].every(Number.isFinite)) return null;

  if (ampm) {
    const ap = String(ampm).toLowerCase();
    if (ap === "pm" && hh < 12) hh += 12;
    if (ap === "am" && hh === 12) hh = 0;
  }
  return { hh, mm, ss };
}

// Déduit l'ordre jour/mois pour les dates numériques ambiguës
function preferMDYFromSelect() {
  if (typeof document === "undefined") return false;
  const sel = document.querySelector('select[name="dateformat"]');
  const fmt = sel?.value ?? "";
  // exemple: "n/j/Y, H:i"
  return /^n\/j\//i.test(fmt);
}

function fromNowDateTime(targetDate) {
  const diffMs = targetDate.getTime() - Date.now();
  const abs = Math.abs(diffMs);

  const sec = 1000;
  const min = 60 * sec;
  const hour = 60 * min;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day; // approx
  const year = 365 * day; // approx

  let value, unit;

  if (abs < 45 * sec) {
    value = Math.round(diffMs / sec);
    unit = "second";
    return rtfAuto.format(value, unit);
  }
  if (abs < 45 * min) {
    value = Math.round(diffMs / min);
    unit = "minute";
    return rtfAuto.format(value, unit);
  }
  if (abs < 22 * hour) {
    value = Math.round(diffMs / hour);
    unit = "hour";
    return rtfAuto.format(value, unit);
  }

  // À partir de "day", on force numeric ALWAYS (évite "hier/avant-hier")
  if (abs < 6 * day) {
    value = Math.round(diffMs / day);
    unit = "day";
  } else if (abs < 3.5 * week) {
    value = Math.round(diffMs / week);
    unit = "week";
  } else if (abs < 11 * month) {
    value = Math.round(diffMs / month);
    unit = "month";
  } else {
    value = Math.round(diffMs / year);
    unit = "year";
  }

  return rtfAlways.format(value, unit);
}

function parseForumDate(raw, { preferMDY = false } = {}) {
  const text = String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!text) return null;

  // Aujourd'hui / Hier / Avant-hier (avec ou sans heure)
  // - Aujourd'hui: si heure présente => granularity "time" (heures/minutes)
  // - Hier / Avant-hier: même si heure présente => granularity "date" (il y a X jours)
  {
    const m = text.match(
      /^(Aujourd['’]hui|Hier|Avant[-\s]?hier)(?:\s+à\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/i,
    );
    if (m) {
      const label = normWord(m[1]);
      const hasTime = !!m[2];

      if (label.startsWith("aujourd")) {
        if (hasTime) {
          const t = parseTime(m[2], m[3], m[4], null);
          if (!t) return null;
          const now = new Date();
          return {
            date: new Date(
              now.getFullYear(),
              now.getMonth(),
              now.getDate(),
              t.hh,
              t.mm,
              t.ss,
              0,
            ),
            granularity: "time",
          };
        }
        // "Aujourd'hui" sans heure
        return { date: todayNoon(), granularity: "date" };
      }

      // Hier / Avant-hier (ignore l'heure si présente)
      const base = todayNoon();
      const offset = label.startsWith("avant") ? 2 : 1;
      base.setDate(base.getDate() - offset);
      return { date: base, granularity: "date" };
    }
  }

  // 26-02-2026 (date seule) ou 26-02-2026 19:27(:50)
  {
    const m = text.match(
      /^(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
    );
    if (m) {
      const dd = +m[1],
        mm = +m[2],
        yyyy = +m[3];
      if (m[4]) {
        const t = parseTime(m[4], m[5], m[6], null);
        if (!t) return null;
        return {
          date: new Date(yyyy, mm - 1, dd, t.hh, t.mm, t.ss, 0),
          granularity: "time",
        };
      }
      return {
        date: new Date(yyyy, mm - 1, dd, 12, 0, 0, 0),
        granularity: "date",
      };
    }
  }

  // 2026-02-28, 19:27(:50) ou 2026-02-28
  {
    const m = text.match(
      /^(\d{4})-(\d{2})-(\d{2})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
    );
    if (m) {
      const yyyy = +m[1],
        mm = +m[2],
        dd = +m[3];
      if (m[4]) {
        const t = parseTime(m[4], m[5], m[6], null);
        if (!t) return null;
        return {
          date: new Date(yyyy, mm - 1, dd, t.hh, t.mm, t.ss, 0),
          granularity: "time",
        };
      }
      return {
        date: new Date(yyyy, mm - 1, dd, 12, 0, 0, 0),
        granularity: "date",
      };
    }
  }

  // 28.02.26 19:27(:50)
  {
    const m = text.match(
      /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/,
    );
    if (m) {
      const dd = +m[1],
        mm = +m[2],
        yyyy = parseYear(m[3]);
      const t = parseTime(m[4], m[5], m[6], null);
      if (yyyy == null || !t) return null;
      return {
        date: new Date(yyyy, mm - 1, dd, t.hh, t.mm, t.ss, 0),
        granularity: "time",
      };
    }
  }

  // 28/02/26, 07:27 pm  |  28/2/2026, 19:27  |  2/28/2026, 19:27
  {
    const m = text.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i,
    );
    if (m) {
      const a = +m[1],
        b = +m[2],
        yyyy = parseYear(m[3]);
      const t = parseTime(m[4], m[5], m[6], m[7]);
      if (yyyy == null || !t) return null;

      // Heuristique + préférence (via select dateformat)
      let day, month;
      if (a > 12 && b <= 12) {
        day = a;
        month = b;
      } else if (b > 12 && a <= 12) {
        day = b;
        month = a;
      } else if (preferMDY) {
        month = a;
        day = b;
      } else {
        day = a;
        month = b;
      }

      return {
        date: new Date(yyyy, month - 1, day, t.hh, t.mm, t.ss, 0),
        granularity: "time",
      };
    }
  }

  // Formats texte: "Sam 28 Fév 2026 - 19:27" / "Sam 28 Fév - 19:27" / "Février 28th 2026, 7:27 pm" etc.
  {
    const cleaned = text.replace(/(\d+)(st|nd|rd|th)\b/gi, "$1"); // 28th -> 28
    const nowYear = new Date().getFullYear();

    // day-first: [DOW] 28 Fév (2026)? [,-] 19:27(:50) (am/pm)?
    let m = cleaned.match(
      /^(?:[A-Za-zÀ-ÿ]{2,}\s+)?(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s*(\d{2,4})?(?:\s*[,-]\s*|\s*-\s*|\s*,\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i,
    );
    if (m) {
      const dd = +m[1];
      const mon = MONTHS[normWord(m[2])] ?? null;
      const yyyy = m[3] ? parseYear(m[3]) : nowYear;
      const t = parseTime(m[4], m[5], m[6], m[7]);
      if (mon == null || yyyy == null || !t) return null;
      return {
        date: new Date(yyyy, mon, dd, t.hh, t.mm, t.ss, 0),
        granularity: "time",
      };
    }

    // month-first: [DOW] Fév 28, 2026 7:27 pm  |  Février 28 2026, 19:27
    m = cleaned.match(
      /^(?:[A-Za-zÀ-ÿ]{2,}\s+)?([A-Za-zÀ-ÿ]+)\s+(\d{1,2})(?:,)?\s*(\d{2,4})\s*(?:,?\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i,
    );
    if (m) {
      const mon = MONTHS[normWord(m[1])] ?? null;
      const dd = +m[2];
      const yyyy = parseYear(m[3]);
      const t = parseTime(m[4], m[5], m[6], m[7]);
      if (mon == null || yyyy == null || !t) return null;
      return {
        date: new Date(yyyy, mon, dd, t.hh, t.mm, t.ss, 0),
        granularity: "time",
      };
    }
  }

  return null;
}

export const updateTyme = function (root = document, selector = ".tyme") {
  const preferMDY = preferMDYFromSelect();

  root.querySelectorAll(selector).forEach((el) => {
    const src =
      el.getAttribute("datetime") || el.dataset.date || el.textContent;
    if (!el.dataset.tymeOriginal)
      el.dataset.tymeOriginal = String(src ?? "").trim();

    const parsed = parseForumDate(el.dataset.tymeOriginal, { preferMDY });
    if (!parsed) return;

    el.textContent = capFirst(
      parsed.granularity === "date"
        ? fromNowDateOnly(parsed.date)
        : fromNowDateTime(parsed.date),
    );
    el.title = el.dataset.tymeOriginal;
  });
};
