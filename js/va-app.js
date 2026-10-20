(function () {
  "use strict";

  // ===== 画面の切り替え(1ページの中で #home / #vital / #estimate / #ecg / #terms) =====
  // 記録を開くときは #vital/<記録ID>、#ecg/<記録ID>。
  const VIEWS = ["home", "vital", "estimate", "ecg", "terms"];
  let current = null;

  function route() {
    const [name, id] = location.hash.replace(/^#/, "").split("/");
    const view = VIEWS.includes(name) ? name : "home";
    VIEWS.forEach((v) => {
      document.getElementById("view-" + v).hidden = v !== view;
    });
    if (view === "vital") window.VAVitalView.show(id || null);
    if (view === "estimate") window.VAVitalView.showEstimate();
    if (view === "ecg") window.VAEcgView.show(id || null);
    if (view === "home") window.VAHome.render();
    if (view !== current) window.scrollTo(0, 0);
    current = view;
  }

  window.addEventListener("hashchange", route);
  route();
})();
