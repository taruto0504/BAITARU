(function () {
  "use strict";

  const { esc, chip, cite, fmtTime } = window.VA;
  const E = window.VAEcg;
  const icon = window.icon;
  const root = document.getElementById("view-ecg");
  const $ = (id) => root.querySelector("#" + id);

  const DRAFT_KEY = "vaEcgDraft_v1";
  const QUIZ_KEY = "vaEcgQuiz_v1";
  const PAPER = { paper: "#fff8f8", minor: "#f5cdd0", major: "#e39aa0", trace: "#1b2430" };
  const SAMPLE_PX_PER_MM = 8;
  const INPUTS = ["hr", "pr", "qrs", "qt", "age", "p", "av", "qrsShape"];
  const SEGS = ["pulse", "regularity", "ectopic", "flags", "sex"];
  const URG = {
    arrest: ["心停止のリズム", "alert"],
    high: ["緊急度 高", "alert"],
    mid: ["緊急度 中", "alert"],
    low: ["緊急度 低", "check"],
    none: ["未評価", "info"],
  };

  let recordId = null;

  // ---- タブ ----
  root.querySelectorAll(".tab-btn").forEach((b) => {
    b.addEventListener("click", () => {
      root.querySelectorAll(".tab-btn").forEach((x) => x.classList.toggle("active", x === b));
      root.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + b.dataset.tab));
      $("urgency").hidden = b.dataset.tab !== "judge";
      if (b.dataset.tab === "quiz" && !quiz.current) nextQuiz();
    });
  });

  // ---- 所見フォーム ----
  ["stUp", "stDown"].forEach((id) => {
    $(id).innerHTML = E.LEADS.map((l) => `<button type="button" data-value="${l}">${l}</button>`).join("");
    $(id).addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      b.classList.toggle("on");
      update();
    });
  });

  root.querySelectorAll(".va-seg[data-field]").forEach((seg) => {
    seg.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const on = !b.classList.contains("on");
      if (!seg.dataset.multi) seg.querySelectorAll("button").forEach((x) => x.classList.remove("on"));
      b.classList.toggle("on", on);
      update();
    });
  });

  function segValue(field) {
    const seg = root.querySelector(`.va-seg[data-field="${field}"]`);
    const on = Array.from(seg.querySelectorAll("button.on")).map((b) => b.dataset.value);
    return seg.dataset.multi ? on.join(",") : on[0] || "";
  }

  function readForm() {
    const f = {};
    INPUTS.forEach((k) => {
      f[k] = $(k).value.trim();
    });
    SEGS.forEach((k) => {
      f[k] = segValue(k);
    });
    f.stUp = Array.from($("stUp").querySelectorAll(".on")).map((b) => b.dataset.value);
    f.stDown = Array.from($("stDown").querySelectorAll(".on")).map((b) => b.dataset.value);
    return f;
  }

  function writeForm(f) {
    f = f || {};
    INPUTS.forEach((k) => {
      $(k).value = f[k] || "";
    });
    SEGS.forEach((k) => {
      const seg = root.querySelector(`.va-seg[data-field="${k}"]`);
      const vals = String(f[k] || "").split(",");
      seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", vals.includes(b.dataset.value)));
    });
    ["stUp", "stDown"].forEach((k) => {
      $(k).querySelectorAll("button").forEach((b) => b.classList.toggle("on", (f[k] || []).includes(b.dataset.value)));
    });
  }

  let last = null;

  function update() {
    const f = readForm();
    last = E.evaluate(f);
    render(last);
    window.VA.writeJSON(DRAFT_KEY, { recordId, form: f });
  }

  function candidate(c, i) {
    return `<div class="va-cand${i === 0 ? " is-top" : ""}">
      <div class="va-cand-head"><span class="va-cand-rank">${i + 1}</span><span class="va-cand-name">${esc(c.name)}</span>${c.fit ? `<span class="va-fit">一致度 ${c.fit}</span>` : ""}</div>
      <ul class="va-list">${c.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    </div>`;
  }

  function render(r) {
    const u = URG[r.urgency];
    $("urgency").className = `va-urgency lv-${r.urgency === "arrest" ? "high" : r.urgency}`;
    $("urgency-label").innerHTML = `${icon(u[1])}${esc(u[0])}`;
    const top = r.rhythms[0];
    $("urgency-sub").textContent = r.urgency === "none" ? "波形を見ながら所見を入力すると判定します" : top ? top.name + (r.findings.length ? ` ほか所見${r.findings.length}件` : "") : r.findings.length ? r.findings[0].name : "所見が足りません";

    if (r.urgency === "none") {
      $("results").innerHTML = "";
      return;
    }
    const out = [];
    if (r.warnings.length) out.push(`<div class="va-alert">${r.warnings.map((w) => `<p>${icon("alert")}${esc(w)}</p>`).join("")}</div>`);

    const rhythmBody = r.rhythms.length
      ? `${r.unclear ? `<p class="va-unclear">${icon("info")}上位の候補の差が小さく、判定困難です。両方の可能性を考え、所見を追加・確認してください。</p>` : ""}${r.rhythms.map(candidate).join("")}`
      : `<p class="va-lead">リズムを判定するには、少なくとも心拍数・リズム（RR間隔）・P波・QRSの形を入力してください。</p>`;
    out.push(`<section class="card va-result"><h2>${icon("ecg")}リズムの判定（最大3候補）</h2>${rhythmBody}${cite(top ? top.src : [])}</section>`);

    if (r.findings.length) {
      out.push(
        `<section class="card va-result"><h2>${icon("bookmark")}そのほかの所見</h2>${r.findings
          .map((c) => `<div class="va-index"><div class="va-index-top"><span class="va-index-name">${esc(c.name)}</span>${chip(c.urgency === "high" ? "abn" : c.urgency === "mid" ? "cau" : "ok")}</div><ul class="va-list">${c.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>${cite(c.src)}</div>`)
          .join("")}</section>`
      );
    }

    if (r.measurements.length) {
      out.push(
        `<section class="card va-result"><h2>${icon("calculator")}計測値</h2><div class="va-table-wrap"><table class="va-table"><tr><th>項目</th><th>値</th><th>基準</th><th></th></tr>${r.measurements
          .map((m) => `<tr><td>${esc(m.label)}</td><td class="va-td-num">${esc(m.value)} <small>${esc(m.unit)}</small></td><td>${esc(m.normal)}</td><td>${m.level ? chip(m.level) : ""}</td></tr>`)
          .join("")}</table></div>${cite(["ecgnorm"])}</section>`
      );
    }

    const acts = [];
    const seen = new Set();
    (top ? [top] : []).concat(r.findings).forEach((c) =>
      c.actions.forEach((a) => {
        if (!seen.has(a)) {
          seen.add(a);
          acts.push({ a, from: c.name });
        }
      })
    );
    if (acts.length) {
      out.push(
        `<section class="card va-result"><h2>${icon("bolt")}次の行動の提案</h2><ol class="va-actions">${acts.map((x) => `<li><div>${esc(x.a)}</div><small>${esc(x.from)}</small></li>`).join("")}</ol>${cite(["jrc", "arrhythmia"])}<p class="va-lead">薬剤の種類・量、電気ショックのエネルギーは、施設のプロトコルと医師の指示に従ってください。</p></section>`
      );
    }
    $("results").innerHTML = out.join("");
  }

  // ---- 記録 ----
  function record() {
    const f = readForm();
    if (!last || last.urgency === "none") {
      showMsg("記録する所見がありません。", true);
      return;
    }
    const now = new Date().toISOString();
    const rec = {
      id: recordId || window.VA.newId(),
      createdAt: now,
      updatedAt: now,
      label: last.rhythms[0] ? last.rhythms[0].name : last.findings[0] ? last.findings[0].name : "所見のみ",
      urgency: last.urgency,
      summary: [f.hr && `HR ${f.hr}`, f.pr && `PR ${f.pr}`, f.qrs && `QRS ${f.qrs}`, f.qt && `QT ${f.qt}`].filter(Boolean).join(" ・ "),
      form: f,
    };
    const prev = recordId ? window.VA.ecg.get(recordId) : null;
    if (prev) rec.createdAt = prev.createdAt;
    if (!window.VA.ecg.save(rec)) {
      showMsg("保存できませんでした。", true);
      return;
    }
    recordId = rec.id;
    history.replaceState(null, "", "#ecg/" + recordId);
    showMsg(`${fmtTime(now)} に記録しました（画像は保存していません）`);
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

  // ---- 画像ビューアと電子キャリパー ----
  const view = {
    source: null, // HTMLImageElement or canvas
    w: 0,
    h: 0,
    zoom: 1,
    pxPerMm: null,
    mode: "measure",
    points: [],
  };
  const vc = $("viewer-canvas");

  function baseScale() {
    const width = $("viewer").clientWidth || 320;
    return width / view.w;
  }

  function drawViewer() {
    const ctx = vc.getContext("2d");
    if (!view.source) {
      vc.width = $("viewer").clientWidth || 320;
      vc.height = 120;
      ctx.fillStyle = "#eef2f6";
      ctx.fillRect(0, 0, vc.width, vc.height);
      return;
    }
    const s = baseScale() * view.zoom;
    vc.width = Math.round(view.w * s);
    vc.height = Math.round(view.h * s);
    ctx.drawImage(view.source, 0, 0, vc.width, vc.height);
    const colors = ["#0a6cb4", "#c22f2f"];
    view.points.forEach((p, i) => {
      ctx.strokeStyle = colors[i];
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(p.x * s, 0);
      ctx.lineTo(p.x * s, vc.height);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = colors[i];
      ctx.beginPath();
      ctx.arc(p.x * s, p.y * s, 5, 0, Math.PI * 2);
      ctx.fill();
    });
    if (view.points.length === 2) {
      const [a, b] = view.points;
      ctx.strokeStyle = "#0a6cb4";
      ctx.lineWidth = 2;
      const y = Math.min(a.y, b.y) * s - 14;
      ctx.beginPath();
      ctx.moveTo(a.x * s, y);
      ctx.lineTo(b.x * s, y);
      ctx.stroke();
    }
  }

  function setSource(source, w, h, pxPerMm, tag) {
    view.source = source;
    view.w = w;
    view.h = h;
    // 横長の記録でも波形が読める高さ(約220px)で表示し、横はスクロールで見る
    view.zoom = Math.min(6, Math.max(1, 220 / (h * baseScale())));
    view.points = [];
    view.pxPerMm = pxPerMm;
    $("viewer-tag").textContent = tag;
    setMode(pxPerMm ? "measure" : "calib");
    drawViewer();
    renderCaliper();
  }

  function setMode(mode) {
    view.mode = mode;
    view.points = [];
    $("caliper-mode").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
    $("calib-span-wrap").hidden = mode !== "calib";
    renderCaliper();
    drawViewer();
  }

  function speed() {
    const b = $("speed").querySelector("button.on");
    return b ? Number(b.dataset.value) : 25;
  }

  function renderCaliper() {
    const out = $("caliper-out");
    if (!view.source) {
      out.innerHTML = "";
      return;
    }
    if (view.mode === "calib") {
      out.innerHTML = `<p>${icon("info")}方眼の太い線の上を、左右に2点タップしてください（間隔は下で選択）。${view.points.length === 1 ? "<b>あと1点</b>" : ""}</p>`;
      return;
    }
    if (!view.pxPerMm) {
      out.innerHTML = `<p>${icon("alert")}先に「縮尺合わせ」で方眼の間隔を合わせてください。</p>`;
      return;
    }
    if (view.points.length < 2) {
      out.innerHTML = `<p>${icon("info")}計測したい区間の始まりと終わりを2点タップしてください（例：R波からR波、P波の始まりからQRSの始まり）。</p>`;
      return;
    }
    const [a, b] = view.points;
    const mm = Math.abs(b.x - a.x) / view.pxPerMm;
    const ms = Math.round((mm / speed()) * 1000);
    const mv = Math.abs(b.y - a.y) / view.pxPerMm / 10;
    const hr = ms > 0 ? Math.round(60000 / ms) : null;
    out.innerHTML = `<div class="va-caliper-val"><b>${ms}</b> ms <span>（${mm.toFixed(1)}mm・高さの差 ${mv.toFixed(2)}mV）</span></div>
      <div class="va-assign">
        <button type="button" class="btn-secondary" data-assign="hr">RR → 心拍数 ${hr || "-"}</button>
        <button type="button" class="btn-secondary" data-assign="pr">PRに入れる</button>
        <button type="button" class="btn-secondary" data-assign="qrs">QRSに入れる</button>
        <button type="button" class="btn-secondary" data-assign="qt">QTに入れる</button>
      </div>`;
    out.querySelectorAll("[data-assign]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const k = btn.dataset.assign;
        $(k).value = k === "hr" ? hr : ms;
        update();
        $(k).classList.add("va-flash");
        setTimeout(() => $(k).classList.remove("va-flash"), 900);
      });
    });
  }

  vc.addEventListener("click", (e) => {
    if (!view.source) return;
    const rect = vc.getBoundingClientRect();
    const s = rect.width / view.w;
    const p = { x: (e.clientX - rect.left) / s, y: (e.clientY - rect.top) / s };
    if (view.points.length >= 2) view.points = [];
    view.points.push(p);
    if (view.mode === "calib" && view.points.length === 2) {
      const dx = Math.abs(view.points[1].x - view.points[0].x);
      if (dx > 4) {
        view.pxPerMm = dx / Number($("calib-span").value);
        $("viewer-tag").textContent = "縮尺を合わせました";
        setMode("measure");
        return;
      }
      view.points = [];
    }
    drawViewer();
    renderCaliper();
  });

  $("caliper-mode").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) setMode(b.dataset.mode);
  });
  $("speed").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    $("speed").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    renderCaliper();
  });
  $("zoom-in").addEventListener("click", () => {
    view.zoom = Math.min(6, view.zoom * 1.5);
    drawViewer();
  });
  $("zoom-out").addEventListener("click", () => {
    view.zoom = Math.max(1, view.zoom / 1.5);
    drawViewer();
  });

  function loadFile(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setSource(img, img.naturalWidth, img.naturalHeight, null, "読み込んだ画像（縮尺未設定）");
      view.file = file;
      $("ai-out").innerHTML = "";
      window.VAReader.available().then((ok) => {
        $("ai-read").hidden = !ok || view.file !== file;
      });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      $("viewer-tag").textContent = "画像を読み込めませんでした。別の画像を選んでください。";
      URL.revokeObjectURL(url);
    };
    img.src = url;
    input.value = "";
  }
  $("file-camera").addEventListener("change", (e) => loadFile(e.target));
  $("file-photo").addEventListener("change", (e) => loadFile(e.target));

  let sampleIndex = 0;
  const SAMPLE_TYPES = ["nsr", "af", "avb1", "pvc", "wenck", "stach", "afl", "avb3", "stemiInf", "rbbb"];
  function loadSample() {
    const type = SAMPLE_TYPES[sampleIndex % SAMPLE_TYPES.length];
    sampleIndex++;
    view.file = null;
    $("ai-read").hidden = true;
    const strip = E.makeStrip(type, 6, 7 + sampleIndex);
    const c = document.createElement("canvas");
    E.drawStrip(c, strip, SAMPLE_PX_PER_MM, PAPER);
    setSource(c, c.width, c.height, SAMPLE_PX_PER_MM, `見本：${strip.label}（縮尺設定済み・押すたびに変わります）`);
  }
  $("load-sample-strip").addEventListener("click", loadSample);
  window.addEventListener("resize", drawViewer);

  // ---- 写真から所見を読み取る(AI) ----
  // 読み取った所見を入力欄に入れ、ルール判定と AI の推定を並べて示す(2系統の判定)。
  const ALLOWED = {
    regularity: ["reg", "irreg", "irregirreg"],
    p: ["normal", "none", "fib", "flutter", "more", "retro"],
    av: ["prolonging", "drop", "dissoc"],
    qrsShape: ["normal", "wide", "rbbb", "lbbb", "delta", "polymorph", "chaotic", "flat"],
    flags: ["peakedT", "qwave", "brugada", "pacing", "noise"],
  };
  const CONF_LABEL = { high: "高", mid: "中", low: "低" };
  let aiCtl = null;

  $("ai-read").addEventListener("click", async () => {
    if (!view.file || aiCtl) return;
    const btn = $("ai-read");
    btn.disabled = true;
    $("ai-out").innerHTML = `<div class="va-import-status"><span class="va-spinner"></span>所見を読み取っています…（数十秒かかることがあります）<button type="button" class="va-text-btn" id="ai-stop">中止</button></div>`;
    aiCtl = new AbortController();
    $("ai-stop").addEventListener("click", () => aiCtl && aiCtl.abort());
    try {
      applyAi((await window.VAReader.read("ecg", view.file, aiCtl.signal)) || {});
    } catch (e) {
      $("ai-out").innerHTML = e.code === "cancelled" ? "" : `<p class="va-ai-msg">${icon("alert")}${esc(e.message)}</p>`;
    } finally {
      aiCtl = null;
      btn.disabled = false;
    }
  });

  function applyAi(r) {
    if (r.readable === false) {
      $("ai-out").innerHTML = `<p class="va-ai-msg">${icon("alert")}波形を読み取れませんでした。${esc(r.reason || "")} 撮り直すか、電子キャリパーで計測してください。</p>`;
      return;
    }
    const f = readForm();
    ["hr", "pr", "qrs", "qt"].forEach((k) => {
      const n = Number(r[k]);
      if (r[k] != null && isFinite(n) && n > 0) f[k] = String(Math.round(n));
    });
    ["regularity", "p", "av", "qrsShape"].forEach((k) => {
      if (ALLOWED[k].includes(r[k])) f[k] = r[k];
    });
    if (Array.isArray(r.flags)) f.flags = r.flags.filter((x) => ALLOWED.flags.includes(x)).join(",");
    ["stUp", "stDown"].forEach((k) => {
      if (Array.isArray(r[k])) f[k] = r[k].filter((l) => E.LEADS.includes(l));
    });
    writeForm(f);
    update();
    const top = last.rhythms[0];
    const core = (name) => String(name || "").replace(/[（(].*?[）)]/g, "").trim();
    const aiName = core(r.rhythm);
    const agree = top && aiName && (core(top.name).includes(aiName) || aiName.includes(core(top.name)));
    $("ai-out").innerHTML = `<div class="va-ai-result">
      <div class="va-ai-row"><span>AIの読み取り</span><b>${esc(r.rhythm || "判定なし")}</b>${r.confidence ? `<span class="va-fit">確からしさ ${esc(CONF_LABEL[r.confidence] || r.confidence)}</span>` : ""}</div>
      <div class="va-ai-row"><span>所見からのルール判定</span><b>${esc(top ? top.name : "判定できず")}</b></div>
      <p class="${agree ? "va-ai-agree" : "va-unclear"}">${icon(agree ? "check" : "info")}${
        agree ? "2つの判定が一致しました。" : "2つの判定が一致しません（判定困難）。両方の可能性を考え、波形と所見を確認してください。"
      }</p>
      ${Array.isArray(r.quality) && r.quality.length ? `<p class="hint">${icon("alert")}読み取りに影響した点：${esc(r.quality.join("、"))}</p>` : ""}
      <p class="hint">読み取った所見を下の「所見」に入れました。波形と見比べて確認・修正してください。修正すると判定も更新されます。</p>
    </div>`;
  }

  // ---- クイズ ----
  const quiz = Object.assign({ current: null, answered: false }, window.VA.readJSON(QUIZ_KEY, { correct: 0, total: 0 }));

  function nextQuiz() {
    const keys = Object.keys(E.WAVES);
    let type;
    do type = keys[Math.floor(Math.random() * keys.length)];
    while (quiz.current && type === quiz.current.type);
    const strip = E.makeStrip(type, 6, Math.floor(Math.random() * 1e9));
    quiz.current = strip;
    quiz.answered = false;
    E.drawStrip($("quiz-canvas"), strip, 5, PAPER);
    $("quiz-canvas").parentElement.scrollLeft = 0;
    const info = E.WAVES[type];
    $("quiz-meta").innerHTML = `<span class="va-quiz-lead">誘導 ${esc(strip.lead)}</span>${info.context ? `<span class="va-quiz-context">${icon("info")}状況：${esc(info.context)}</span>` : ""}`;
    $("quiz-choices").innerHTML = E.quizChoices(type).map((k) => `<button type="button" class="btn-secondary" data-k="${k}">${esc(E.WAVES[k].label)}</button>`).join("");
    $("quiz-feedback").innerHTML = "";
    renderScore();
  }

  function renderScore() {
    $("quiz-score").textContent = quiz.total ? `これまでの正解 ${quiz.correct} / ${quiz.total}` : "";
  }

  const RISK_CHIP = { arrest: "abn", high: "abn", mid: "cau", low: "ok" };

  $("quiz-choices").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || quiz.answered) return;
    quiz.answered = true;
    const ok = b.dataset.k === quiz.current.type;
    quiz.total++;
    if (ok) quiz.correct++;
    window.VA.writeJSON(QUIZ_KEY, { correct: quiz.correct, total: quiz.total });
    $("quiz-choices").querySelectorAll("button").forEach((x) => {
      x.classList.toggle("is-correct", x.dataset.k === quiz.current.type);
      x.classList.toggle("is-wrong", x === b && !ok);
    });
    const info = E.WAVES[quiz.current.type];
    $("quiz-feedback").innerHTML = `<div class="va-quiz-fb ${ok ? "ok" : "ng"}">${icon(ok ? "check" : "x")}<div><b>${ok ? "正解" : "不正解"}：${esc(info.label)}</b>${quiz.current.hr ? `（心拍数 約${quiz.current.hr}回/分）` : ""}<p>${esc(info.explain)}</p></div></div>
      <div class="va-quiz-more">
        <div class="va-quiz-h">${icon("bookmark")}考えられる疾患・原因</div>
        <ul class="va-list">${info.causes.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
        <div class="va-quiz-h">${icon("alert")}リスク <span class="va-chip lv-${RISK_CHIP[info.risk]}">${esc(E.RISK_LABEL[info.risk])}</span></div>
        <p class="va-quiz-risk">${esc(info.riskText)}</p>
      </div>`;
    renderScore();
  });
  $("quiz-next").addEventListener("click", nextQuiz);

  // ---- 初期化 ----
  root.querySelectorAll("#tab-judge input:not([type=file]), #tab-judge select").forEach((el) => {
    if (el.id !== "calib-span") el.addEventListener("input", update);
  });
  $("record-btn").addEventListener("click", record);
  $("clear-btn").addEventListener("click", () => {
    recordId = null;
    history.replaceState(null, "", "#ecg");
    writeForm({});
    $("ai-out").innerHTML = "";
    update();
  });
  $("example-btn").addEventListener("click", () => {
    writeForm({ hr: "132", regularity: "irregirreg", p: "fib", qrsShape: "normal", qrs: "88", qt: "320", sex: "m", age: "74" });
    update();
  });
  $("urgency").addEventListener("click", () => {
    const el = $("results");
    if (el.firstChild) el.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  let started = false;
  function show(id) {
    if (id) {
      const saved = window.VA.ecg.get(id);
      if (saved && saved.id !== recordId) {
        recordId = saved.id;
        writeForm(saved.form);
      }
    } else if (!started) {
      const draft = window.VA.readJSON(DRAFT_KEY, null);
      if (draft) {
        recordId = draft.recordId && window.VA.ecg.get(draft.recordId) ? draft.recordId : null;
        writeForm(draft.form);
      }
    }
    if (!started) loadSample();
    started = true;
    update();
  }

  window.VAEcgView = { show };
})();
