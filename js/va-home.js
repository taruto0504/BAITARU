(function () {
  "use strict";

  const { esc, fmtTime } = window.VA;
  const icon = window.icon;
  const URG = { high: "高", mid: "中", low: "低", arrest: "停止", none: "－" };

  function render() {
    const vitals = window.VA.cases.list().map((r) => ({ kind: "vital", r, t: r.updatedAt }));
    const ecgs = window.VA.ecg.list().map((r) => ({ kind: "ecg", r, t: r.updatedAt }));
    const items = vitals.concat(ecgs).sort((a, b) => (a.t < b.t ? 1 : -1)).slice(0, 30);
    const box = document.getElementById("recent");
    document.getElementById("clear-all").hidden = !items.length;
    if (!items.length) {
      box.innerHTML = `<div class="va-recent-empty">${icon("clock")}<p>まだ記録はありません。評価画面で「記録」を押すと、ここに時刻つきで並びます。</p></div>`;
      return;
    }
    box.innerHTML = `<ul class="va-recent">${items
      .map(({ kind, r }) => {
        const href = kind === "vital" ? `vital.html#${r.id}` : `ecg.html#${r.id}`;
        const lv = r.urgency === "arrest" ? "high" : r.urgency;
        const count = kind === "vital" && r.entries.length > 1 ? `・${r.entries.length}回測定` : "";
        return `<li>
          <a href="${href}">
            <span class="va-recent-kind">${icon(kind === "vital" ? "heart-pulse" : "ecg")}</span>
            <span class="va-recent-body">
              <span class="va-recent-title">${esc(r.label)}</span>
              <span class="va-recent-sub">${esc(r.summary || "")}</span>
              <span class="va-recent-time">${fmtTime(r.updatedAt, true)}${count}</span>
            </span>
            <span class="va-entry-urg lv-${lv}">${URG[r.urgency] || "－"}</span>
          </a>
          <button type="button" class="log-del" data-kind="${kind}" data-id="${r.id}" aria-label="削除">${icon("trash")}</button>
        </li>`;
      })
      .join("")}</ul>`;
    box.querySelectorAll(".log-del").forEach((b) => {
      window.VA.twoTap(
        b,
        () => {
          (b.dataset.kind === "vital" ? window.VA.cases : window.VA.ecg).remove(b.dataset.id);
          render();
        },
        "削除"
      );
    });
  }

  window.VA.twoTap(
    document.getElementById("clear-all"),
    () => {
      window.VA.cases.clear();
      window.VA.ecg.clear();
      render();
    },
    "もう一度押すとすべて削除"
  );

  render();
})();
