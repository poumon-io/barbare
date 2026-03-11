// features/postingbody.js
import { initPrism } from "../features/prism.js";
//

const RESOLU_TEST_RE =
  /(^|[\s\-–—:;,.|])[\[\(]?\s*r[eéèêë]solu\s*[\]\)]?(?=$|[\s\-–—:;,.|])/i;

const RESOLU_STRIP_RE =
  /(^|[\s\-–—:;,.|])[\[\(]?\s*r[eéèêë]solu\s*[\]\)]?(?=$|[\s\-–—:;,.|])/gi;

const RESOLU_CANON = "(Résolu)";

/** Nettoie espaces multiples + ponctuation résiduelle */
function normalizeSubject(text = "") {
  return text
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-–—:;,.|]+/g, "")
    .replace(/[\s\-–—:;,.|]+$/g, "")
    .trim();
}

/** Retire le token "(Résolu)" et indique s’il était présent */
function stripResolvedToken(raw) {
  const hadResolved = RESOLU_TEST_RE.test(raw || "");
  if (!hadResolved) {
    return { cleaned: raw || "", hadResolved: false };
  }

  const cleaned = normalizeSubject((raw || "").replace(RESOLU_STRIP_RE, "$1"));
  return { cleaned, hadResolved: true };
}

/** Prépare le sujet pour le submit */
function subjectForSubmit(raw, isResolvedChecked) {
  const { cleaned } = stripResolvedToken(raw);
  return isResolvedChecked
    ? cleaned
      ? `${RESOLU_CANON} ${cleaned}`
      : RESOLU_CANON
    : cleaned;
}

function normalizeText(s = "") {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function findTitleInput(root = document) {
  return root.querySelector('input[name="subject"]');
}

/** Cherche la checkbox "Résolu" (stratégies par ordre de priorité) */
function findResolvedCheckbox(root = document) {
  // 1. Attribut explicite (le plus fiable)
  const explicit = root.querySelector(
    'input[type="checkbox"][data-subject-value]',
  );
  if (explicit) return explicit;

  // 2. id ou name contient "resol"
  const byAttr = Array.from(
    root.querySelectorAll('input[type="checkbox"]'),
  ).find((el) => (el.id + el.name).toLowerCase().includes("resol"));
  if (byAttr) return byAttr;

  // 3. Label contenant "résolu"
  const label = Array.from(root.querySelectorAll("label")).find((l) =>
    normalizeText(l.textContent).includes("resolu"),
  );

  if (!label) return null;

  const forId = label.getAttribute("for");
  if (forId) {
    const byFor =
      root.querySelector(`#${CSS.escape(forId)}`) ||
      document.querySelector(`#${CSS.escape(forId)}`);
    if (byFor?.type === "checkbox") return byFor;
  }

  return label.querySelector('input[type="checkbox"]') || null;
}

/* ====================== LOGIQUE ACTUELLE EXTRAITE ====================== */

/**
 * Gère toute la synchronisation du token "(Résolu)".
 * Extraite dans une variable pour que initPostingBody reste extensible.
 */
const initResolvedSync = (container = document) => {
  const root =
    container && typeof container.querySelector === "function"
      ? container
      : document;

  const titleInput = findTitleInput(root);
  if (!titleInput) return;

  const checkbox = findResolvedCheckbox(root);

  // Fallback serveur (stable même après restauration navigateur)
  const fallback = stripResolvedToken(checkbox?.dataset?.subjectValue || "");
  const fallbackCleaned = fallback.cleaned;
  const fallbackHadResolved = fallback.hadResolved;

  let userHasTouchedCheckbox = false;

  // Bind checkbox (une seule fois)
  if (checkbox && !checkbox.dataset.resoluBound) {
    checkbox.dataset.resoluBound = "1";
    checkbox.addEventListener("change", () => {
      userHasTouchedCheckbox = true;
    });
  }

  /** Synchronise titre → checkbox + nettoyage automatique */
  const syncCheckboxFromTitle = () => {
    const raw = titleInput.value || "";
    const { cleaned } = stripResolvedToken(raw);

    if (cleaned !== raw) titleInput.value = cleaned;

    if (!checkbox || userHasTouchedCheckbox) return;

    const shouldCheck =
      RESOLU_TEST_RE.test(raw) ||
      (fallbackHadResolved && cleaned === fallbackCleaned);

    checkbox.checked = shouldCheck;
  };

  // Protection contre les remounts / double binding
  if (titleInput.dataset.resoluSyncBound) {
    syncCheckboxFromTitle();
    return;
  }
  titleInput.dataset.resoluSyncBound = "1";

  // Init + listeners
  syncCheckboxFromTitle();

  titleInput.addEventListener("paste", () =>
    setTimeout(syncCheckboxFromTitle, 0),
  );
  titleInput.addEventListener("input", syncCheckboxFromTitle); // plus réactif que "change"
  titleInput.addEventListener("blur", syncCheckboxFromTitle);

  // Sécurité avant submit
  if (titleInput.form && !titleInput.form.dataset.resoluSubmitBound) {
    titleInput.form.dataset.resoluSubmitBound = "1";
    titleInput.form.addEventListener(
      "submit",
      () => {
        const checked = !!checkbox?.checked;
        titleInput.value = subjectForSubmit(titleInput.value, checked);
      },
      true,
    );
  }
};

/* ====================== POINT D'ENTRÉE PRINCIPAL ====================== */

export const initPostingBody = (container = document) => {
  // === Fonctionnalité actuelle ===
  initPrism(container);
  initResolvedSync(container);
};
