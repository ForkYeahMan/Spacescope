// Promise-based confirmation on the native <dialog>: focus is trapped, Escape
// cancels, the backdrop comes for free. Destructive dialogs can preview what
// they're about to touch.

import { html, setHtml } from "../lib/dom.js";

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {*} opts.body            html fragment
 * @param {{name:string,detail:string}[]} [opts.items]  preview rows (first 5 shown)
 * @param {string} [opts.confirmLabel]
 * @param {boolean} [opts.danger]
 * @returns {Promise<boolean>} true if the user confirmed
 */
export function confirm({ title, body, items = [], confirmLabel = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "dialog";
    const shown = items.slice(0, 5);
    setHtml(dialog, html`
      <form method="dialog">
        <h2>${title}</h2>
        ${body}
        ${shown.length ? html`<ul class="preview">
          ${shown.map((i) => html`<li><span>${i.name}</span><span class="muted nums">${i.detail}</span></li>`)}
          ${items.length > shown.length ? html`<li class="muted">and ${items.length - shown.length} more</li>` : ""}
        </ul>` : ""}
        <div class="dialog-actions">
          <button type="submit" value="cancel" class="btn">Cancel</button>
          <button type="submit" value="ok" class="btn ${danger ? "btn-danger" : "btn-solid"}" autofocus>${confirmLabel}</button>
        </div>
      </form>`);
    dialog.addEventListener("close", () => {
      resolve(dialog.returnValue === "ok");
      dialog.remove();
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}
