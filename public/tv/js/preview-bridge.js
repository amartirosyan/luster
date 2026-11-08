import { mountPlayer } from "./player.js?v=54";

window.__nlMount = function mountPreview() {
  document.querySelectorAll("[data-nl-root]").forEach((el) => {
    if (el.dataset.nlMounted === "1") return;
    el.dataset.nlMounted = "1";
    el.__nlStop = mountPlayer(el, { base: "/tv/" });
  });
};

window.__nlMount();
