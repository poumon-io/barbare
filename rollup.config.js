import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import css from "rollup-plugin-css-only";
import postcss from "rollup-plugin-postcss";

// import { terser } from "rollup-plugin-terser";

export default {
  input: "src/index.js",

  output: {
    file: "dist/barbare.js", // UN SEUL output = plus stable en watch
    format: "iife",
    name: "Barbare",
    sourcemap: true,
  },

  plugins: [
    resolve(),
    commonjs(),
    postcss({
      extract: "bundle.css",
      sourceMap: true,
      minimize: process.env.NODE_ENV === "production",
    }),
  ],

  // ← ÇA RÉSOUT L’ERREUR "Cannot import the generated bundle"
  watch: {
    exclude: ["dist/**", "node_modules/**"],
  },
};
