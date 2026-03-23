import potion from "@poumon/potion";
import {
  stripBracketTags,
  createTagBadge,
  resolvePreset,
} from "../features/viewtopic.js";

/**
 * Extrait les [tags] des titres de sujets dans la liste du forum
 * et les affiche en badges à côté du titre.
 */
const extractTagsFromTopics = (root = document) => {
  root
    .querySelectorAll(
      ".topictitle, [data-barba-namespace='viewforum'] a.truncate",
    )
    .forEach((link) => {
      const text = (link.textContent || "").trim();
      if (!text) return;

      const { cleaned, tags } = stripBracketTags(text);
      if (!tags.length) return;

      link.textContent = cleaned;

      // Trouver le .tags-container le plus proche (sibling, parent, ou ancêtre)
      const row = link.closest(".topic");
      const container = row?.querySelector(".tags-container");
      if (!container) return;

      // Nettoyer les badges existants
      container
        .querySelectorAll("[data-tag-badge]")
        .forEach((el) => el.remove());

      // Trier : checkbox tags (résolu) en premier
      const sorted = [...tags].sort((a, b) => {
        const aCheck = resolvePreset(a).preset?.checkbox ? 0 : 1;
        const bCheck = resolvePreset(b).preset?.checkbox ? 0 : 1;
        return aCheck - bCheck;
      });

      sorted.forEach((key) => {
        container.appendChild(createTagBadge(key));
      });
    });
};

export const initViewforum = (root = document) => {
  const forumName = root.dataset?.name;
  const forumID = root.dataset?.id?.replace(/[^\d]/g, "");

  if (!forumID) {
    console.warn("initViewforum : aucun forumID trouvé dans data-id");
    return;
  }

  // Extraire les tags des titres
  extractTagsFromTopics(root);

  const data = extractGalleryCategory(forumName);

  const enrichedData = {
    ...data,
    forumName,
    forumID,
  };

  console.log(
    "✅ Données Galerie extraites et envoyées à Potion →",
    enrichedData,
  );

  // potion.sync("gallery", enrichedData);
};

const extractGalleryCategory = () => {};
