(function (root) {
  "use strict";

  // ===== バイタルサイン評価のルール判定 =====
  // 判定は毎回同じ結果になるルールベースで、各結果に根拠(出典ID)を付けます。
  // 入力はすべて任意で、null の項目は判定に使いません。

  const COMPLAINTS = ["胸痛", "背部痛", "呼吸困難", "意識障害", "頭痛", "腹痛", "失神", "動悸", "発熱", "めまい", "痙攣", "麻痺・しびれ", "嘔吐", "吐血・下血", "外傷", "咳・痰", "皮疹・かゆみ", "倦怠感"];
  const HISTORY = ["高血圧", "糖尿病", "脂質異常症", "狭心症・心筋梗塞", "心不全", "心房細動・不整脈", "脳血管疾患", "COPD", "喘息", "腎疾患・透析", "悪性腫瘍", "肝疾患", "アレルギー", "抗凝固薬内服", "喫煙", "妊娠中"];

  // 自由入力からも主訴・既往を拾うためのキーワード
  const COMPLAINT_WORDS = {
    胸痛: ["胸痛", "胸が痛", "胸部痛", "胸部圧迫", "胸苦"],
    背部痛: ["背部痛", "背中", "腰背部"],
    呼吸困難: ["呼吸困難", "息苦", "息切れ", "呼吸苦"],
    意識障害: ["意識", "反応が", "ぼんやり", "せん妄"],
    頭痛: ["頭痛", "頭が痛"],
    腹痛: ["腹痛", "お腹", "腹部痛"],
    失神: ["失神", "気を失", "一過性意識消失"],
    動悸: ["動悸", "ドキドキ"],
    発熱: ["発熱", "熱"],
    めまい: ["めまい", "眩暈", "ふらつ"],
    痙攣: ["痙攣", "けいれん", "ひきつけ"],
    "麻痺・しびれ": ["麻痺", "しびれ", "痺れ", "構音", "ろれつ"],
    嘔吐: ["嘔吐", "吐き気", "嘔気"],
    "吐血・下血": ["吐血", "下血", "黒色便", "タール便"],
    外傷: ["外傷", "転落", "交通事故", "打撲", "受傷"],
    "咳・痰": ["咳", "痰"],
    "皮疹・かゆみ": ["皮疹", "じんましん", "蕁麻疹", "かゆみ", "発赤"],
    倦怠感: ["倦怠", "だるい"],
  };
  const HISTORY_WORDS = {
    高血圧: ["高血圧", "HT"],
    糖尿病: ["糖尿病", "DM"],
    脂質異常症: ["脂質異常", "高脂血症"],
    "狭心症・心筋梗塞": ["狭心症", "心筋梗塞", "AMI", "OMI", "PCI", "CABG"],
    心不全: ["心不全", "CHF"],
    "心房細動・不整脈": ["心房細動", "AF", "不整脈"],
    脳血管疾患: ["脳梗塞", "脳出血", "脳卒中", "くも膜下"],
    COPD: ["COPD", "肺気腫"],
    喘息: ["喘息"],
    "腎疾患・透析": ["透析", "腎不全", "CKD"],
    悪性腫瘍: ["癌", "がん", "腫瘍"],
    肝疾患: ["肝硬変", "肝炎"],
    アレルギー: ["アレルギー"],
    抗凝固薬内服: ["ワーファリン", "ワルファリン", "抗凝固", "DOAC", "エリキュース", "イグザレルト", "リクシアナ", "プラザキサ"],
    喫煙: ["喫煙", "タバコ"],
    妊娠中: ["妊娠"],
  };

  // 生理的にありえない値・単位の誤りを疑う範囲
  const PLAUSIBLE = {
    age: [0, 120, "歳"],
    hr: [15, 300, "回/分"],
    sys: [30, 300, "mmHg"],
    dia: [10, 200, "mmHg"],
    spo2: [40, 100, "%"],
    rr: [2, 80, "回/分"],
    temp: [25, 45, "℃"],
    o2Flow: [0.1, 60, "L/分"],
  };

  // 年齢帯ごとの正常範囲。小児は PALS の年齢別の目安。
  // judge 用の配列は [異常(低)の上限, 正常の下限, 正常の上限, 異常(高)の下限]
  const BANDS = {
    neonate: { label: "新生児", hr: [80, 100, 180, 205], rr: [20, 30, 60, 70], sbpLow: 60, peds: true },
    infant: { label: "乳児", hr: [80, 100, 160, 200], rr: [20, 30, 53, 65], sbpLow: 70, peds: true },
    toddler: { label: "幼児（1〜2歳）", hr: [70, 98, 140, 180], rr: [16, 22, 37, 45], peds: true },
    preschool: { label: "幼児（3〜5歳）", hr: [60, 80, 120, 160], rr: [14, 20, 28, 35], peds: true },
    school: { label: "学童（6〜11歳）", hr: [55, 75, 118, 150], rr: [12, 18, 25, 32], peds: true },
    adolescent: { label: "思春期（12〜15歳）", hr: [45, 60, 100, 130], rr: [10, 12, 20, 25], sbpLow: 90, peds: true },
    child: { label: "小児（年齢不明）", hr: [60, 70, 150, 190], rr: [12, 18, 40, 50], sbpLow: 70, peds: true },
    adult: { label: "成人", hr: [40, 51, 100, 131], rr: [8, 12, 20, 25] },
    elderly: { label: "高齢者", hr: [40, 51, 100, 131], rr: [8, 12, 20, 25] },
  };

  const JCS_VALUES = ["0", "1", "2", "3", "10", "20", "30", "100", "200", "300"];

  function num(x) {
    if (x === null || x === undefined || x === "") return null;
    const n = typeof x === "number" ? x : parseFloat(String(x).replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
    return isFinite(n) ? n : null;
  }

  function judge(x, t) {
    if (x == null) return null;
    if (x <= t[0]) return { level: "abn", dir: "low" };
    if (x < t[1]) return { level: "cau", dir: "low" };
    if (x <= t[2]) return { level: "ok", dir: null };
    if (x < t[3]) return { level: "cau", dir: "high" };
    return { level: "abn", dir: "high" };
  }

  function bandOf(v) {
    if (v.age != null) {
      const a = v.age;
      if (a < 1 / 12) return "neonate";
      if (a < 1) return "infant";
      if (a < 3) return "toddler";
      if (a < 6) return "preschool";
      if (a < 12) return "school";
      if (a < 16) return "adolescent";
      if (a < 65) return "adult";
      return "elderly";
    }
    return BANDS[v.ageGroup] ? v.ageGroup : "adult";
  }

  // 小児の収縮期血圧の下限: 70 + 2 × 年齢(1〜10歳)
  function sbpLowFor(band, age) {
    if (BANDS[band].sbpLow) return BANDS[band].sbpLow;
    const a = age == null ? 5 : Math.min(10, Math.max(1, age));
    return 70 + 2 * a;
  }

  function sbpThresholds(band, age) {
    if (!BANDS[band].peds) return [90, 101, 139, 180];
    const low = sbpLowFor(band, age);
    if (band === "adolescent") return [low, low + 10, 139, 180];
    return [low, low + 10, 120, 150];
  }

  // ---- 入力の整理と確認メッセージ ----
  function normalize(raw) {
    const v = Object.assign({}, raw);
    ["age", "hr", "rSys", "rDia", "lSys", "lDia", "spo2", "o2Flow", "rr", "temp", "gcsE", "gcsV", "gcsM"].forEach((k) => {
      v[k] = num(raw[k]);
    });
    v.complaints = (raw.complaints || []).slice();
    v.history = (raw.history || []).slice();
    const ct = raw.complaintText || "";
    Object.keys(COMPLAINT_WORDS).forEach((k) => {
      if (!v.complaints.includes(k) && COMPLAINT_WORDS[k].some((w) => ct.includes(w))) v.complaints.push(k);
    });
    const ht = raw.historyText || "";
    Object.keys(HISTORY_WORDS).forEach((k) => {
      if (!v.history.includes(k) && HISTORY_WORDS[k].some((w) => ht.includes(w))) v.history.push(k);
    });

    const checks = [];
    const range = (key, field, label, rangeKey) => {
      const x = v[key];
      if (x == null) return;
      const [lo, hi, unit] = PLAUSIBLE[rangeKey || key];
      if (x < lo || x > hi) {
        let fix = null;
        if (x > hi && x / 10 >= lo && x / 10 <= hi) fix = x / 10;
        checks.push({ field, message: `${label} ${x} ${unit} は通常ありえない値です。${fix != null ? `${fix} ${unit} の入力間違いではありませんか？` : "単位や桁を確認してください。"}`, fix });
        v[key] = null; // 確認が済むまで判定に使わない
      }
    };
    range("age", "age", "年齢");
    range("hr", "hr", "HR");
    range("rSys", "rSys", "右の収縮期血圧", "sys");
    range("rDia", "rDia", "右の拡張期血圧", "dia");
    range("lSys", "lSys", "左の収縮期血圧", "sys");
    range("lDia", "lDia", "左の拡張期血圧", "dia");
    range("spo2", "spo2", "SpO2");
    range("rr", "rr", "RR");
    range("temp", "temp", "体温");
    range("o2Flow", "o2Flow", "酸素流量");
    [["r", "右"], ["l", "左"]].forEach(([s, label]) => {
      if (v[s + "Sys"] != null && v[s + "Dia"] != null && v[s + "Dia"] >= v[s + "Sys"]) {
        checks.push({ field: s + "Dia", message: `${label}の拡張期血圧が収縮期血圧以上になっています。入れ替わっていませんか？` });
        v[s + "Dia"] = null;
      }
    });

    // 代表の血圧: 左右両方あるときは収縮期が高い側
    const sides = [
      { sys: v.rSys, dia: v.rDia },
      { sys: v.lSys, dia: v.lDia },
    ].filter((s) => s.sys != null);
    sides.sort((a, b) => b.sys - a.sys);
    v.sys = sides.length ? sides[0].sys : null;
    v.dia = sides.length ? sides[0].dia : v.rDia != null ? v.rDia : v.lDia;

    v.gcs = v.gcsE != null && v.gcsV != null && v.gcsM != null ? v.gcsE + v.gcsV + v.gcsM : null;
    v.jcsNum = JCS_VALUES.includes(String(raw.jcs)) ? Number(raw.jcs) : null;
    // 意識の変化(NEWS2 の「A 以外」、qSOFA の意識変容)
    v.consciousKnown = v.gcs != null || v.jcsNum != null;
    v.altered = (v.gcs != null && v.gcs < 15) || (v.jcsNum != null && v.jcsNum > 0);
    v.band = bandOf(v);
    v.peds = !!BANDS[v.band].peds;
    return { v, checks };
  }

  // ---- 各バイタルの判定 ----
  function vitals(v) {
    const b = BANDS[v.band];
    const out = [];
    const add = (key, label, value, unit, j, note, src) => out.push(Object.assign({ key, label, value, unit, note, src }, j || { level: null, dir: null }));

    add("hr", "HR", v.hr, "回/分", judge(v.hr, b.hr), v.hrRhythm === "irreg" ? "不整" : "", v.peds ? ["pals"] : ["news2"]);

    const st = sbpThresholds(v.band, v.age);
    const bp = (s, d) => {
      if (s == null) return null;
      const js = judge(s, st);
      if (d != null && !v.peds) {
        const jd = judge(d, [0, 0, 89, 120]);
        if (jd.level === "abn" || (jd.level === "cau" && js.level === "ok")) return jd;
      }
      return js;
    };
    add("bpR", "血圧（右）", v.rSys != null ? `${v.rSys}${v.rDia != null ? "/" + v.rDia : ""}` : null, "mmHg", bp(v.rSys, v.rDia), "", v.peds ? ["pals"] : ["news2", "jsh"]);
    add("bpL", "血圧（左）", v.lSys != null ? `${v.lSys}${v.lDia != null ? "/" + v.lDia : ""}` : null, "mmHg", bp(v.lSys, v.lDia), "", v.peds ? ["pals"] : ["news2", "jsh"]);

    let sj = null;
    let note = v.o2 === "o2" ? `酸素投与中${v.o2Flow != null ? " " + v.o2Flow + "L/分" : ""}` : v.o2 === "air" ? "室内気" : "";
    if (v.spo2 != null) {
      if (v.hypercapnic) {
        sj = v.spo2 <= 85 ? { level: "abn", dir: "low" } : v.spo2 < 88 ? { level: "cau", dir: "low" } : v.spo2 <= 92 || v.o2 !== "o2" ? { level: "ok", dir: null } : { level: "cau", dir: "high" };
        note += (note ? "・" : "") + "目標88〜92%";
      } else {
        sj = judge(v.spo2, [91, 96, 100, 101]);
        if (sj.level === "ok" && v.o2 === "o2") sj = { level: "cau", dir: null };
      }
    }
    add("spo2", "SpO2", v.spo2, "%", sj, note, ["o2", "news2"]);
    add("rr", "RR", v.rr, "回/分", judge(v.rr, b.rr), "", v.peds ? ["pals"] : ["news2"]);
    add("temp", "体温", v.temp, "℃", judge(v.temp, [35.0, 36.1, 37.4, 39.0]), "", ["news2"]);

    let cj = null;
    let cv = null;
    if (v.gcs != null) {
      cj = v.gcs === 15 ? { level: "ok" } : v.gcs >= 13 ? { level: "cau", dir: "low" } : { level: "abn", dir: "low" };
      cv = `GCS ${v.gcs}（E${v.gcsE}V${v.gcsV}M${v.gcsM}）`;
    }
    if (v.jcsNum != null) {
      const jj = v.jcsNum === 0 ? { level: "ok" } : v.jcsNum < 10 ? { level: "cau", dir: "low" } : { level: "abn", dir: "low" };
      const rank = { ok: 0, cau: 1, abn: 2 };
      if (!cj || rank[jj.level] > rank[cj.level]) cj = jj;
      cv = `JCS ${v.jcsNum}${v.jcsSuffix || ""}` + (cv ? `・${cv}` : "");
    }
    add("conscious", "意識", cv, "", cj, "", ["jcs"]);
    return out;
  }

  // ---- NEWS2(成人) ----
  function news2(v) {
    if (v.peds) return null;
    const parts = [];
    const missing = [];
    const p = (label, value, pts) => {
      if (value == null) missing.push(label);
      else parts.push({ label, pts });
    };
    const rr = v.rr;
    p("呼吸数", rr, rr == null ? 0 : rr <= 8 ? 3 : rr <= 11 ? 1 : rr <= 20 ? 0 : rr <= 24 ? 2 : 3);
    const s = v.spo2;
    let sp = 0;
    if (s != null) {
      if (v.hypercapnic) {
        if (s <= 83) sp = 3;
        else if (s <= 85) sp = 2;
        else if (s <= 87) sp = 1;
        else if (s <= 92 || v.o2 !== "o2") sp = 0;
        else if (s <= 94) sp = 1;
        else if (s <= 96) sp = 2;
        else sp = 3;
      } else sp = s <= 91 ? 3 : s <= 93 ? 2 : s <= 95 ? 1 : 0;
    }
    p("SpO2", s, sp);
    p("酸素投与", v.o2 || null, v.o2 === "o2" ? 2 : 0);
    const sbp = v.sys;
    p("収縮期血圧", sbp, sbp == null ? 0 : sbp <= 90 ? 3 : sbp <= 100 ? 2 : sbp <= 110 ? 1 : sbp <= 219 ? 0 : 3);
    const hr = v.hr;
    p("脈拍", hr, hr == null ? 0 : hr <= 40 ? 3 : hr <= 50 ? 1 : hr <= 90 ? 0 : hr <= 110 ? 1 : hr <= 130 ? 2 : 3);
    p("意識", v.consciousKnown ? 1 : null, v.altered ? 3 : 0);
    const t = v.temp;
    p("体温", t, t == null ? 0 : t <= 35.0 ? 3 : t <= 36.0 ? 1 : t <= 38.0 ? 0 : t <= 39.0 ? 1 : 2);
    if (!parts.length) return null;
    const score = parts.reduce((a, x) => a + x.pts, 0);
    const single3 = parts.some((x) => x.pts === 3);
    let risk = score >= 7 ? "high" : score >= 5 ? "mid" : single3 ? "lowmid" : "low";
    return { score, parts, missing, single3, risk };
  }

  // ---- qSOFA ----
  function qsofa(v) {
    const items = [
      { label: "呼吸数 ≥22回/分", known: v.rr != null, hit: v.rr != null && v.rr >= 22 },
      { label: "収縮期血圧 ≤100mmHg", known: v.sys != null, hit: v.sys != null && v.sys <= 100 },
      { label: "意識変容（GCS<15）", known: v.consciousKnown, hit: v.altered },
    ];
    const known = items.filter((i) => i.known).length;
    if (!known) return null;
    return { score: items.filter((i) => i.hit).length, items, unknown: 3 - known };
  }

  // ---- 自動算出する指標 ----
  function indices(v, n2, qs) {
    const out = [];
    if (v.hr != null && v.sys != null) {
      const si = v.hr / v.sys;
      const level = si >= 1 ? "abn" : si >= 0.7 ? "cau" : "ok";
      let note = "0.5〜0.7が目安。1.0以上で出血・ショックを疑う";
      if (si >= 1) note = `出血量の目安 約${si >= 2 ? "2,000" : si >= 1.5 ? "1,500" : "1,000"}mL以上（外傷の場合）`;
      out.push({ key: "si", name: "ショックインデックス", value: si.toFixed(2), unit: "", level, note, src: ["jatec"] });
    }
    if (v.rSys != null && v.lSys != null) {
      const d = Math.abs(v.rSys - v.lSys);
      const level = d >= 20 ? "abn" : d >= 10 ? "cau" : "ok";
      const low = v.rSys < v.lSys ? "右" : "左";
      out.push({ key: "lr", name: "血圧左右差（収縮期）", value: d, unit: "mmHg", level, note: d >= 20 ? `${low}が低い。大動脈解離・鎖骨下動脈狭窄などを考える` : "20mmHg以上で有意な左右差", src: ["aorta"] });
    }
    if (v.sys != null && v.dia != null) {
      const map = v.dia + (v.sys - v.dia) / 3;
      const level = map < 65 ? "abn" : map < 70 ? "cau" : map > 110 ? "cau" : "ok";
      out.push({ key: "map", name: "平均血圧（MAP）", value: Math.round(map), unit: "mmHg", level, note: "65mmHg未満は臓器灌流の低下を示す", src: ["sepsis"] });
      const pp = v.sys - v.dia;
      const narrow = pp < 25 || pp < v.sys * 0.25;
      const wide = pp >= 70;
      out.push({ key: "pp", name: "脈圧", value: pp, unit: "mmHg", level: narrow || wide ? "cau" : "ok", note: narrow ? "狭小：出血・心タンポナーデ・低心拍出を考える" : wide ? "開大：大動脈弁逆流、敗血症初期、頭蓋内圧亢進などを考える" : "収縮期血圧の25%以上・70mmHg未満が目安", src: [] });
    }
    if (qs) {
      out.push({ key: "qsofa", name: "qSOFA", value: `${qs.score}/3`, unit: "", level: qs.score >= 2 ? "abn" : qs.score === 1 ? "cau" : "ok", note: `2点以上で敗血症を疑うきっかけ${qs.unknown ? `（未入力 ${qs.unknown}項目）` : ""}`, src: ["sepsis"] });
    }
    if (n2) {
      const level = n2.risk === "high" ? "abn" : n2.risk === "low" ? "ok" : "cau";
      const riskLabel = { high: "高リスク", mid: "中リスク", lowmid: "低〜中リスク（単項目3点）", low: "低リスク" }[n2.risk];
      out.push({ key: "news2", name: "NEWS2", value: n2.score, unit: "点", level, note: `${riskLabel}${n2.missing.length ? `・暫定（未入力: ${n2.missing.join("、")}）` : ""}`, src: ["news2"] });
    }
    return out;
  }

  // ---- 複数項目の組み合わせ ----
  function patterns(v, qs) {
    const out = [];
    const add = (name, level, desc, src) => out.push({ name, level, desc, src });
    if (v.hr != null && v.hr < 60 && v.sys != null && v.sys >= 160 && v.altered) {
      add("クッシング徴候", "abn", "徐脈＋高血圧＋意識低下。頭蓋内圧亢進・脳ヘルニアの切迫を考える", ["stroke"]);
    }
    if (v.sys != null && v.hr != null && ((v.sys < 90 && v.hr > 100) || v.hr / v.sys >= 1)) {
      add("ショックの徴候", "abn", "頻脈と血圧低下（またはSI≥1）。循環血液量減少・血液分布異常・心原性・閉塞性の4分類で原因を考える", ["jatec"]);
    } else if (v.hr != null && v.hr > 100 && v.sys != null && v.sys >= 90 && v.sys < 110 && !v.peds) {
      add("代償性ショックの可能性", "cau", "血圧は保たれていても頻脈が先行することがある。皮膚所見・CRT・意識を合わせて確認", ["jatec"]);
    }
    if (v.hr != null && v.hr < 50 && v.sys != null && v.sys < 90) {
      add("徐脈＋低血圧", "abn", "症候性徐脈。房室ブロック・薬剤・高カリウム血症・下壁梗塞などを考え、心電図を確認", ["jrc"]);
    }
    let sirs = 0;
    if (v.temp != null && (v.temp > 38 || v.temp < 36)) sirs++;
    if (v.hr != null && v.hr > 90) sirs++;
    if (v.rr != null && v.rr > 20) sirs++;
    const infection = (v.temp != null && (v.temp > 38 || v.temp < 36)) || v.complaints.includes("発熱") || v.complaints.includes("咳・痰");
    if (infection && ((qs && qs.score >= 2) || sirs >= 2)) {
      add("敗血症を疑うパターン", qs && qs.score >= 2 ? "abn" : "cau", "感染徴候と頻脈・頻呼吸・意識変容の組み合わせ。感染巣と臓器障害を評価", ["sepsis"]);
    }
    if (v.spo2 != null && v.spo2 < 94 && v.rr != null && v.rr >= 22) {
      add("呼吸不全のパターン", v.spo2 <= 90 ? "abn" : "cau", "低酸素と頻呼吸。呼吸仕事量の増加と、疲労による呼吸数低下に注意", ["o2"]);
    }
    if (v.rr != null && v.rr <= 10 && v.altered) {
      add("呼吸抑制＋意識低下", "abn", "オピオイド・鎮静薬中毒、CO2ナルコーシス、脳幹障害などを考える", ["news2"]);
    }
    if (v.temp != null && v.temp <= 35) add("低体温", v.temp < 32 ? "abn" : "cau", "32℃未満は致死的不整脈のリスク。体温管理と原因検索", []);
    if (v.temp != null && v.temp >= 39.5 && v.altered) add("高体温＋意識障害", "abn", "熱中症（重症）、髄膜炎・脳炎、敗血症、悪性症候群などを考える", ["sepsis"]);
    if (v.sys != null && (v.sys >= 180 || (v.dia != null && v.dia >= 120)) && !v.peds) {
      add("著しい血圧上昇", "cau", "180/120mmHg以上。臓器障害（脳・心・腎・大動脈）の症状があれば高血圧緊急症を考える", ["jsh"]);
    }
    if (v.sys != null && v.dia != null && v.sys - v.dia < 25 && v.hr != null && v.hr > 100) {
      add("脈圧狭小＋頻脈", "cau", "心拍出量の低下。出血・心タンポナーデ・緊張性気胸などを考える", ["jatec"]);
    }
    return out;
  }

  // ---- 疾患・病態の候補 ----
  // 各ルールは支持する所見・合わない所見・確認したい追加情報を返します。
  function conditionRules(ctx) {
    const { v, c, h } = ctx;
    const female = v.sex === "f";
    const age = v.age;
    const older = age != null ? age >= 50 : v.ageGroup === "elderly";
    const tachy = v.hr != null && v.hr > 100;
    const brady = v.hr != null && v.hr < 50;
    const hypoT = v.sys != null && v.sys < 90;
    const highBP = v.sys != null && v.sys >= 160;
    const lowSpO2 = v.spo2 != null && v.spo2 < 94;
    const tachyp = v.rr != null && v.rr >= 22;
    const fever = v.temp != null && v.temp >= 38;
    const hypotherm = v.temp != null && v.temp < 36;
    const si = v.hr != null && v.sys != null ? v.hr / v.sys : null;
    const lr = v.rSys != null && v.lSys != null ? Math.abs(v.rSys - v.lSys) : null;
    const pp = v.sys != null && v.dia != null ? v.sys - v.dia : null;

    return [
      {
        name: "出血性ショック・循環血液量減少",
        critical: true,
        src: ["jatec"],
        f(r) {
          if (si != null && si >= 1) r.s(3, `SI ${si.toFixed(2)}（≥1.0）`);
          if (hypoT) r.s(2, "収縮期血圧 <90mmHg");
          if (tachy) r.s(1, "頻脈");
          if (pp != null && pp < 25) r.s(1, "脈圧狭小");
          if (c("外傷")) r.s(2, "外傷");
          if (c("吐血・下血")) r.s(2, "吐血・下血");
          if (h("抗凝固薬内服")) r.s(1, "抗凝固薬内服");
          if (fever) r.a("発熱がある（敗血症も考える）");
          if (v.sys != null && v.sys >= 120 && v.hr != null && v.hr <= 90) r.a("血圧・脈拍が保たれている");
          r.n("皮膚の蒼白・冷汗、CRT", "出血源（胸腔・腹腔・骨盤・後腹膜・長管骨・外出血）", "FAST・Hb");
        },
      },
      {
        name: "敗血症・敗血症性ショック",
        critical: true,
        src: ["sepsis"],
        f(r) {
          if (v.rr != null && v.rr >= 22) r.s(1, "呼吸数 ≥22");
          if (v.sys != null && v.sys <= 100) r.s(1, "収縮期血圧 ≤100");
          if (v.altered) r.s(1, "意識変容");
          if (fever) r.s(2, `発熱 ${v.temp}℃`);
          if (hypotherm) r.s(1, "低体温");
          if (tachy) r.s(1, "頻脈");
          if (c("発熱")) r.s(2, "主訴：発熱");
          if (c("咳・痰")) r.s(1, "咳・痰（肺炎）");
          if (h("糖尿病") || h("悪性腫瘍") || h("腎疾患・透析") || h("肝疾患")) r.s(1, "易感染性の既往");
          if (v.temp != null && v.temp >= 36 && v.temp < 37.5 && v.hr != null && v.hr < 90) r.a("体温・脈拍が正常");
          if (!fever && !hypotherm && !c("発熱") && !c("咳・痰")) {
            r.a("感染を示す所見（発熱・感染症状）が未入力");
            r.score = Math.min(r.score, 1.5);
          }
          r.n("感染巣（呼吸器・尿路・腹部・皮膚軟部組織）", "乳酸値・血液培養2セット", "SOFAスコア（血小板・ビリルビン・クレアチニンなど）");
        },
      },
      {
        name: "急性冠症候群（ACS）",
        critical: true,
        src: ["acs"],
        f(r) {
          if (c("胸痛")) r.s(3, "胸痛");
          if (c("背部痛") || c("嘔吐")) r.s(1, "背部痛・嘔吐（非典型症状）");
          if (c("呼吸困難") && older) r.s(1, "高齢者の呼吸困難（非典型例）");
          if (h("狭心症・心筋梗塞")) r.s(2, "冠動脈疾患の既往");
          ["高血圧", "糖尿病", "脂質異常症", "喫煙"].forEach((k) => h(k) && r.s(1, `冠危険因子：${k}`));
          if (older || (age != null && age >= 40)) r.s(1, "40歳以上");
          if (v.sex === "m") r.s(0.5, "男性");
          if (brady) r.s(1, "徐脈（下壁梗塞）");
          if (hypoT) r.s(1, "低血圧（心原性ショック）");
          if (lr != null && lr >= 20) r.a("血圧左右差（解離を先に除外）");
          if (fever) r.a("発熱");
          if (r.score >= 3) r.n("10分以内の12誘導心電図", "トロポニン", "痛みの性状・放散痛・冷汗", "心エコー（壁運動異常）");
        },
      },
      {
        name: "急性大動脈解離",
        critical: true,
        src: ["aorta"],
        f(r) {
          if (lr != null && lr >= 20) r.s(3, `血圧左右差 ${lr}mmHg`);
          if (c("胸痛")) r.s(2, "胸痛");
          if (c("背部痛")) r.s(2, "背部痛");
          if (c("失神")) r.s(1, "失神");
          if (c("麻痺・しびれ") && (c("胸痛") || c("背部痛"))) r.s(1, "痛み＋神経症状");
          if (h("高血圧")) r.s(1, "高血圧の既往");
          if (highBP) r.s(1, "血圧上昇");
          if (hypoT && (c("胸痛") || c("背部痛"))) r.s(1, "低血圧（破裂・タンポナーデ）");
          if (lr != null && lr < 10) r.a("血圧左右差なし（ただし否定はできない）");
          if (r.score >= 2) r.n("突然発症・裂けるような痛み・痛みの移動", "四肢の血圧・脈拍の左右差", "造影CT", "Dダイマー");
        },
      },
      {
        name: "肺血栓塞栓症",
        critical: true,
        src: [],
        f(r) {
          if (c("呼吸困難")) r.s(2, "呼吸困難");
          if (c("胸痛")) r.s(1, "胸痛");
          if (c("失神")) r.s(1, "失神");
          if (tachy) r.s(1, "頻脈");
          if (lowSpO2) r.s(1, "SpO2低下");
          if (tachyp) r.s(1, "頻呼吸");
          if (hypoT) r.s(1, "低血圧（広範型）");
          if (h("悪性腫瘍")) r.s(1, "悪性腫瘍");
          if (h("妊娠中")) r.s(1, "妊娠中");
          if (fever) r.a("発熱（肺炎も考える）");
          if (r.score >= 3) r.n("下肢の腫脹・疼痛、長期臥床・術後", "Wellsスコア・Dダイマー", "心エコー（右室拡大）・造影CT");
        },
      },
      {
        name: "緊張性気胸",
        critical: true,
        src: ["jatec"],
        f(r) {
          if (c("外傷")) r.s(1, "外傷");
          if (c("呼吸困難")) r.s(1, "呼吸困難");
          if (c("胸痛")) r.s(1, "胸痛");
          if (lowSpO2) r.s(1, "SpO2低下");
          if (hypoT && (lowSpO2 || tachyp)) r.s(2, "低血圧＋呼吸障害（閉塞性ショック）");
          if (h("COPD")) r.s(0.5, "COPD（ブラ）");
          if (!c("外傷") && !c("呼吸困難") && !c("胸痛")) r.score = Math.min(r.score, 2);
          if (r.score >= 3) r.n("呼吸音の左右差・胸郭の動き", "頸静脈怒張・気管偏位・皮下気腫", "エコー（lung sliding）");
        },
      },
      {
        name: "急性心不全",
        src: [],
        f(r) {
          if (c("呼吸困難")) r.s(2, "呼吸困難");
          if (h("心不全")) r.s(2, "心不全の既往");
          if (h("狭心症・心筋梗塞") || h("心房細動・不整脈")) r.s(1, "心疾患の既往");
          if (lowSpO2) r.s(1, "SpO2低下");
          if (tachyp) r.s(1, "頻呼吸");
          if (v.sys != null && v.sys > 140) r.s(1, "血圧上昇（CS1：肺うっ血型）");
          if (hypoT) r.s(1, "低血圧（CS3：低灌流型）");
          if (v.hrRhythm === "irreg") r.s(1, "脈不整（心房細動）");
          if (fever) r.a("発熱（肺炎の合併も考える）");
          if (r.score >= 3) r.n("起座呼吸・湿性ラ音・下腿浮腫・頸静脈怒張", "胸部X線・BNP", "心エコー");
        },
      },
      {
        name: "COPD・喘息の増悪",
        src: ["o2"],
        f(r) {
          if (h("COPD")) r.s(2, "COPD");
          if (h("喘息")) r.s(2, "喘息");
          if (c("呼吸困難")) r.s(1, "呼吸困難");
          if (c("咳・痰")) r.s(1, "咳・痰");
          if (lowSpO2) r.s(1, "SpO2低下");
          if (tachyp) r.s(1, "頻呼吸");
          if (!h("COPD") && !h("喘息")) r.a("COPD・喘息の既往なし");
          if (r.score >= 3) r.n("喘鳴・呼気延長・会話可能か", "血液ガス（CO2貯留）", "COPDでは SpO2 88〜92% を目標に");
        },
      },
      {
        name: "肺炎",
        src: ["sepsis"],
        f(r) {
          if (c("咳・痰")) r.s(2, "咳・痰");
          if (c("発熱") || fever) r.s(2, "発熱");
          if (c("呼吸困難")) r.s(1, "呼吸困難");
          if (lowSpO2) r.s(1, "SpO2低下");
          if (tachyp) r.s(1, "頻呼吸");
          if (older) r.s(0.5, "高齢者（誤嚥）");
          if (r.score >= 3) r.n("呼吸音（crackles）・痰の性状", "胸部X線", "A-DROP（年齢・脱水・SpO2・意識・血圧）");
        },
      },
      {
        name: "脳卒中（脳梗塞・脳出血）",
        critical: true,
        src: ["stroke"],
        f(r) {
          if (c("麻痺・しびれ")) r.s(3, "麻痺・しびれ・構音障害");
          if (c("意識障害")) r.s(1, "意識障害");
          if (c("めまい")) r.s(1, "めまい（後方循環）");
          if (c("頭痛")) r.s(1, "頭痛");
          if (v.altered) r.s(1, "意識レベル低下");
          if (highBP) r.s(1, "血圧上昇");
          if (h("心房細動・不整脈") || v.hrRhythm === "irreg") r.s(1, "心房細動（心原性塞栓）");
          if (h("高血圧") || h("脳血管疾患")) r.s(1, "高血圧・脳血管疾患の既往");
          if (h("抗凝固薬内服")) r.s(0.5, "抗凝固薬（出血リスク）");
          if (r.score >= 2) r.n("血糖（低血糖の除外）", "発症時刻・最終健常確認時刻", "片麻痺・顔面麻痺・構音障害（CPSS・NIHSS）", "頭部CT・MRI");
        },
      },
      {
        name: "くも膜下出血",
        critical: true,
        src: ["stroke"],
        f(r) {
          if (c("頭痛")) r.s(3, "頭痛");
          if (c("嘔吐")) r.s(1, "嘔吐");
          if (c("意識障害") || v.altered) r.s(1, "意識障害");
          if (c("失神")) r.s(1, "失神");
          if (highBP) r.s(1, "血圧上昇");
          if (r.score >= 3) r.n("突然発症・人生最悪の頭痛", "項部硬直", "頭部CT（陰性でも腰椎穿刺・MRIを検討）");
        },
      },
      {
        name: "低血糖",
        critical: true,
        src: [],
        f(r) {
          if (c("意識障害") || v.altered) r.s(2, "意識障害");
          if (c("痙攣")) r.s(1, "痙攣");
          if (c("麻痺・しびれ")) r.s(0.5, "片麻痺様症状（低血糖でも起こる）");
          if (h("糖尿病")) r.s(2, "糖尿病（インスリン・SU薬）");
          if (h("肝疾患") || h("腎疾患・透析")) r.s(0.5, "肝・腎疾患");
          if (r.score >= 2) r.n("血糖測定（必ず最初に）", "冷汗・頻脈", "食事摂取と内服薬");
        },
      },
      {
        name: "アナフィラキシー",
        critical: true,
        src: ["anaphylaxis"],
        f(r) {
          if (c("皮疹・かゆみ")) r.s(3, "皮膚・粘膜症状");
          if (h("アレルギー")) r.s(1, "アレルギー歴");
          if (c("呼吸困難")) r.s(1, "呼吸困難");
          if (c("嘔吐") || c("腹痛")) r.s(0.5, "消化器症状");
          if (hypoT) r.s(2, "血圧低下");
          if (lowSpO2) r.s(1, "SpO2低下");
          if (tachy) r.s(0.5, "頻脈");
          if (!c("皮疹・かゆみ")) {
            r.a("皮膚症状の記載なし（ない例もある）");
            if (!h("アレルギー")) r.score = Math.min(r.score, 2);
          }
          if (r.score >= 3) r.n("原因物質への曝露（薬・食物・ハチ）と時間経過", "喘鳴・嗄声・口唇腫脹", "アドレナリン筋注の適応");
        },
      },
      {
        name: "不整脈（徐脈性・頻脈性）",
        src: ["jrc", "arrhythmia"],
        f(r) {
          if (v.hr != null && v.hr >= 150) r.s(3, `著しい頻脈 ${v.hr}回/分`);
          else if (v.hr != null && v.hr > 120) r.s(1, "頻脈");
          if (v.hr != null && v.hr < 40) r.s(3, `著しい徐脈 ${v.hr}回/分`);
          else if (brady) r.s(2, "徐脈");
          if (v.hrRhythm === "irreg") r.s(2, "脈の不整");
          if (c("動悸")) r.s(2, "動悸");
          if (c("失神") || c("めまい")) r.s(1, "失神・めまい");
          if (h("心房細動・不整脈")) r.s(1, "不整脈の既往");
          if (r.score >= 2) r.n("心電図（心電図評価へ）", "不安定な徴候：低血圧・意識障害・胸痛・心不全", "電解質（K・Mg）・内服薬");
        },
      },
      {
        name: "高血圧緊急症",
        src: ["jsh"],
        f(r) {
          if (v.sys != null && v.sys >= 180) r.s(2, `収縮期血圧 ${v.sys}`);
          if (v.dia != null && v.dia >= 120) r.s(2, `拡張期血圧 ${v.dia}`);
          if (r.score > 0) {
            if (c("頭痛") || c("意識障害") || v.altered) r.s(1, "神経症状（高血圧性脳症・脳卒中）");
            if (c("胸痛") || c("背部痛")) r.s(1, "胸背部痛（ACS・解離）");
            if (c("呼吸困難")) r.s(1, "呼吸困難（急性心不全）");
            r.n("臓器障害の有無（眼底・神経・心・腎）", "解離・脳卒中の除外", "妊娠の有無（子癇）");
          }
        },
      },
      {
        name: "髄膜炎・脳炎",
        critical: true,
        src: [],
        f(r) {
          if (fever) r.s(1, "発熱");
          if (c("頭痛")) r.s(1, "頭痛");
          if (c("意識障害") || v.altered) r.s(1, "意識障害");
          if (c("痙攣")) r.s(1, "痙攣");
          if (r.score >= 3 && fever) r.n("項部硬直・jolt accentuation", "血液培養後すみやかに抗菌薬", "頭部CT・腰椎穿刺");
          else if (!fever) r.score = Math.min(r.score, 1);
        },
      },
      {
        name: "腹部大動脈瘤破裂",
        critical: true,
        src: ["aorta"],
        f(r) {
          if (c("腹痛")) r.s(2, "腹痛");
          if (c("背部痛")) r.s(1, "背部・腰痛");
          if (c("失神")) r.s(1, "失神");
          if (older || (age != null && age >= 60)) r.s(1, "高齢");
          if (v.sex === "m") r.s(0.5, "男性");
          if (h("高血圧") || h("喫煙")) r.s(0.5, "高血圧・喫煙");
          if (hypoT || (si != null && si >= 1)) r.s(2, "ショック徴候");
          if (r.score >= 4) r.n("拍動性腫瘤", "腹部エコー（大動脈径）", "造影CT");
          else r.score = Math.min(r.score, 2);
        },
      },
      {
        name: "異所性妊娠破裂",
        critical: true,
        src: [],
        f(r) {
          const reproductive = female && (age == null || (age >= 12 && age <= 55));
          if (!reproductive) return;
          if (c("腹痛")) r.s(2, "女性の腹痛");
          if (c("失神")) r.s(1, "失神");
          if (hypoT || (si != null && si >= 1)) r.s(2, "ショック徴候");
          if (h("妊娠中")) r.s(1, "妊娠");
          if (r.score >= 2) r.n("最終月経・妊娠反応", "腹部エコー（腹腔内出血）");
        },
      },
      {
        name: "急性中毒・薬物",
        src: [],
        f(r) {
          if (c("意識障害") || v.altered) r.s(1, "意識障害");
          if (v.rr != null && v.rr <= 10) r.s(2, "呼吸数低下（オピオイド・鎮静薬）");
          if (v.spo2 != null && v.spo2 >= 96 && v.altered && c("頭痛")) r.s(1, "頭痛＋意識障害（CO中毒はSpO2が正常に見える）");
          if (r.score >= 2) r.n("服薬・飲酒・周囲の空き容器", "瞳孔（縮瞳・散瞳）", "トキシドローム");
        },
      },
      {
        name: "低体温症",
        src: [],
        f(r) {
          if (v.temp != null && v.temp <= 35) r.s(3, `体温 ${v.temp}℃`);
          if (brady && v.temp != null && v.temp <= 35) r.s(1, "徐脈");
          if (r.score) r.n("深部体温", "環境・溺水・外傷", "心電図（J波・不整脈）");
        },
      },
      {
        name: "熱中症",
        src: [],
        f(r) {
          if (v.temp != null && v.temp >= 38.5) r.s(1, `体温 ${v.temp}℃`);
          if (v.temp != null && v.temp >= 40) r.s(1, "40℃以上");
          if (v.temp != null && v.temp >= 38.5 && (c("意識障害") || v.altered)) r.s(1, "意識障害（重症）");
          if (c("発熱") || c("咳・痰")) r.a("感染症状がある");
          if (r.score >= 2) r.n("暑熱環境・労作の有無", "脱水・CK・腎機能", "感染症の除外");
          else r.score = 0;
        },
      },
      {
        name: "糖尿病性ケトアシドーシス・高血糖",
        src: [],
        f(r) {
          if (!h("糖尿病")) return;
          r.s(1, "糖尿病");
          if (tachyp) r.s(1, "頻呼吸（クスマウル呼吸）");
          if (tachy) r.s(0.5, "頻脈（脱水）");
          if (c("嘔吐") || c("腹痛")) r.s(1, "嘔吐・腹痛");
          if (c("意識障害") || v.altered) r.s(1, "意識障害");
          if (r.score >= 3) r.n("血糖・血液ガス（アニオンギャップ）・ケトン", "SGLT2阻害薬の内服（正常血糖DKA）");
          else r.score = Math.min(r.score, 2);
        },
      },
      {
        name: "心タンポナーデ",
        critical: true,
        src: ["jatec"],
        f(r) {
          if (pp != null && pp < 25) r.s(2, "脈圧狭小");
          if (hypoT) r.s(1, "低血圧");
          if (tachy) r.s(1, "頻脈");
          if (c("外傷") || c("胸痛")) r.s(1, "胸部外傷・胸痛（解離）");
          if (h("悪性腫瘍") || h("腎疾患・透析")) r.s(0.5, "悪性腫瘍・透析");
          if (r.score >= 3) r.n("頸静脈怒張・心音減弱（Beckの三徴）", "奇脈", "心エコー（心嚢液）");
          else r.score = Math.min(r.score, 2);
        },
      },
    ];
  }

  function conditions(v) {
    const has = (list) => (k) => list.includes(k);
    const ctx = { v, c: has(v.complaints), h: has(v.history) };
    const result = [];
    conditionRules(ctx).forEach((rule) => {
      const r = {
        score: 0,
        sup: [],
        ag: [],
        need: [],
        s(pts, text) {
          this.score += pts;
          this.sup.push(text);
        },
        a(text) {
          this.ag.push(text);
          this.score -= 0.5;
        },
        n(...items) {
          this.need.push(...items);
        },
      };
      rule.f(r);
      if (r.score >= 2.5 && r.sup.length) {
        result.push({ name: rule.name, critical: !!rule.critical, score: r.score, support: r.sup, against: r.ag, need: r.need, src: rule.src });
      }
    });
    result.sort((a, b) => b.score - a.score);
    result.forEach((r) => {
      r.fit = r.score >= 6 ? "高" : r.score >= 4 ? "中" : "低";
    });
    return result;
  }

  // ---- 主訴ごとの「見逃すと危険な疾患」(可能性が低くても必ず示す) ----
  const MUST_NOT_MISS = {
    胸痛: [["急性冠症候群", "10分以内に12誘導心電図"], ["急性大動脈解離", "血圧左右差・痛みの移動"], ["肺血栓塞栓症", "頻脈・SpO2低下・下肢腫脹"], ["緊張性気胸", "呼吸音左右差・頸静脈怒張"], ["心タンポナーデ", "Beckの三徴"], ["食道破裂", "嘔吐後の胸痛・皮下気腫"]],
    背部痛: [["急性大動脈解離", "突然発症・裂ける痛み"], ["腹部大動脈瘤破裂", "高齢・ショック徴候"], ["肺血栓塞栓症", "呼吸困難の合併"], ["急性冠症候群", "冷汗・放散痛"]],
    呼吸困難: [["上気道閉塞・アナフィラキシー", "吸気性喘鳴・皮膚症状"], ["緊張性気胸", "呼吸音左右差"], ["肺血栓塞栓症", "頻脈・下肢腫脹"], ["急性心不全・ACS", "起座呼吸・心電図"], ["敗血症", "発熱・qSOFA"]],
    意識障害: [["低血糖", "まず血糖測定"], ["脳卒中・頭蓋内出血", "麻痺・瞳孔不同"], ["敗血症・髄膜炎", "発熱・項部硬直"], ["中毒（CO含む）", "服薬・環境"], ["ショック", "血圧・SI"], ["てんかん重積", "痙攣の有無"]],
    頭痛: [["くも膜下出血", "突然発症・最悪の頭痛"], ["髄膜炎", "発熱・項部硬直"], ["脳出血", "神経症状・血圧"], ["一酸化炭素中毒", "同居者の症状・暖房器具"], ["急性緑内障発作", "眼痛・視力低下"]],
    腹痛: [["腹部大動脈瘤破裂", "高齢・ショック"], ["急性冠症候群（下壁）", "心窩部痛は心電図"], ["腸管虚血", "痛みと所見の乖離・心房細動"], ["消化管穿孔", "腹膜刺激症状"], ["異所性妊娠", "妊娠可能年齢の女性"]],
    失神: [["不整脈", "心電図・前兆の有無"], ["急性大動脈解離", "胸背部痛"], ["肺血栓塞栓症", "頻脈・SpO2"], ["出血（消化管・異所性妊娠）", "SI・便の色"], ["くも膜下出血", "頭痛"]],
    動悸: [["心室頻拍", "幅広いQRS"], ["高カリウム血症", "透析・腎疾患"], ["WPW＋心房細動", "不規則な幅広いQRS"], ["甲状腺クリーゼ・低血糖", "発熱・発汗"]],
    発熱: [["敗血症", "qSOFA・乳酸値"], ["髄膜炎", "頭痛・意識障害"], ["壊死性軟部組織感染症", "所見に比べ強い痛み"], ["発熱性好中球減少症", "化学療法中"]],
    めまい: [["小脳梗塞・小脳出血", "体幹失調・眼振"], ["不整脈", "心電図"], ["出血", "SI・便の色"]],
    痙攣: [["低血糖", "血糖測定"], ["脳卒中・頭蓋内病変", "神経症状"], ["子癇", "妊娠・血圧"], ["中毒・離脱", "服薬・飲酒"]],
    "麻痺・しびれ": [["脳卒中", "発症時刻・CPSS"], ["低血糖", "血糖測定"], ["急性大動脈解離", "胸背部痛を伴うとき"]],
    "吐血・下血": [["出血性ショック", "SI・起立性変化"], ["食道静脈瘤破裂", "肝疾患"]],
    外傷: [["出血性ショック", "SI・FAST"], ["緊張性気胸", "呼吸音左右差"], ["心タンポナーデ", "FAST（心嚢）"], ["頭部外傷", "意識・瞳孔"], ["頸髄損傷", "受傷機転・神経所見"]],
    "皮疹・かゆみ": [["アナフィラキシー", "呼吸・循環症状"]],
    嘔吐: [["急性冠症候群（下壁）", "心電図"], ["頭蓋内病変", "頭痛・神経症状"], ["DKA", "糖尿病・頻呼吸"], ["腸閉塞・腸管虚血", "腹部所見"]],
  };

  function mustNotMiss(v) {
    const seen = new Set();
    const out = [];
    v.complaints.forEach((k) => {
      (MUST_NOT_MISS[k] || []).forEach(([name, point]) => {
        if (seen.has(name)) return;
        seen.add(name);
        out.push({ name, point, from: k });
      });
    });
    return out;
  }

  // ---- 緊急度 ----
  function urgency(v, list, idx, pats, n2) {
    const high = [];
    const mid = [];
    const valueOf = (k) => list.find((x) => x.key === k);
    list.forEach((x) => {
      if (x.level === "abn") mid.push(`${x.label}が異常（${x.value}${x.unit ? " " + x.unit : ""}）`);
    });
    if (v.sys != null && v.sys <= 90 && !v.peds) high.push(`収縮期血圧 ${v.sys}mmHg（≤90）`);
    if (v.peds && valueOf("bpR") && valueOf("bpR").level === "abn" && valueOf("bpR").dir === "low") high.push("年齢に対する低血圧");
    if (v.peds && valueOf("bpL") && valueOf("bpL").level === "abn" && valueOf("bpL").dir === "low") high.push("年齢に対する低血圧");
    if (v.spo2 != null && v.spo2 <= 90 && !v.hypercapnic) high.push(`SpO2 ${v.spo2}%（≤90）`);
    if (v.spo2 != null && v.spo2 <= 85) high.push(`SpO2 ${v.spo2}%（≤85）`);
    if (v.rr != null && !v.peds && (v.rr >= 30 || v.rr <= 8)) high.push(`呼吸数 ${v.rr}回/分`);
    if (v.hr != null && !v.peds && (v.hr >= 150 || v.hr <= 40)) high.push(`HR ${v.hr}回/分`);
    if (v.peds && valueOf("hr") && valueOf("hr").level === "abn") high.push(`年齢に対する${valueOf("hr").dir === "low" ? "徐脈" : "頻脈"}`);
    if (v.peds && valueOf("rr") && valueOf("rr").level === "abn") high.push("年齢に対する呼吸数の異常");
    if ((v.gcs != null && v.gcs <= 8) || (v.jcsNum != null && v.jcsNum >= 100)) high.push("高度の意識障害（気道確保を考える）");
    if (v.temp != null && (v.temp < 32 || v.temp >= 41)) high.push(`体温 ${v.temp}℃`);
    idx.forEach((i) => {
      if (i.key === "si" && i.level === "abn") high.push(`ショックインデックス ${i.value}`);
      if (i.key === "lr" && i.level === "abn" && (v.complaints.includes("胸痛") || v.complaints.includes("背部痛"))) high.push(`胸背部痛＋血圧左右差 ${i.value}mmHg`);
      if (i.key === "lr" && i.level === "abn") mid.push(`血圧左右差 ${i.value}mmHg`);
      if (i.key === "map" && i.level === "abn") mid.push(`MAP ${i.value}mmHg（<65）`);
      if (i.key === "qsofa" && i.level === "abn") mid.push(`qSOFA ${i.value}`);
    });
    if (n2) {
      if (n2.score >= 7) high.push(`NEWS2 ${n2.score}点（≥7）`);
      else if (n2.score >= 5) mid.push(`NEWS2 ${n2.score}点（5〜6）`);
      else if (n2.single3) mid.push("NEWS2 で3点の項目がある");
    }
    pats.forEach((p) => {
      if (p.name === "クッシング徴候" || p.name === "ショックの徴候") high.push(p.name);
      else if (p.level === "abn") mid.push(p.name);
    });
    const uniq = (a) => Array.from(new Set(a));
    const anyValue = list.some((x) => x.value != null);
    if (high.length) return { level: "high", label: "緊急度 高", reasons: uniq(high.concat(mid)) };
    if (mid.length) return { level: "mid", label: "緊急度 中", reasons: uniq(mid) };
    const cau = list.filter((x) => x.level === "cau").map((x) => `${x.label}が注意域（${x.value}${x.unit ? " " + x.unit : ""}）`);
    if (cau.length >= 2) return { level: "mid", label: "緊急度 中", reasons: cau };
    if (!anyValue) return { level: "none", label: "未評価", reasons: [] };
    return { level: "low", label: "緊急度 低", reasons: cau.length ? cau : ["入力された値に大きな異常はありません"] };
  }

  // ---- 次の行動 ----
  function actions(v, urg, list, idx, pats, conds, n2) {
    const out = [];
    const seen = new Set();
    const add = (text, why, src) => {
      if (seen.has(text)) return;
      seen.add(text);
      out.push({ text, why, src: src || [] });
    };
    const lv = (k) => (list.find((x) => x.key === k) || {}).level;
    const idv = (k) => idx.find((x) => x.key === k);
    if (urg.level === "high") add("医師・リーダーへすぐ報告し、応援を要請する", "緊急度が高い", []);
    if ((v.gcs != null && v.gcs <= 8) || (v.jcsNum != null && v.jcsNum >= 100)) add("気道を評価し、気道確保・誤嚥防止の体位を考える", "GCS 8以下・JCS 3桁", ["jcs"]);
    if (v.spo2 != null && v.spo2 < 94 && !v.hypercapnic) add("酸素投与を開始・調整し、SpO2 94〜98%を目標にする", `SpO2 ${v.spo2}%`, ["o2"]);
    if (v.hypercapnic && v.spo2 != null && (v.spo2 < 88 || (v.spo2 > 92 && v.o2 === "o2"))) add("SpO2 88〜92%を目標に酸素を調整し、血液ガスでCO2を確認", "高CO2血症のリスク", ["o2"]);
    if (lv("spo2") === "abn" || (v.rr != null && v.rr >= 25)) add("呼吸音・呼吸様式・補助呼吸筋の使用を確認する", "呼吸の異常", ["o2"]);
    if ((idv("si") && idv("si").level === "abn") || (v.sys != null && v.sys < 90)) {
      add("太い静脈路を確保し、輸液の準備をする（量は医師の指示・プロトコルに従う）", "ショックの徴候", ["jatec"]);
      add("皮膚の色・冷汗・CRT・尿量で循環を評価する", "ショックの徴候", ["jatec"]);
    }
    if (idv("lr") && idv("lr").level !== "ok") add("四肢の血圧・脈拍を測定し、大動脈解離を念頭に造影CTを検討する", `血圧左右差 ${idv("lr").value}mmHg`, ["aorta"]);
    if (v.complaints.includes("胸痛") || conds.some((c) => c.name.includes("ACS") && c.score >= 3)) add("12誘導心電図を記録する（来院10分以内が目標）", "胸痛", ["acs"]);
    if ((v.hr != null && (v.hr < 50 || v.hr >= 130)) || v.hrRhythm === "irreg") add("心電図モニターを装着し、波形を確認する（心電図評価へ）", "脈拍の異常・不整", ["jrc"]);
    if (v.complaints.includes("意識障害") || v.altered || v.complaints.includes("痙攣")) add("血糖を測定する", "意識障害では低血糖をまず除外", []);
    if (v.altered || v.complaints.includes("麻痺・しびれ")) add("瞳孔・麻痺の有無を確認し、発症時刻（最終健常時刻）を聴取する", "神経症状", ["stroke"]);
    if (pats.some((p) => p.name === "クッシング徴候")) add("頭部CTを急ぎ、脳神経外科へ連絡する", "クッシング徴候", ["stroke"]);
    if (pats.some((p) => p.name.startsWith("敗血症"))) {
      add("乳酸値・血液培養2セットを提出し、感染巣を検索する", "敗血症の疑い", ["sepsis"]);
      add("敗血症と判断したら、できるだけ早く（1時間以内を目安に）抗菌薬投与を開始する", "敗血症の疑い", ["sepsis"]);
    }
    if (conds.some((c) => c.name === "アナフィラキシー" && c.score >= 4)) add("アドレナリン筋注の適応を確認し、原因物質を除去する", "アナフィラキシーの疑い", ["anaphylaxis"]);
    if (v.temp != null && v.temp <= 35) add("保温（加温）し、深部体温と心電図を確認する", "低体温", []);
    if (v.temp != null && v.temp >= 39.5 && v.altered) add("冷却を開始し、熱中症と中枢神経感染症を鑑別する", "高体温＋意識障害", []);
    if (v.rSys != null && v.lSys == null && (v.complaints.includes("胸痛") || v.complaints.includes("背部痛"))) add("左の血圧も測定し、左右差を確認する", "胸背部痛で片側のみ測定", ["aorta"]);
    if (pats.some((p) => p.name === "著しい血圧上昇")) add("臓器障害の症状（頭痛・意識・胸痛・呼吸困難）を確認する", "著しい血圧上昇", ["jsh"]);

    // 未入力の重要項目
    const missing = [];
    if (v.hr == null) missing.push("HR");
    if (v.sys == null) missing.push("血圧");
    if (v.spo2 == null) missing.push("SpO2");
    if (v.rr == null) missing.push("呼吸数");
    if (!v.consciousKnown) missing.push("意識レベル");
    if (v.temp == null) missing.push("体温");
    if (missing.length && missing.length < 6) add(`未測定の項目を測る：${missing.join("・")}`, "評価の精度を上げるため", []);

    // 再測定のタイミング(NEWS2 の観察頻度)
    let remeasure;
    if (urg.level === "high" || (n2 && n2.score >= 7)) remeasure = "連続モニタリング（少なくとも5〜15分ごと）";
    else if (urg.level === "mid" || (n2 && (n2.score >= 5 || n2.single3))) remeasure = "少なくとも1時間ごと（処置後は15〜30分で再評価）";
    else if (n2 && n2.score >= 1) remeasure = "4〜6時間ごと";
    else if (urg.level === "low") remeasure = "状態に応じて（NEWS2 0点なら12時間ごとが目安）";
    return { list: out, remeasure };
  }

  function assess(raw) {
    const { v, checks } = normalize(raw || {});
    const list = vitals(v);
    const n2 = news2(v);
    const qs = qsofa(v);
    const idx = indices(v, n2, qs);
    const pats = patterns(v, qs);
    const conds = conditions(v);
    const urg = urgency(v, list, idx, pats, n2);
    const act = actions(v, urg, list, idx, pats, conds, n2);
    const notes = [];
    if (raw && raw.age == null && !raw.ageGroup) notes.push("年齢が未入力のため、成人の基準で判定しています。");
    if (v.peds) notes.push(`${BANDS[v.band].label}の正常値で判定しています。NEWS2は成人（16歳以上）向けのため算出していません。`);
    if (v.rSys != null && v.lSys != null) notes.push("左右の血圧のうち、収縮期血圧が高い側を代表値として指標を計算しています。");
    return {
      input: v,
      band: BANDS[v.band].label,
      checks,
      notes,
      vitals: list,
      indices: idx,
      news2: n2,
      qsofa: qs,
      patterns: pats,
      urgency: urg,
      conditions: conds,
      mustNotMiss: mustNotMiss(v).filter((m) => !conds.some((c) => c.name.includes(m.name))),
      actions: act.list,
      remeasure: act.remeasure,
    };
  }

  const api = { assess, COMPLAINTS, HISTORY, JCS_VALUES, BANDS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.VAVital = api;
})(typeof window !== "undefined" ? window : globalThis);
