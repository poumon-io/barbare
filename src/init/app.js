import Context from "./context.js";
import { initBarba, onNamespace, getRegisteredNamespaces } from "./barba.js";
import { initSidebar, initMobileSidebar } from "../core/sidebar.js";
import { initLayout, initResize } from "../core/layout.js";
import { initChat } from "../core/chat.js";
import { updateTyme } from "../lib/tyme.js";
import { addIconToCategory, markInternalLinks } from "../features/viewtopic.js";

import { createClient } from "@supabase/supabase-js";

export function initUI() {
  const supabase = createClient(
    "https://meberpgnborqmkmynhdo.supabase.co",
    "sb_publishable_1Drjup1umH3pIkZ52aEl0Q_PZLACoVU",
  );

  document
    .querySelectorAll('div[style^="height:"')
    .forEach((el) => el.remove());
  document
    .querySelectorAll('[style="overflow:visible"]')
    .forEach((el) => el.remove());

  Context.container =
    document.querySelector('section[data-barba="container"]') || document;

  onNamespace("index", { afterEnter: async () => console.log("index") });

  onNamespace("viewtopic", {
    enter: async () => {
      addIconToCategory();
      markInternalLinks();
    },
  });

  onNamespace("postingbody", {
    once: () => {
      console.log("test");
    },
  });

  initBarba();
  initSidebar();
  initMobileSidebar();
  initLayout();
  initResize();
  initChat(supabase);
  updateTyme();
  addIconToCategory();
  markInternalLinks();

  return { Context };
}
