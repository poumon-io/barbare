import potion from "@poumon/potion";

export const initViewforum = (root = document) => {
  const forumName = root.dataset?.name;
  const forumID = root.dataset?.id?.replace(/[^\d]/g, "");

  if (!forumID) {
    console.warn("initViewforum : aucun forumID trouvé dans data-id");
    return;
  }

  // Extraction propre depuis le document FETCHÉ (pas le DOM live)
  const data = extractGalleryCategory(forumName, supabase);

  const enrichedData = {
    ...data,
    forumName,
    forumID,
  };

  console.log(
    "✅ Données Galerie extraites et envoyées à Potion →",
    enrichedData,
  );

  potion.sync("gallery", enrichedData);
};

const extractGalleryCategory = () => {};
