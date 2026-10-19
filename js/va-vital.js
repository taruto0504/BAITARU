(function () {
  "use strict";

  const { esc, chip, cite, fmtTime } = window.VA;
  const E = window.VAVital;
  const icon = window.icon;
  const root = document.getElementById("view-vital");
  const $ = (id) => root.querySelector("#" + id);

  const DRAFT_KEY = "vaVitalDraft_v1";
  const NUM_FIELDS = ["hr", "spo2", "o2Flow", "rSys", "rDia", "lSys", "lDia", "rr", "temp", "age"];
  const TEXT_FIELDS = ["rrNote", "complaintText", "historyText", "tempSite", "jcs", "gcsE", "gcsV", "gcsM"];
  const SEG_FIELDS = ["hrRhythm", "o2", "sex", "ageGroup", "jcsSuffix"];
  const AGE_GROUP_LABEL = { infant: "乳児", child: "小児", adult: "成人", elderly: "高齢者" };
  const SEX_LABEL = { m: "男性", f: "女性", u: "" };

  let caseId = null;
  let revealed = false;
  let lastResult = null;
  let started = false;

  // 数値は3桁まで(体温などの小数点は桁に数えない)。4桁目は入力した時点で取り除く。
  function clampDigits(el) {
    const v = el.value;
    if (!v || v.replace(/\D/g, "").length <= 3) return;
    let out = "";
    let n = 0;
    for (const ch of v) {
      if (/\d/.test(ch)) {
        if (n >= 3) break;
        n++;
      }
      out += ch;
    }
    el.value = out.replace(/\.$/, "");
  }

  // ---- ワンタップの選択肢 ----
  root.querySelectorAll(".va-seg").forEach((seg) => {
    seg.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const on = !b.classList.contains("on");
      if (!seg.dataset.multi) seg.querySelectorAll("button").forEach((x) => x.classList.remove("on"));
      b.classList.toggle("on", on);
      if (seg.dataset.field === "ageGroup" && on) $("age").value = "";
      update();
    });
  });

  function segOf(field) {
    return root.querySelector(`.va-seg[data-field="${field}"]`);
  }

  function segValue(field) {
    const seg = segOf(field);
    const on = Array.from(seg.querySelectorAll("button.on")).map((b) => b.dataset.value);
    return seg.dataset.multi ? on.join("") : on[0] || null;
  }

  function setSeg(field, value) {
    const seg = segOf(field);
    seg.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("on", !!value && (seg.dataset.multi ? value.includes(b.dataset.value) : b.dataset.value === value));
    });
  }

  // ---- フォームの読み書き ----
  function readForm() {
    const f = {};
    NUM_FIELDS.concat(TEXT_FIELDS).forEach((k) => {
      f[k] = $(k).value.trim();
    });
    SEG_FIELDS.forEach((k) => {
      f[k] = segValue(k);
    });
    f.hypercapnic = $("hypercapnic").checked;
    f.complaints = [];
    f.history = [];
    return f;
  }

  function writeForm(f) {
    f = Object.assign({}, f || {});
    // 以前の記録(選択式の主訴・既往)は自由入力の欄に入れる
    if (!f.complaintText && f.complaints && f.complaints.length) f.complaintText = f.complaints.join("、");
    if (!f.historyText && f.history && f.history.length) f.historyText = f.history.join("、");
    NUM_FIELDS.concat(TEXT_FIELDS).forEach((k) => {
      $(k).value = f[k] == null ? "" : f[k];
    });
    SEG_FIELDS.forEach((k) => setSeg(k, f[k]));
    $("hypercapnic").checked = !!f.hypercapnic;
  }

  function hasAnyInput(f) {
    return NUM_FIELDS.some((k) => f[k]) || ["jcs", "gcsE", "gcsV", "gcsM", "complaintText"].some((k) => f[k]);
  }

  function saveDraft() {
    window.VA.writeJSON(DRAFT_KEY, { caseId, form: readForm(), revealed });
  }

  // ---- 表示 ----
  function update() {
    const f = readForm();
    $("o2-extra").hidden = f.o2 !== "o2";
    if (f.age) setSeg("ageGroup", null);
    const g = ["gcsE", "gcsV", "gcsM"].map((k) => parseInt(f[k], 10));
    $("gcs-total").textContent = g.every((x) => !isNaN(x)) ? g[0] + g[1] + g[2] : "--";
    lastResult = E.assess(f);
    renderChecks(lastResult.checks);
    renderTiles(lastResult);
    renderUrgency(lastResult);
    renderTags(lastResult.input);
    renderSummary(lastResult);
    renderEstimate(lastResult, f);
    renderTrend();
    saveDraft();
  }

  function renderTags(v) {
    const tags = (list, empty) => (list.length ? `認識：${list.map((x) => `<span>${esc(x)}</span>`).join("")}` : empty);
    $("complaint-tags").innerHTML = $("complaintText").value.trim() ? tags(v.complaints, "認識できた主訴はありません（疾患推定は主訴のキーワードを使います）") : "";
    $("history-tags").innerHTML = $("historyText").value.trim() ? tags(v.history, "") : "";
  }

  function renderChecks(checks) {
    $("checks").innerHTML = checks
      .map(
        (c, i) => `<div class="va-check-msg">${icon("alert")}<div>${esc(c.message)}${
          c.fix != null ? ` <button type="button" class="va-fix" data-i="${i}">${esc(c.fix)} に直す</button>` : ""
        }<div class="va-check-sub">確認が済むまで、この値は評価に使っていません。</div></div></div>`
      )
      .join("");
    $("checks").querySelectorAll(".va-fix").forEach((b) => {
      b.addEventListener("click", () => {
        const c = checks[Number(b.dataset.i)];
        $(c.field).value = c.fix;
        update();
      });
    });
    root.querySelectorAll(".va-num, .va-small").forEach((el) => el.classList.toggle("is-suspect", checks.some((c) => c.field === el.id)));
  }

  function renderTiles(r) {
    root.querySelectorAll("[data-status]").forEach((el) => {
      const v = r.vitals.find((x) => x.key === el.dataset.status);
      const arrow = v && v.dir ? (v.dir === "high" ? "↑" : "↓") : "";
      el.innerHTML = v && v.level ? chip(v.level, arrow) : "";
    });
  }

  function renderUrgency(r) {
    const u = r.urgency;
    $("urgency").className = `va-urgency lv-${u.level}`;
    const ic = { high: "alert", mid: "alert", low: "check", none: "info" }[u.level];
    $("urgency-label").innerHTML = `${icon(ic)}${esc(u.label)}`;
    $("urgency-sub").textContent = u.level === "none" ? "わかっている値を入力すると、すぐに評価します" : u.reasons[0] + (u.reasons.length > 1 ? ` ほか${u.reasons.length - 1}件` : "");
  }

  // 結果のうち、いつも見せるのは算出指標だけ(疾患推定とアドバイスはボタンで開く)
  function renderSummary(r) {
    if (r.urgency.level === "none") {
      $("summary").innerHTML = `<div class="va-empty">${icon("heart-pulse")}<p>わかっている値だけ入力してください。<br>入力するたびに緊急度と算出指標が更新されます。</p><button class="btn-secondary" type="button" id="load-sample">例を入れてみる</button></div>`;
      $("load-sample").addEventListener("click", loadSample);
      return;
    }
    const tiles = r.indices
      .map((i) => `<div class="va-mini lv-${i.level}"><span class="va-mini-name">${esc(i.name.replace("（収縮期）", ""))}</span><span class="va-mini-val">${esc(i.value)}<small>${esc(i.unit)}</small></span>${chip(i.level)}</div>`)
      .join("");
    const details = r.indices
      .map((i) => {
        let extra = "";
        if (i.key === "news2" && r.news2) extra = `<div class="va-breakdown">${r.news2.parts.map((p) => `${esc(p.label)} ${p.pts}`).join(" ／ ")}</div>`;
        if (i.key === "qsofa" && r.qsofa) extra = `<div class="va-breakdown">${r.qsofa.items.map((q) => `${q.known ? (q.hit ? "●" : "○") : "－"} ${esc(q.label)}`).join("<br>")}</div>`;
        return `<div class="va-index"><div class="va-index-top"><span class="va-index-name">${esc(i.name)}</span></div><div class="va-index-note">${esc(i.note)}</div>${extra}${cite(i.src)}</div>`;
      })
      .join("");
    $("summary").innerHTML = `<section class="card va-result">
      <h2>${icon("calculator")}自動で算出した指標</h2>
      ${tiles ? `<div class="va-mini-grid">${tiles}</div>` : `<p class="va-lead">HRと血圧がそろうと、ショックインデックスなどを計算します。</p>`}
      ${r.notes.length ? `<div class="va-notes">${r.notes.map((n) => `<p>${icon("info")}${esc(n)}</p>`).join("")}</div>` : ""}
      ${details ? `<details class="va-more"><summary>指標の説明と出典</summary>${details}</details>` : ""}
    </section>`;
  }

  function section(title, ic, body, id) {
    return `<section class="card va-result"${id ? ` id="${id}"` : ""}><h2>${icon(ic)}${title}</h2>${body}</section>`;
  }

  function actionText(text) {
    return esc(text).replace("（心電図評価へ）", ' <a href="#ecg">心電図評価へ</a>');
  }

  function renderEstimate(r, f) {
    const ready = r.urgency.level !== "none" || r.input.complaints.length > 0;
    const btn = $("estimate-btn");
    btn.disabled = !ready;
    btn.setAttribute("aria-expanded", String(revealed && ready));
    $("estimate-label").textContent = !ready ? "値か主訴を入力すると疾患推定できます" : revealed ? "疾患推定・アドバイスを閉じる" : "疾患推定・アドバイスを見る";
    $("results").hidden = !(revealed && ready);
    if (!revealed || !ready) {
      $("results").innerHTML = "";
      return;
    }
    const out = [];
    if (r.conditions.length) {
      const item = (c, open) => `<details class="va-cond"${open ? " open" : ""}>
        <summary><span class="va-cond-name">${esc(c.name)}</span>${c.critical ? '<span class="va-tag-critical">致死的</span>' : ""}<span class="va-fit">一致度 ${c.fit}</span></summary>
        <div class="va-cond-body">
          <div class="va-cond-h tone-success">${icon("check")}支持する所見</div><ul class="va-list">${c.support.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
          ${c.against.length ? `<div class="va-cond-h tone-warning">${icon("x")}合わない所見</div><ul class="va-list">${c.against.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
          ${c.need.length ? `<div class="va-cond-h">${icon("info")}確認したい追加情報</div><ul class="va-list">${c.need.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
          ${cite(c.src)}
        </div></details>`;
      const top = r.conditions.slice(0, 3);
      const rest = r.conditions.slice(3);
      out.push(
        section(
          "推定される病態・疾患",
          "bookmark",
          `<p class="va-lead">主訴・年齢・既往・バイタルの組み合わせから挙げた候補です。一致度は所見の重なりで、確率ではありません。</p>${top.map((c, i) => item(c, i === 0)).join("")}${
            rest.length ? `<details class="va-more"><summary>ほかの候補（${rest.length}件）</summary>${rest.map((c) => item(c, false)).join("")}</details>` : ""
          }`
        )
      );
    } else {
      out.push(section("推定される病態・疾患", "bookmark", `<p class="va-lead">${r.input.complaints.length ? "入力された情報からは、目立った候補はありません。" : "主訴を入力すると、バイタルと組み合わせて候補を挙げます（例：胸痛、呼吸困難、発熱）。"}</p>`));
    }

    if (r.mustNotMiss.length) {
      out.push(
        section(
          "見逃すと危険な疾患",
          "flag",
          `<ul class="va-mnm">${r.mustNotMiss.map((m) => `<li><b>${esc(m.name)}</b><span>${esc(m.point)}</span></li>`).join("")}</ul>`
        )
      );
    }

    if (r.actions.length || r.remeasure) {
      out.push(
        section(
          "アドバイス（次の行動）",
          "bolt",
          `<ol class="va-actions">${r.actions.map((a) => `<li><div>${actionText(a.text)}</div><small>${esc(a.why)}</small>${cite(a.src)}</li>`).join("")}</ol>${
            r.remeasure ? `<div class="va-remeasure">${icon("clock")}再測定の目安：${esc(r.remeasure)}</div>` : ""
          }<p class="va-lead">最終的な判断は、利用者と施設のプロトコルに従ってください。</p>`
        )
      );
    }

    if (r.urgency.reasons.length) {
      out.push(
        `<details class="card va-ref" id="reasons"><summary>${icon("alert")}緊急度の根拠（${r.urgency.reasons.length}件）</summary><ul class="va-list va-gap-top">${r.urgency.reasons
          .map((x) => `<li>${esc(x)}</li>`)
          .join("")}</ul>${cite(["news2", "jatec"])}</details>`
      );
    }
    $("results").innerHTML = out.join("");
  }

  // ---- 経過(記録) ----
  function summarize(f) {
    const parts = [];
    if (f.hr) parts.push(`HR ${f.hr}`);
    if (f.rSys) parts.push(`BP右 ${f.rSys}${f.rDia ? "/" + f.rDia : ""}`);
    if (f.lSys) parts.push(`BP左 ${f.lSys}${f.lDia ? "/" + f.lDia : ""}`);
    if (f.spo2) parts.push(`SpO2 ${f.spo2}%${f.o2 === "o2" ? "(O2)" : ""}`);
    if (f.rr) parts.push(`RR ${f.rr}`);
    if (f.temp) parts.push(`${f.temp}℃`);
    if (f.jcs) parts.push(`JCS ${f.jcs}${f.jcsSuffix || ""}`);
    const g = ["gcsE", "gcsV", "gcsM"].map((k) => parseInt(f[k], 10));
    if (g.every((x) => !isNaN(x))) parts.push(`GCS ${g[0] + g[1] + g[2]}`);
    return parts.join(" ・ ") || "バイタル未入力";
  }

  function caseLabel(f, v) {
    const who = [f.age ? `${f.age}歳` : AGE_GROUP_LABEL[f.ageGroup] || "", SEX_LABEL[f.sex] || ""].join("");
    const what = v.complaints.length ? v.complaints.join("・") : f.complaintText ? f.complaintText.slice(0, 16) : "主訴未入力";
    return `${what}${who ? "　" + who : ""}`;
  }

  // 記録の値: 代表の収縮期血圧は左右の高い側
  function seriesValue(f, key) {
    if (key === "sys") {
      const s = [parseFloat(f.rSys), parseFloat(f.lSys)].filter((x) => !isNaN(x));
      return s.length ? Math.max(...s) : null;
    }
    const x = parseFloat(f[key]);
    return isNaN(x) ? null : x;
  }

  function sparkline(points, color) {
    const w = 220;
    const h = 44;
    const pad = 6;
    const vals = points.map((p) => p.v);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (hi - lo < 1) {
      hi += 1;
      lo -= 1;
    }
    const t0 = points[0].t;
    const t1 = points[points.length - 1].t;
    const x = (t) => (t1 === t0 ? w / 2 : pad + ((t - t0) / (t1 - t0)) * (w - pad * 2));
    const y = (v) => h - pad - ((v - lo) / (hi - lo)) * (h - pad * 2);
    const d = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
    const last = points[points.length - 1];
    return `<svg viewBox="0 0 ${w} ${h}" class="va-spark" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" x2="${w}" y1="${h - pad}" y2="${h - pad}" class="va-spark-grid"/>
      <path d="${d}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>
      ${points.map((p) => `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="${p === last ? 3.5 : 2.2}" fill="${color}"/>`).join("")}
    </svg>`;
  }

  function renderTrend() {
    const rec = caseId ? window.VA.cases.get(caseId) : null;
    const entries = rec ? rec.entries : [];
    if (!entries.length) {
      $("trend").innerHTML = `<p class="va-lead">「この時点の値を記録」を押すと、時刻つきで保存されます。再測定を続けて記録すると、変化をグラフで見られます。</p>`;
      return;
    }
    const series = [
      ["hr", "HR", "回/分", "var(--va-hr-ink)"],
      ["sys", "収縮期血圧", "mmHg", "var(--va-bp-ink)"],
      ["spo2", "SpO2", "%", "var(--va-spo2-ink)"],
      ["rr", "RR", "回/分", "var(--va-rr-ink)"],
      ["temp", "体温", "℃", "var(--va-temp-ink)"],
    ];
    const rows = series
      .map(([k, label, unit, color]) => {
        const pts = entries
          .map((e) => ({ t: new Date(e.t).getTime(), v: seriesValue(e.form, k) }))
          .filter((p) => p.v != null)
          .sort((a, b) => a.t - b.t);
        if (!pts.length) return "";
        const last = pts[pts.length - 1].v;
        const diff = pts.length > 1 ? last - pts[0].v : null;
        const diffText = diff == null ? "" : `${diff > 0 ? "+" : ""}${Math.round(diff * 10) / 10}`;
        return `<div class="va-trend-row"><div class="va-trend-label">${label}<small>${unit}</small></div>${sparkline(pts, color)}<div class="va-trend-last">${last}<small>${diffText}</small></div></div>`;
      })
      .join("");
    const list = entries
      .slice()
      .reverse()
      .map((e) => `<li><span class="log-time">${fmtTime(e.t, true)}</span><span class="va-entry-urg lv-${e.urgency}">${esc({ high: "高", mid: "中", low: "低", none: "－" }[e.urgency] || "－")}</span><span class="va-entry-sum">${esc(summarize(e.form))}</span></li>`)
      .join("");
    $("trend").innerHTML = `<div class="va-case-label">${esc(rec.label)}</div>${rows}<ul class="va-entries">${list}</ul>`;
  }

  function record() {
    const f = readForm();
    if (!hasAnyInput(f)) {
      showMsg("記録する値がありません。わかっている値を入力してください。", true);
      return;
    }
    const now = new Date().toISOString();
    let rec = caseId ? window.VA.cases.get(caseId) : null;
    if (!rec) {
      rec = { id: window.VA.newId(), createdAt: now, entries: [] };
      caseId = rec.id;
    }
    rec.entries.push({ t: now, form: f, urgency: lastResult.urgency.level, news2: lastResult.news2 ? lastResult.news2.score : null });
    rec.updatedAt = now;
    rec.label = caseLabel(f, lastResult.input);
    rec.urgency = lastResult.urgency.level;
    rec.summary = summarize(f);
    if (!window.VA.cases.save(rec)) {
      showMsg("保存できませんでした。端末の保存領域を確認してください。", true);
      return;
    }
    history.replaceState(null, "", "#vital/" + caseId);
    saveDraft();
    renderTrend();
    showMsg(`${fmtTime(now)} の値を記録しました（${rec.entries.length}回目）`);
  }

  function showMsg(text, isError) {
    const el = $("record-msg");
    el.textContent = text;
    el.classList.toggle("is-error", !!isError);
    clearTimeout(showMsg.t);
    showMsg.t = setTimeout(() => {
      el.textContent = "";
    }, 4000);
  }

  function startNew() {
    caseId = null;
    revealed = false;
    writeForm({});
    closeImport();
    history.replaceState(null, "", "#vital");
    update();
    window.scrollTo({ top: 0 });
  }

  function loadSample() {
    writeForm({
      complaintText: "30分前から突然の胸背部痛、冷汗あり（例）",
      sex: "m",
      age: "62",
      historyText: "高血圧、喫煙",
      hr: "112",
      hrRhythm: "reg",
      rSys: "168",
      rDia: "92",
      lSys: "132",
      lDia: "80",
      spo2: "95",
      o2: "air",
      rr: "22",
      temp: "36.6",
      jcs: "1",
    });
    update();
  }

  // ---- 写真からの取り込み ----
  const IMPORT_FIELDS = [
    ["hr", "HR", "回/分"],
    ["sys", "血圧 収縮期", "mmHg"],
    ["dia", "血圧 拡張期", "mmHg"],
    ["spo2", "SpO2", "%"],
    ["rr", "RR", "回/分"],
    ["temp", "体温", "℃"],
  ];
  let importCtl = null;
  let previewUrl = null;

  function closeImport() {
    if (importCtl) importCtl.abort();
    importCtl = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    $("v-import").hidden = true;
    $("v-import").innerHTML = "";
  }

  async function onPhoto(input) {
    const file = input.files && input.files[0];
    input.value = "";
    if (!file) return;
    closeImport();
    previewUrl = URL.createObjectURL(file);
    const box = $("v-import");
    box.hidden = false;
    box.innerHTML = `<img class="va-import-img" src="${previewUrl}" alt="取り込んだ写真"><div class="va-import-status" id="v-import-status"><span class="va-spinner"></span>数値を読み取っています…<button type="button" class="va-text-btn" id="v-import-stop">中止</button></div>`;
    $("v-import-stop").addEventListener("click", closeImport);

    if (!(await window.VAReader.available())) {
      $("v-import-status").innerHTML = `${icon("info")}この環境では自動の読み取りを使えません（Claude 上で開いたときに使えます）。写真を見ながら入力してください。<button type="button" class="va-text-btn" id="v-import-close">閉じる</button>`;
      $("v-import-close").addEventListener("click", closeImport);
      return;
    }
    importCtl = new AbortController();
    try {
      const res = await window.VAReader.read("vital", file, importCtl.signal);
      importCtl = null;
      showImportResult(res || {});
    } catch (e) {
      importCtl = null;
      if (e.code === "cancelled") return;
      $("v-import-status").innerHTML = `${icon("alert")}${esc(e.message)}<button type="button" class="va-text-btn" id="v-import-close">閉じる</button>`;
      $("v-import-close").addEventListener("click", closeImport);
    }
  }

  function showImportResult(res) {
    const vals = res.values || {};
    const conf = res.confidence || {};
    const got = IMPORT_FIELDS.filter(([k]) => vals[k] != null && isFinite(Number(vals[k])));
    if (res.readable === false || !got.length) {
      $("v-import-status").innerHTML = `${icon("alert")}数値を読み取れませんでした。${esc(res.reason || "")} 画面の数値の部分を正面から撮り直してください。<button type="button" class="va-text-btn" id="v-import-close">閉じる</button>`;
      $("v-import-close").addEventListener("click", closeImport);
      return;
    }
    const rows = IMPORT_FIELDS.map(([k, label, unit]) => {
      const has = vals[k] != null && isFinite(Number(vals[k]));
      const low = has && conf[k] === "low";
      return `<label class="va-import-row${low ? " is-low" : ""}"><input type="checkbox" data-k="${k}"${has ? " checked" : ""}>
        <span class="va-import-name">${label}</span>
        <input type="number" inputmode="decimal" data-v="${k}" value="${has ? esc(vals[k]) : ""}" placeholder="—">
        <span class="va-import-unit">${unit}</span>${low ? '<span class="va-chip lv-cau">要確認</span>' : ""}</label>`;
    }).join("");
    $("v-import-status").outerHTML = `<div class="va-import-confirm">
      <div class="va-import-head">${icon("check")}読み取った値を確認してください</div>
      ${rows}
      <div class="va-import-side"><span>血圧は</span><div class="va-seg va-seg-light" id="v-import-side"><button type="button" data-value="r" class="on">右</button><button type="button" data-value="l">左</button></div><span>に入れる</span></div>
      ${res.notes ? `<p class="hint">${icon("info")}${esc(res.notes)}</p>` : ""}
      <p class="hint">「要確認」は読み間違いの可能性がある値です。写真と見比べてください。</p>
      <div class="log-actions"><button type="button" class="btn-secondary" id="v-import-cancel">やめる</button><button type="button" class="btn-primary" id="v-import-apply">入力欄に反映</button></div>
    </div>`;
    const box = $("v-import");
    box.querySelectorAll('input[type="number"]').forEach((inp) => {
      clampDigits(inp);
      inp.addEventListener("input", () => {
        clampDigits(inp);
        box.querySelector(`input[data-k="${inp.dataset.v}"]`).checked = inp.value.trim() !== "";
      });
    });
    $("v-import-side").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      $("v-import-side").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    });
    $("v-import-cancel").addEventListener("click", closeImport);
    $("v-import-apply").addEventListener("click", () => {
      const side = $("v-import-side").querySelector(".on").dataset.value;
      const target = { hr: "hr", sys: side + "Sys", dia: side + "Dia", spo2: "spo2", rr: "rr", temp: "temp" };
      let n = 0;
      box.querySelectorAll("input[data-k]").forEach((cb) => {
        const val = box.querySelector(`input[data-v="${cb.dataset.k}"]`).value.trim();
        if (cb.checked && val) {
          $(target[cb.dataset.k]).value = val;
          n++;
        }
      });
      closeImport();
      update();
      showMsg(n ? `写真から${n}項目を入力しました` : "入力した項目はありません");
      $("hr").scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  // ---- 音声入力 ----
  function setupVoice(buttonId, inputId) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const btn = $(buttonId);
    if (!SR) {
      btn.hidden = true;
      return;
    }
    let rec = null;
    btn.addEventListener("click", () => {
      if (rec) {
        rec.stop();
        return;
      }
      rec = new SR();
      rec.lang = "ja-JP";
      rec.interimResults = false;
      rec.onresult = (e) => {
        const text = Array.from(e.results).map((r) => r[0].transcript).join("");
        const input = $(inputId);
        input.value = input.value ? `${input.value} ${text}` : text;
        update();
      };
      rec.onerror = () => {
        $("voice-hint").textContent = "音声を認識できませんでした。もう一度お試しください。";
      };
      rec.onend = () => {
        btn.classList.remove("is-listening");
        if ($("voice-hint").textContent === "話してください…") $("voice-hint").textContent = "";
        rec = null;
      };
      btn.classList.add("is-listening");
      $("voice-hint").textContent = "話してください…";
      rec.start();
    });
  }

  // ---- 基準と出典 ----
  function renderReference() {
    const B = E.BANDS;
    const peds = ["neonate", "infant", "toddler", "preschool", "school", "adolescent"]
      .map((k) => `<tr><td>${esc(B[k].label)}</td><td>${B[k].hr[1]}〜${B[k].hr[2]}</td><td>${B[k].rr[1]}〜${B[k].rr[2]}</td></tr>`)
      .join("");
    const sources = Object.values(window.VA.SOURCES)
      .map((s) => `<li><b>${esc(s.name)}</b><br><span>${esc(s.org)}・${esc(s.version)}</span></li>`)
      .join("");
    $("ref-body").innerHTML = `
      <h3>成人の判定基準（正常／注意／異常）</h3>
      <div class="va-table-wrap"><table class="va-table">
        <tr><th>項目</th><th>正常</th><th>異常</th></tr>
        <tr><td>HR</td><td>51〜100</td><td>≤40 ／ ≥131</td></tr>
        <tr><td>収縮期血圧</td><td>101〜139</td><td>≤90 ／ ≥180</td></tr>
        <tr><td>拡張期血圧</td><td>〜89</td><td>≥120</td></tr>
        <tr><td>SpO2</td><td>≥96（高CO2血症リスク時 88〜92）</td><td>≤91（同 ≤85）</td></tr>
        <tr><td>RR</td><td>12〜20</td><td>≤8 ／ ≥25</td></tr>
        <tr><td>体温</td><td>36.1〜37.4</td><td>≤35.0 ／ ≥39.0</td></tr>
        <tr><td>意識</td><td>JCS 0・GCS 15</td><td>JCS 10以上・GCS 12以下</td></tr>
      </table></div>
      <p class="hint">正常と異常の間は「注意」です。酸素投与中は SpO2 が正常でも「注意」とします（NEWS2 では酸素投与に2点）。</p>
      <h3>小児の正常範囲（PALS の目安）</h3>
      <div class="va-table-wrap"><table class="va-table"><tr><th>年齢</th><th>HR</th><th>RR</th></tr>${peds}</table></div>
      <p class="hint">収縮期血圧の下限：新生児60、乳児70、1〜10歳は 70＋2×年齢、10歳以上90 mmHg。</p>
      <h3>出典</h3><ul class="va-sources">${sources}</ul>
      <p class="hint">基準値と要点を参照する形で、ガイドライン本文は転載していません。施設の基準がある場合はそちらを優先してください。</p>`;
  }

  // ---- 初期化 ----
  root.querySelectorAll("main input, main select").forEach((el) => {
    if (el.type === "file" || el.closest("#v-import")) return;
    if (NUM_FIELDS.includes(el.id)) el.addEventListener("input", () => clampDigits(el));
    el.addEventListener("input", update);
  });
  $("v-file-camera").addEventListener("change", (e) => onPhoto(e.target));
  $("v-file-photo").addEventListener("change", (e) => onPhoto(e.target));
  $("estimate-btn").addEventListener("click", () => {
    revealed = !revealed;
    update();
    if (revealed) $("results").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("urgency").addEventListener("click", () => {
    if (!revealed && !$("estimate-btn").disabled) {
      revealed = true;
      update();
    }
    const el = $("reasons");
    if (el) {
      el.open = true;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
  $("record-btn").addEventListener("click", record);
  $("new-btn").addEventListener("click", startNew);
  setupVoice("mic-complaint", "complaintText");
  setupVoice("mic-history", "historyText");
  renderReference();

  // 表示するとき: 記録IDがあればその最新の値を、なければ下書きを開く
  function show(id) {
    if (id) {
      const rec = window.VA.cases.get(id);
      if (rec && (rec.id !== caseId || !started)) {
        caseId = rec.id;
        const draft = window.VA.readJSON(DRAFT_KEY, null);
        if (draft && draft.caseId === caseId) {
          writeForm(draft.form);
          revealed = !!draft.revealed;
        } else {
          writeForm(rec.entries[rec.entries.length - 1].form);
          revealed = false;
        }
      }
    } else if (!started) {
      const draft = window.VA.readJSON(DRAFT_KEY, null);
      if (draft) {
        caseId = draft.caseId && window.VA.cases.get(draft.caseId) ? draft.caseId : null;
        writeForm(draft.form);
        revealed = !!draft.revealed;
      }
    }
    started = true;
    update();
  }

  window.VAVitalView = { show };
})();
