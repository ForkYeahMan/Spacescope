// Light / dark / system theme. The inline script in index.html applies the
// saved choice before first paint; this module owns changing it afterwards.

import { load, save } from "./storage.js";

const ORDER = ["system", "light", "dark"];
let current = load("theme", "system");

function apply() {
  if (current === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = current;
}

export const getTheme = () => current;

export function setTheme(name) {
  if (!ORDER.includes(name)) return current;
  current = name;
  save("theme", current);
  apply();
  return current;
}

apply();
