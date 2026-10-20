(function () {
  "use strict";

  // ===== VITAL ASSESS: 記録の保存と出典の共通部分 =====
  // 記録は端末内(localStorage)にのみ保存します。氏名・患者IDは入力項目に設けていません。
  const CASES_KEY = "vaCases_v1";
  const ECG_KEY = "vaEcgRecords_v1";
  const MAX_RECORDS = 100;

  // 判定の根拠として表示する出典。版は採用時点のもので、改訂時はここを差し替えます。
  const SOURCES = {
    news2: { name: "NEWS2（National Early Warning Score 2）", org: "英国王立内科医協会（RCP）", version: "2017年版" },
    sepsis: { name: "Sepsis-3 ／ 日本版敗血症診療ガイドライン", org: "JAMA 2016 ／ 日本集中治療医学会・日本救急医学会", version: "Sepsis-3（2016）／ J-SSCG2024" },
    jatec: { name: "外傷初期診療ガイドライン JATEC", org: "日本外傷学会・日本救急医学会", version: "改訂第6版" },
    jsh: { name: "高血圧管理・治療ガイドライン", org: "日本高血圧学会", version: "JSH2025" },
    aorta: { name: "大動脈瘤・大動脈解離診療ガイドライン", org: "日本循環器学会ほか", version: "2020年改訂版" },
    acs: { name: "急性冠症候群ガイドライン", org: "日本循環器学会ほか", version: "2018年改訂版" },
    stroke: { name: "脳卒中治療ガイドライン", org: "日本脳卒中学会", version: "2021〔改訂2023〕" },
    o2: { name: "成人の救急時酸素療法ガイドライン", org: "英国胸部学会（BTS）", version: "2017年版" },
    jrc: { name: "JRC蘇生ガイドライン（心停止・徐脈・頻拍のアルゴリズム）", org: "日本蘇生協議会", version: "採用時に最新版を確認" },
    pals: { name: "PALS（小児二次救命処置）の年齢別バイタルサイン", org: "American Heart Association", version: "2020年版" },
    arrhythmia: { name: "不整脈治療ガイドライン", org: "日本循環器学会・日本不整脈心電学会", version: "2020年改訂版 不整脈薬物治療 ／ 2024年フォーカスアップデート" },
    ecgnorm: { name: "心電図の標準化と解釈に関する勧告", org: "AHA/ACCF/HRS", version: "2009年" },
    anaphylaxis: { name: "アナフィラキシーガイドライン", org: "日本アレルギー学会", version: "2022" },
    jcs: { name: "Japan Coma Scale ／ Glasgow Coma Scale", org: "太田富雄ほか ／ Teasdale & Jennett", version: "1974" },
  };

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function store(key) {
    return {
      list() {
        const items = readJSON(key, []);
        return Array.isArray(items) ? items : [];
      },
      get(id) {
        return this.list().find((r) => r.id === id) || null;
      },
      save(record) {
        const items = this.list().filter((r) => r.id !== record.id);
        items.unshift(record);
        return writeJSON(key, items.slice(0, MAX_RECORDS));
      },
      remove(id) {
        return writeJSON(key, this.list().filter((r) => r.id !== id));
      },
      clear() {
        return writeJSON(key, []);
      },
    };
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function fmtTime(iso, withDate) {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const pad = (n) => String(n).padStart(2, "0");
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return withDate ? `${d.getMonth() + 1}/${d.getDate()} ${time}` : time;
  }

  // 出典の小さな注記: cite(["news2", "o2"])
  function cite(ids) {
    const list = (ids || []).map((id) => SOURCES[id]).filter(Boolean);
    if (!list.length) return "";
    return `<div class="va-cite">出典: ${list.map((s) => `${esc(s.name)}（${esc(s.version)}）`).join("、")}</div>`;
  }

  const LEVEL_LABEL = { ok: "正常", cau: "注意", abn: "異常" };
  const LEVEL_ICON = { ok: "check", cau: "alert", abn: "x" };

  // 色だけに頼らず、アイコンと文字でも区別する状態チップ
  function chip(level, extra) {
    if (!level) return "";
    const ic = window.icon ? window.icon(LEVEL_ICON[level]) : "";
    return `<span class="va-chip lv-${level}">${ic}${LEVEL_LABEL[level]}${extra ? " " + esc(extra) : ""}</span>`;
  }

  // 2回タップで確定するボタン(window.confirm を使わない)
  function twoTap(button, onConfirm, armedLabel) {
    let timer = null;
    const original = button.innerHTML;
    button.addEventListener("click", () => {
      if (button.classList.contains("confirm-armed")) {
        clearTimeout(timer);
        button.classList.remove("confirm-armed");
        button.innerHTML = original;
        onConfirm();
        return;
      }
      button.classList.add("confirm-armed");
      button.textContent = armedLabel || "もう一度押すと削除";
      timer = setTimeout(() => {
        button.classList.remove("confirm-armed");
        button.innerHTML = original;
      }, 3000);
    });
  }

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

  window.VA = {
    SOURCES,
    cases: store(CASES_KEY),
    ecg: store(ECG_KEY),
    readJSON,
    writeJSON,
    newId,
    esc,
    fmtTime,
    cite,
    chip,
    twoTap,
    clampDigits,
    LEVEL_LABEL,
  };
})();
