// barbaGithubEditorModule.js
import { mountGithubEditor } from "../features/editor.js";

export const editorBarbaModule = {
  name: "github-editor",
  mount(container) {
    // container = data.next.container dans Barba
    return mountGithubEditor(container);
  },
};
