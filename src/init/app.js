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
import { updateTyme } from "../lib/tyme.js";
import { initViewtopic } from "../features/viewtopic.js";
import { BBcodeEditor } from "../features/editor.js";
import { initPostingBody } from "../features/postingbody.js";
import { initIndex } from "../features/index.js";

import { createClient } from "@supabase/supabase-js";
import { initViewforum } from "../features/viewforum.js";

registerModule({
  mount(container) {
    BBcodeEditor.attach(container);
    return () => BBcodeEditor.detach();
  },
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
  initMobileSidebar();
  initLayout();
  initResize();
  initChat(supabase);
  updateTyme();

  return { Context };
}
