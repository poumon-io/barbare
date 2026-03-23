import Context from "./context.js";
import {
  initBarba,
  registerModule,
  onNamespace,
  getRegisteredNamespaces,
} from "./barba.js";
import { initSidebar, initMobileSidebar } from "../core/sidebar.js";
import { initLayout, initResize } from "../core/layout.js";
import { initChat } from "../core/chat.js";
import { initSearch } from "../core/search.js";
import { initFooter } from "../core/footer.js";
import { initWombat } from "../core/wombat.js";
import { updateTyme } from "../lib/tyme.js";
import { initViewtopic } from "../features/viewtopic.js";
import { BBcodeEditor } from "../features/editor.js";
import { TagEditor } from "../features/tag-editor.js";
import { initPostingBody } from "../features/postingbody.js";
import { initIndex } from "../features/index.js";

import { createClient } from "@supabase/supabase-js";
import { initViewforum } from "../features/viewforum.js";

// ── BBCode Editor ──
registerModule({
  mount(container) {
    BBcodeEditor.attach(container);
    return () => BBcodeEditor.detach();
  },
});

// ── Tag Editor (résolu + tags libres) ──
registerModule({
  mount(container) {
    TagEditor.attach(container);
    return () => TagEditor.detach();
  },
});

// ── Footer ──
registerModule({
  mount(container) {
    initFooter(container);
  },
});

// Callback optionnel : réagir aux changements de tags
TagEditor.onChange((newSubject, tags) => {
  console.debug("[Tags] nouveau sujet :", newSubject, tags);
  // → ici, appeler ton API de mise à jour du titre si nécessaire
  // ex: updateTopicTitle(newSubject);
});

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

  onNamespace("profile", {
    once() {
      //
      window.location.pathname = "/";
    },
    enter: async ({ next }) => {
      window.location.pathname = "/";
    },
  });

  onNamespace("viewtopic", {
    once() {
      initViewtopic();
    },
    enter: async ({ next }) => {
      initViewtopic(next.container);
    },
  });

  onNamespace("postingbody", {
    once() {
      initPostingBody();
    },
    enter() {
      initPostingBody();
    },
  });

  onNamespace("viewforum", {
    once({ next }) {
      initViewforum(next.container, supabase);
    },
    enter({ next }) {
      initViewforum(next.container, supabase);
    },
  });

  onNamespace("index", {
    once({ next }) {
      initIndex(next.container, supabase);
    },
    enter({ next }) {
      initIndex(next.container, supabase);
    },
  });

  initBarba();
  initSidebar();
  initSearch();
  initMobileSidebar();
  initLayout();
  initResize();
  initChat(supabase);
  initWombat(supabase);
  updateTyme();

  return { Context };
}
