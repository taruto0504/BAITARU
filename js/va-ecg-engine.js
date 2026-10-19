(function (root) {
  "use strict";

  // ===== 心電図評価のルール判定と、見本・クイズ用の波形 =====
  // 判定は利用者が確認・計測した所見(心拍数、リズム、P波、PR、QRS、QT、ST)から行います。

  const LEADS = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"];
  const REGIONS = [
    { name: "下壁", leads: ["II", "III", "aVF"], artery: "右冠動脈（または回旋枝）", extra: "右側胸部誘導（V4R）で右室梗塞を確認" },
    { name: "前壁中隔", leads: ["V1", "V2", "V3", "V4"], artery: "左前下行枝", extra: "" },
    { name: "側壁", leads: ["I", "aVL", "V5", "V6"], artery: "回旋枝・対角枝", extra: "" },
  ];

  function num(x) {
    if (x === null || x === undefined || x === "") return null;
    const n = parseFloat(x);
    return isFinite(n) ? n : null;
  }

  function qtc(qt, hr) {
    if (qt == null || hr == null || hr <= 0) return null;
    const rr = 60 / hr;
    return { bazett: Math.round(qt / Math.sqrt(rr)), fridericia: Math.round(qt / Math.cbrt(rr)) };
  }

  function measurements(f) {
    const out = [];
    const add = (label, value, unit, level, normal) => out.push({ label, value, unit, level, normal });
    if (f.hr != null) add("心拍数", f.hr, "回/分", f.hr < 50 || f.hr > 120 ? "abn" : f.hr < 60 || f.hr > 100 ? "cau" : "ok", "60〜100");
    if (f.pr != null) add("PR間隔", f.pr, "ms", f.pr > 200 ? "cau" : f.pr < 120 ? "cau" : "ok", "120〜200");
    if (f.qrs != null) add("QRS幅", f.qrs, "ms", f.qrs >= 120 ? "abn" : f.qrs >= 110 ? "cau" : "ok", "120未満");
    if (f.qt != null) add("QT間隔", f.qt, "ms", null, "心拍数で補正して判定");
    const q = qtc(f.qt, f.hr);
    if (q) {
      const limit = f.sex === "m" ? 450 : 460;
      const lv = q.bazett >= 500 ? "abn" : q.bazett >= limit || q.bazett < 350 ? "cau" : "ok";
      add("QTc（Bazett）", q.bazett, "ms", lv, `男性450・女性460未満`);
      add("QTc（Fridericia）", q.fridericia, "ms", q.fridericia >= 500 ? "abn" : q.fridericia >= limit ? "cau" : "ok", "頻脈・徐脈ではこちらが正確");
    }
    return { list: out, qtc: q };
  }

  function evaluate(raw) {
    const f = Object.assign({}, raw);
    ["hr", "pr", "qrs", "qt", "age"].forEach((k) => {
      f[k] = num(raw[k]);
    });
    f.stUp = raw.stUp || [];
    f.stDown = raw.stDown || [];
    f.flags = raw.flags || "";
    f.ectopic = raw.ectopic || "";
    const flag = (k) => f.flags.includes(k);
    const wide = f.qrsShape === "wide" || f.qrsShape === "lbbb" || f.qrsShape === "rbbb" || (f.qrs != null && f.qrs >= 120);
    const narrow = f.qrsShape === "normal" || (f.qrs != null && f.qrs < 120 && !["wide", "lbbb", "rbbb", "delta", "polymorph", "chaotic", "flat"].includes(f.qrsShape));
    const hr = f.hr;
    const meas = measurements(f);
    const qtLong = meas.qtc && meas.qtc.bazett >= (f.sex === "m" ? 450 : 460);

    const cands = [];
    const add = (o) => {
      if (o.score > 0) cands.push(o);
    };
    const R = (name, kind, urgency, src, actions) => ({ name, kind, urgency, src, actions, score: 0, reasons: [], s(p, t) { this.score += p; if (t) this.reasons.push(t); } });

    // ---- 心停止のリズム ----
    let r = R("心室細動（VF）", "rhythm", "arrest", ["jrc"], ["ただちに胸骨圧迫を開始し、除細動（電気ショック）を行う", "2分ごとにリズムと脈拍を確認する", "薬剤（アドレナリン・抗不整脈薬）は施設プロトコルに従う"]);
    if (f.qrsShape === "chaotic") r.s(6, "形の定まらない不規則な波形");
    if (r.score && f.pulse === "no") r.s(2, "脈拍なし");
    if (r.score && flag("noise")) r.s(-3, "体動・ノイズがあり、アーチファクトの可能性");
    add(r);

    r = R("心静止", "rhythm", "arrest", ["jrc"], ["ただちに胸骨圧迫を開始し、アドレナリン投与を早期に行う", "誘導・電極・感度を確認し、細かい心室細動の見落としを防ぐ", "可逆的な原因（4H4T）を検索する"]);
    if (f.qrsShape === "flat") r.s(6, "平坦な波形");
    if (r.score && f.pulse === "no") r.s(1, "脈拍なし");
    add(r);

    const organized = !["chaotic", "flat"].includes(f.qrsShape);
    r = R("無脈性電気活動（PEA）", "rhythm", "arrest", ["jrc"], ["ただちに胸骨圧迫を開始し、アドレナリン投与を早期に行う", "可逆的な原因（4H4T：低酸素・循環血液量減少・高/低K・低体温・緊張性気胸・タンポナーデ・血栓・中毒）を検索する"]);
    if (f.pulse === "no" && organized && !(wide && hr != null && hr >= 120)) r.s(7, "波形があるのに脈拍が触れない");
    add(r);

    // ---- 心室性 ----
    r = R(f.pulse === "no" ? "無脈性心室頻拍" : "心室頻拍（単形性）", "rhythm", f.pulse === "no" ? "arrest" : "high", ["jrc", "arrhythmia"],
      f.pulse === "no"
        ? ["ただちに胸骨圧迫を開始し、除細動（電気ショック）を行う", "2分ごとにリズムと脈拍を確認する"]
        : ["不安定な徴候（低血圧・意識障害・胸痛・心不全）を確認する", "不安定なら同期電気ショックを準備する", "安定していれば12誘導心電図を記録し、専門医に相談する"]);
    if (wide && f.qrsShape !== "polymorph" && hr != null && hr >= 100 && f.regularity !== "irregirreg") {
      r.s(4, `幅の広いQRSの頻拍（${hr}回/分）`);
      if (hr >= 150) r.s(1, "150回/分以上");
      if (f.p === "none" || f.av === "dissoc") r.s(1, "P波が見えない・房室解離");
      if (f.qrsShape === "lbbb" || f.qrsShape === "rbbb") r.s(-1, "脚ブロック型（変行伝導を伴う上室頻拍の可能性も）");
      r.reasons.push("幅の広いQRSの頻拍は、否定できるまで心室頻拍として扱う");
    }
    add(r);

    r = R(qtLong ? "トルサード・ド・ポアント" : "多形性心室頻拍", "rhythm", f.pulse === "no" ? "arrest" : "high", ["jrc", "arrhythmia"],
      ["脈拍がなければ除細動を行う", qtLong ? "マグネシウム投与を検討し、QTを延長させる薬剤を中止する" : "虚血（急性冠症候群）を評価する", "電解質（K・Mg）を確認する"]);
    if (f.qrsShape === "polymorph") {
      r.s(5, "QRSの形・向きが拍ごとに変わる");
      if (qtLong) r.s(1, "QT延長");
    }
    add(r);

    r = R("心室固有調律（補充調律）", "rhythm", "high", ["jrc"], ["脈拍と血圧を確認する（PEAではないか）", "経皮ペーシングの準備を検討する"]);
    if (wide && hr != null && hr < 100 && (f.p === "none" || f.av === "dissoc") && f.regularity === "reg" && f.qrsShape !== "polymorph") r.s(4, `幅の広いQRSが規則的に${hr}回/分`);
    add(r);

    // ---- 上室性 ----
    r = R("心房細動", "rhythm", hr != null && hr >= 150 ? "high" : "mid", ["arrhythmia"], ["発症時期（48時間以内か）と血行動態を確認する", "心拍数の調節と、抗凝固療法の適応を評価する", "不安定なら同期電気ショックを準備する"]);
    if (f.regularity === "irregirreg") r.s(3, "RR間隔が完全に不規則");
    if (f.p === "fib") r.s(3, "基線に細動波（f波）");
    else if (f.p === "none" && r.score) r.s(2, "明らかなP波がない");
    if (f.flags.includes("delta") || f.qrsShape === "delta") r.s(-2, "");
    add(r);

    r = R("WPW症候群＋心房細動（偽性心室頻拍）", "rhythm", "high", ["arrhythmia"], ["房室結節を抑える薬（ベラパミル・ジルチアゼム・ジゴキシン・ATPなど）は避ける", "不安定なら同期電気ショックを準備する", "専門医へすぐ相談する"]);
    if (f.regularity === "irregirreg" && (f.qrsShape === "delta" || (wide && hr != null && hr >= 150))) {
      r.s(5, "不規則な幅広いQRSの頻拍");
      if (f.qrsShape === "delta") r.s(1, "デルタ波");
    }
    add(r);

    r = R("心房粗動", "rhythm", hr != null && hr >= 150 ? "high" : "mid", ["arrhythmia"], ["伝導比（2:1・4:1）と血行動態を確認する", "心拍数の調節・抗凝固の適応を評価する", "不安定なら同期電気ショックを準備する"]);
    if (f.p === "flutter") r.s(5, "鋸歯状の粗動波（F波）");
    if (r.score && hr != null && hr >= 140 && hr <= 160 && f.regularity === "reg") r.s(1, "心拍数150前後で規則的（2:1伝導）");
    if (!r.score && hr != null && hr >= 145 && hr <= 155 && f.regularity === "reg" && narrow && f.p !== "normal") r.s(2, "心拍数150前後の規則的な頻拍（2:1の粗動を見落とさない）");
    add(r);

    r = R("発作性上室頻拍（PSVT）", "rhythm", "mid", ["arrhythmia"], ["血行動態を確認し、安定していれば迷走神経刺激（修正バルサルバ法）を試す", "ATP（アデノシン）投与を検討する（医師の指示）", "不安定なら同期電気ショックを準備する"]);
    if (hr != null && hr >= 150 && f.regularity === "reg" && narrow) {
      r.s(3, `幅の狭いQRSの規則的な頻拍（${hr}回/分）`);
      if (f.p === "none" || f.p === "retro") r.s(2, "P波が見えない・QRSの後ろにある");
      if (f.p === "normal") r.s(-2, "洞性P波がある（洞性頻脈も考える）");
    }
    add(r);

    r = R("房室接合部調律", "rhythm", "mid", ["arrhythmia"], ["薬剤（ジギタリス・β遮断薬など）と電解質を確認する", "症状と血行動態を確認する"]);
    if (narrow && f.regularity === "reg" && (f.p === "none" || f.p === "retro") && hr != null && hr >= 35 && hr < 100) r.s(4, `幅の狭いQRSが規則的に${hr}回/分で、洞性P波がない`);
    add(r);

    // ---- 洞調律 ----
    const sinusP = f.p === "normal";
    r = R("正常洞調律", "rhythm", "low", ["ecgnorm"], ["ほかの所見（ST変化・QT・伝導異常）と臨床症状をあわせて評価する"]);
    if (sinusP && f.regularity === "reg" && hr != null && hr >= 60 && hr <= 100) {
      r.s(5, "各QRSの前に同じ形のP波、規則的、60〜100回/分");
      if (f.pr != null && (f.pr < 120 || f.pr > 200)) r.s(-1, "PR間隔が正常範囲外");
    }
    add(r);

    r = R("洞性頻脈", "rhythm", "mid", ["ecgnorm"], ["原因（発熱・脱水・出血・疼痛・低酸素・肺塞栓・甲状腺など）を探す", "リズムそのものの治療は通常不要"]);
    if (sinusP && hr != null && hr > 100) {
      r.s(4, `洞性P波を伴う${hr}回/分の頻拍`);
      const max = f.age != null ? 220 - f.age : 180;
      if (hr > max) r.s(-2, "年齢の最大心拍数を超える（ほかの頻拍を考える）");
    }
    add(r);

    r = R("洞性徐脈", "rhythm", hr != null && hr < 40 ? "high" : "low", ["jrc"], ["症状（失神・めまい・低血圧）を確認する", "薬剤（β遮断薬・Ca拮抗薬など）・低体温・甲状腺機能・下壁梗塞を確認する", "不安定ならアトロピン・経皮ペーシングを準備する（医師の指示）"]);
    if (sinusP && hr != null && hr < 60 && f.av !== "drop" && f.av !== "prolonging") r.s(4, `洞性P波を伴う${hr}回/分の徐脈`);
    add(r);

    r = R("洞不整脈", "rhythm", "low", ["ecgnorm"], ["呼吸性の変動なら治療は不要"]);
    if (sinusP && f.regularity === "irreg" && f.av !== "drop" && f.av !== "prolonging" && !f.ectopic) r.s(4, "洞性P波で、RR間隔が周期的に変動");
    add(r);

    // ---- 房室ブロック ----
    r = R("1度房室ブロック", "rhythm", "low", ["arrhythmia"], ["薬剤（β遮断薬・ジギタリスなど）を確認し、経過を見る"]);
    if (f.pr != null && f.pr > 200 && f.av !== "drop" && f.av !== "prolonging" && f.av !== "dissoc") r.s(4, `PR間隔 ${f.pr}ms（>200ms）で一定`);
    add(r);

    r = R("2度房室ブロック（ウェンケバッハ型）", "rhythm", "mid", ["arrhythmia"], ["症状と血行動態を確認する", "下壁梗塞・薬剤の影響を確認する"]);
    if (f.av === "prolonging") r.s(5, "PR間隔が徐々に延長し、QRSが脱落する");
    add(r);

    r = R("2度房室ブロック（モビッツII型）", "rhythm", "high", ["jrc", "arrhythmia"], ["完全房室ブロックへ進行しうるため、経皮ペーシングを準備する", "アトロピンは効きにくいことがある", "循環器内科へ相談する"]);
    if (f.av === "drop") {
      r.s(5, "PR間隔は一定のまま、突然QRSが脱落する");
      if (wide) r.s(1, "幅の広いQRS（His束以下の障害）");
    }
    add(r);

    r = R("完全房室ブロック（3度）", "rhythm", "high", ["jrc", "arrhythmia"], ["経皮ペーシングを準備し、循環器内科へ連絡する", "アトロピンは効きにくいことが多い", "下壁梗塞・高カリウム血症・薬剤を確認する"]);
    if (f.av === "dissoc") {
      r.s(5, "P波とQRSが無関係（房室解離）");
      if (f.p === "more") r.s(1, "P波がQRSより多い");
      if (hr != null && hr < 50) r.s(1, `補充調律 ${hr}回/分`);
    }
    add(r);

    r = R("高度房室ブロック", "rhythm", "high", ["jrc", "arrhythmia"], ["経皮ペーシングを準備し、循環器内科へ連絡する"]);
    if (f.p === "more" && f.av !== "dissoc" && f.av !== "prolonging" && (hr == null || hr < 50)) r.s(4, "P波がQRSより多く、2拍以上続けて伝導しない");
    add(r);

    // ---- そのほかの所見(リズム以外) ----
    if (f.ectopic.includes("pvc")) {
      r = R("心室期外収縮", "finding", "low", ["arrhythmia"], ["多発・連発・R on T・多形性なら、虚血と電解質（K・Mg）を確認する"]);
      r.s(3, "早期に出現する幅の広いQRS");
      add(r);
    }
    if (f.ectopic.includes("pac")) {
      r = R("上室期外収縮", "finding", "low", ["arrhythmia"], ["通常は経過観察。頻発する場合は誘因（カフェイン・飲酒・甲状腺）を確認する"]);
      r.s(3, "早期に出現する形の異なるP波と、幅の狭いQRS");
      add(r);
    }
    if (f.qrsShape === "rbbb") {
      r = R(f.qrs != null && f.qrs < 120 ? "不完全右脚ブロック" : "完全右脚ブロック", "finding", "low", ["ecgnorm"], ["新規で胸痛・呼吸困難を伴う場合は、肺塞栓・虚血を考える"]);
      r.s(3, "V1でrsR'型、I・V6で幅広いS波");
      add(r);
    }
    if (f.qrsShape === "lbbb") {
      r = R("完全左脚ブロック", "finding", "mid", ["acs", "ecgnorm"], ["新規の左脚ブロックで胸痛がある場合はACSとして扱う（Sgarbossa基準でSTを評価）"]);
      r.s(3, "V1で深いS波、I・V6で幅広い結節性R波");
      add(r);
    }
    if (f.qrsShape === "delta") {
      r = R("WPW症候群（早期興奮）", "finding", "mid", ["arrhythmia"], ["頻拍発作・失神の既往を確認し、専門医へ紹介する"]);
      r.s(3, "デルタ波");
      if (f.pr != null && f.pr < 120) r.s(1, `PR短縮 ${f.pr}ms`);
      add(r);
    }

    // ST変化と梗塞部位
    const up = new Set(f.stUp);
    const down = new Set(f.stDown);
    const stemiRegions = REGIONS.filter((g) => g.leads.filter((l) => up.has(l)).length >= 2);
    if (stemiRegions.length) {
      r = R(`ST上昇（${stemiRegions.map((g) => g.name).join("・")}）：急性心筋梗塞を疑う`, "finding", "high", ["acs"], [
        "循環器内科へすぐ連絡し、PCI可能な施設への搬送・準備を行う",
        "発症時刻・胸痛の性状を確認し、トロポニンを測定する",
        ...stemiRegions.filter((g) => g.extra).map((g) => g.extra),
        "左脚ブロック・心室ペーシング・早期再分極・心膜炎などとの鑑別も行う",
      ]);
      stemiRegions.forEach((g) => r.s(4, `${g.leads.filter((l) => up.has(l)).join("・")}でST上昇 → ${g.name}（${g.artery}）`));
      const recip = [];
      if (stemiRegions.some((g) => g.name === "下壁") && (down.has("I") || down.has("aVL"))) recip.push("I・aVLの鏡像変化");
      if (stemiRegions.some((g) => g.name !== "下壁") && ["II", "III", "aVF"].some((l) => down.has(l))) recip.push("下壁誘導の鏡像変化");
      if (recip.length) r.s(1, `${recip.join("・")}（梗塞を支持）`);
      add(r);
    }
    if (["V1", "V2", "V3"].filter((l) => down.has(l)).length >= 2 && !["V1", "V2", "V3"].some((l) => up.has(l))) {
      r = R("後壁梗塞の疑い（V1〜V3のST低下）", "finding", "high", ["acs"], ["背側誘導（V7〜V9）でST上昇を確認する"]);
      r.s(3, "V1〜V3のST低下（後壁の鏡像変化の可能性）");
      add(r);
    }
    if (up.has("aVR") && down.size >= 6) {
      r = R("左主幹部病変・多枝病変の疑い", "finding", "high", ["acs"], ["循環器内科へすぐ連絡する", "広範な心内膜下虚血として扱う"]);
      r.s(4, "aVRのST上昇＋広範なST低下");
      add(r);
    } else if (down.size >= 2 && !stemiRegions.length) {
      r = R("ST低下（虚血の可能性）", "finding", "mid", ["acs"], ["症状と経時変化を確認し、トロポニンを測定する", "ジギタリス・左室肥大・脚ブロックによる変化と区別する"]);
      r.s(2, `${Array.from(down).join("・")}でST低下`);
      add(r);
    }
    if (up.size && !stemiRegions.length && !up.has("aVR")) {
      r = R("ST上昇（1誘導のみ・連続しない）", "finding", "mid", ["acs"], ["隣接する誘導を確認し、経時的に記録を繰り返す"]);
      r.s(1, `${Array.from(up).join("・")}でST上昇`);
      add(r);
    }
    if (flag("qwave")) {
      r = R("異常Q波", "finding", "mid", ["acs"], ["陳旧性心筋梗塞か、進行中の梗塞かを症状と過去の心電図で確認する"]);
      r.s(2, "幅0.04秒以上またはR波の1/4以上のQ波");
      add(r);
    }
    if (flag("peakedT")) {
      r = R("高カリウム血症を疑う変化", "finding", "high", [], ["血清カリウムを至急測定する", "モニターを継続する。治療（カルシウム製剤など）は医師の指示に従う", "腎不全・透析・薬剤（ACE阻害薬・K保持性利尿薬）を確認する"]);
      r.s(3, "テント状T波");
      if (wide) r.s(1, "QRS幅の拡大");
      if (hr != null && hr < 50) r.s(1, "徐脈");
      add(r);
    }
    if (meas.qtc && qtLong) {
      r = R("QT延長", "finding", meas.qtc.bazett >= 500 ? "high" : "mid", ["ecgnorm"], ["QTを延長させる薬剤（抗不整脈薬・抗精神病薬・マクロライドなど）を確認する", "電解質（K・Mg・Ca）を確認する", "QTc 500ms以上はトルサード・ド・ポアントのリスクが高い"]);
      r.s(3, `QTc ${meas.qtc.bazett}ms（Bazett）`);
      add(r);
    }
    if (flag("brugada")) {
      r = R("ブルガダ型心電図", "finding", "mid", ["arrhythmia"], ["失神・突然死の家族歴を確認し、専門医へ紹介する", "発熱で顕在化することがあるため、解熱を図る"]);
      r.s(3, "V1〜V2のcoved型ST上昇");
      add(r);
    }
    if (flag("pacing")) {
      r = R("ペースメーカー調律", "finding", "low", [], ["スパイクの後に必ずQRSが続くか（捕捉不全）、自己心拍を感知しているか（感知不全）を確認する"]);
      r.s(3, "ペーシングスパイク");
      add(r);
    }

    const rhythms = cands.filter((c) => c.kind === "rhythm" && c.score >= 2).sort((a, b) => b.score - a.score).slice(0, 3);
    const findings = cands.filter((c) => c.kind === "finding" && c.score >= 1).sort((a, b) => b.score - a.score);
    rhythms.forEach((c, i) => {
      const lead = i === 0 && (rhythms.length === 1 || c.score - rhythms[1].score >= 2);
      c.fit = c.score >= 6 || (lead && c.score >= 4) ? "高" : c.score >= 4 ? "中" : "低";
    });

    const order = { arrest: 3, high: 2, mid: 1, low: 0 };
    const all = rhythms.slice(0, 1).concat(findings);
    let level = all.reduce((m, c) => (order[c.urgency] > order[m] ? c.urgency : m), "low");
    if (hr != null && (hr < 40 || hr >= 150) && order[level] < 2) level = "high";
    const enough = hr != null || f.regularity || f.p || f.qrsShape || f.pulse === "no" || f.stUp.length || f.stDown.length || f.flags || f.ectopic || f.av;
    const arrest = rhythms.length && rhythms[0].urgency === "arrest";
    const unclear = rhythms.length >= 2 && rhythms[0].score - rhythms[1].score < 1;
    return {
      input: f,
      measurements: meas.list,
      rhythms,
      findings,
      urgency: enough ? level : "none",
      arrest: !!arrest,
      unclear,
      warnings: [
        arrest || f.qrsShape === "chaotic" || f.qrsShape === "flat" ? "まず患者の反応・呼吸・脈拍を確認してください。体動や電極外れのノイズは心室細動・心静止に似て見えます。" : null,
        flag("noise") ? "体動・筋電図・交流ノイズがあると、判定の信頼性が下がります。可能なら記録をやり直してください。" : null,
      ].filter(Boolean),
    };
  }

  // ===== 見本・クイズ用の合成波形 =====
  // 実際の心電図ではなく、波形の特徴を学ぶための合成波形です。
  // 毎回、心拍数・振幅・基線の揺れを乱数で変えます。
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const g = (t, mu, sd, a) => a * Math.exp(-((t - mu) * (t - mu)) / (2 * sd * sd));

  // 1拍ぶんの波形(QRSの中心 c を基準にした時刻 t の電位 mV)
  // o: { pr, p, qrs, t, tAt, tSd, st, amp }
  function beatFn(c, o) {
    const a = o.amp || 1;
    const pr = o.pr;
    const p = o.p == null ? 0.15 : o.p;
    const tAmp = o.t == null ? 0.3 : o.t;
    const tAt = o.tAt || 0.27;
    const tSd = o.tSd || 0.045;
    const st = o.st || 0;
    return (t) => {
      const d = t - c;
      if (d < -0.5 || d > 0.8) return 0;
      let y = 0;
      if (pr) y += g(d, -pr, 0.022, p);
      switch (o.qrs || "narrow") {
        case "narrow":
          y += g(d, -0.026, 0.008, -0.12) + g(d, 0, 0.01, 1.1) + g(d, 0.024, 0.009, -0.3);
          break;
        case "slightlyWide":
          y += g(d, -0.03, 0.012, -0.1) + g(d, 0, 0.018, 0.9) + g(d, 0.04, 0.016, -0.35);
          break;
        case "wide":
          y += g(d, 0, 0.032, 1.0) + g(d, 0.075, 0.03, -0.55);
          break;
        case "wideNeg":
          y += g(d, 0, 0.03, -0.9) + g(d, 0.07, 0.03, 0.45);
          break;
        case "rbbb":
          y += g(d, -0.035, 0.01, 0.35) + g(d, -0.005, 0.012, -0.45) + g(d, 0.045, 0.016, 0.95);
          break;
        case "lbbb":
          y += g(d, -0.045, 0.01, 0.12) + g(d, 0.02, 0.04, -1.3);
          break;
        case "delta":
          y += g(d, -0.045, 0.028, 0.32) + g(d, 0, 0.012, 0.85) + g(d, 0.03, 0.01, -0.2);
          break;
        case "qwave":
          y += g(d, -0.03, 0.016, -0.5) + g(d, 0.008, 0.01, 0.55) + g(d, 0.03, 0.009, -0.12);
          break;
        case "paced":
          y += g(d, -0.06, 0.005, 1.1) + g(d, 0, 0.034, 0.95) + g(d, 0.08, 0.03, -0.5);
          break;
        case "brugada":
          y += g(d, -0.02, 0.01, 0.3) + g(d, 0.01, 0.012, -0.35) + g(d, 0.05, 0.025, 0.55) + g(d, 0.12, 0.05, 0.28);
          break;
      }
      if (st) y += g(d, 0.12, 0.055, st) + g(d, 0.06, 0.03, st * 0.6);
      y += g(d, tAt, tSd, tAmp);
      return y * a;
    };
  }

  // 波形の一覧。group は選択肢の作り方(同じ仲間から紛らわしい選択肢を出す)に使う。
  const WAVES = {
    nsr: {
      label: "正常洞調律", group: "sinus", lead: "II",
      explain: "各QRSの前に同じ形のP波があり、RR間隔は一定。心拍数60〜100回/分、PR 0.12〜0.20秒、QRS 0.12秒未満。",
      causes: ["正常"], risk: "low", riskText: "正常の調律。ほかの所見と症状をあわせて評価する。",
    },
    stach: {
      label: "洞性頻脈", group: "sinus", lead: "II",
      explain: "洞性P波を伴う規則的な頻拍（100回/分超）。P波が先行するのが上室頻拍との違い。",
      causes: ["発熱・感染症", "脱水・出血（循環血液量減少）", "疼痛・不安", "低酸素", "肺血栓塞栓症", "甲状腺機能亢進症", "貧血", "薬剤（β刺激薬・カフェインなど）"],
      risk: "mid", riskText: "リズム自体の危険は低いが、背景にショックや肺塞栓などが隠れていることがある。原因の検索が大切。",
    },
    sbrady: {
      label: "洞性徐脈", group: "sinus", lead: "II",
      explain: "洞性P波を伴う規則的な徐脈（60回/分未満）。PRは一定。",
      causes: ["スポーツ心臓・睡眠中（生理的）", "薬剤（β遮断薬・Ca拮抗薬・ジギタリス）", "下壁梗塞", "洞不全症候群", "甲状腺機能低下症", "低体温", "頭蓋内圧亢進"],
      risk: "low", riskText: "症状（失神・低血圧）がなければ経過観察が多い。症候性なら治療が必要。",
    },
    sarr: {
      label: "洞不整脈", group: "sinus", lead: "II",
      explain: "洞性P波で、RR間隔が呼吸に合わせて周期的に変動する（吸気で速く、呼気で遅く）。",
      causes: ["呼吸性（生理的、若年者に多い）"], risk: "low", riskText: "生理的なことがほとんどで、治療は不要。",
    },
    af: {
      label: "心房細動", group: "supra", lead: "II",
      explain: "P波がなく基線が細かく揺れ（f波）、RR間隔が完全に不規則。",
      causes: ["高血圧", "心不全・弁膜症", "加齢", "甲状腺機能亢進症", "飲酒・睡眠時無呼吸", "肺疾患・術後"],
      risk: "mid", riskText: "脳梗塞（心原性塞栓）の原因になる。頻脈が続くと心不全を悪化させる。抗凝固と心拍数調節を評価。",
    },
    afl: {
      label: "心房粗動", group: "supra", lead: "II",
      explain: "鋸歯状の粗動波（F波・約300回/分）。2:1伝導で心拍数約150、4:1で約75回/分。",
      causes: ["心疾患（弁膜症・心不全）", "肺疾患（COPD）", "心臓手術後"],
      risk: "mid", riskText: "1:1伝導になると極端な頻拍になり危険。塞栓リスクは心房細動に準じる。",
    },
    psvt: {
      label: "発作性上室頻拍", group: "supra", lead: "II",
      explain: "幅の狭いQRSの規則的な頻拍（150〜250回/分）。P波は見えないか、QRSの直後にある。",
      causes: ["房室結節リエントリー", "副伝導路（WPW症候群）による房室リエントリー"],
      risk: "mid", riskText: "多くは血行動態が保たれる。迷走神経刺激・ATPで停止することが多い。",
    },
    pac: {
      label: "上室期外収縮", group: "supra", lead: "II",
      explain: "予定より早く、形の違うP波に続いて幅の狭いQRSが出る。その後の休止は代償性でない。",
      causes: ["健常者でもみられる", "カフェイン・飲酒・喫煙", "ストレス・睡眠不足", "心房負荷（高血圧・弁膜症）"],
      risk: "low", riskText: "単発なら多くは治療不要。頻発すると心房細動のきっかけになることがある。",
    },
    junc: {
      label: "房室接合部調律", group: "supra", lead: "II",
      explain: "P波がない（またはQRSの後ろに逆行性P波）幅の狭いQRSが、40〜60回/分で規則的に続く。",
      causes: ["洞不全症候群（補充調律）", "ジギタリス中毒", "下壁梗塞", "心臓手術後"],
      risk: "mid", riskText: "補充調律として出ている場合は、上位の調律の障害を考える。",
    },
    pvc: {
      label: "心室期外収縮", group: "vent", lead: "II",
      explain: "P波を伴わない早期の幅広いQRSが出現し、その後に代償性休止がある。",
      causes: ["健常者でもみられる", "虚血性心疾患", "心不全・心筋症", "電解質異常（低K・低Mg）", "薬剤・カフェイン"],
      risk: "low", riskText: "単発なら多くは良性。多発・連発・多形性・R on T は心室頻拍・心室細動に移行しうるので注意。",
    },
    vt: {
      label: "心室頻拍（単形性）", group: "vent", lead: "II",
      explain: "同じ形の幅広いQRSが規則的に速く続く（100回/分超、多くは150〜250）。房室解離を伴う。",
      causes: ["陳旧性心筋梗塞（瘢痕）", "急性心筋虚血", "心筋症", "電解質異常", "QT延長をきたす薬剤"],
      risk: "high", riskText: "心室細動に移行しうる致死的不整脈。脈拍がなければ無脈性VTとしてCPRと除細動。脈拍があっても不安定なら同期電気ショック。",
    },
    pvt: {
      label: "多形性心室頻拍", group: "vent", lead: "II",
      explain: "QRSの形・大きさが拍ごとに変わる幅広い頻拍。QT延長がなければ急性虚血をまず考える。",
      causes: ["急性心筋虚血・心筋梗塞", "電解質異常", "ブルガダ症候群", "カテコラミン誘発性多形性VT"],
      risk: "arrest", riskText: "すぐに心室細動へ移行しやすい。脈拍がなければCPRと除細動。",
    },
    tdp: {
      label: "トルサード・ド・ポアント", group: "vent", lead: "II",
      explain: "QRSの向きと大きさが基線を軸にねじれるように変化する多形性VT。QT延長に伴う。",
      causes: ["QT延長をきたす薬剤（抗不整脈薬・抗精神病薬・マクロライド・抗真菌薬など）", "低K・低Mg血症", "先天性QT延長症候群", "高度徐脈"],
      risk: "arrest", riskText: "心室細動に移行しうる。マグネシウム投与と原因薬剤の中止。無脈なら除細動。",
    },
    vf: {
      label: "心室細動", group: "arrest", lead: "II",
      explain: "形・大きさの定まらない不規則な波で、QRSが識別できない。",
      causes: ["急性心筋梗塞", "心筋症", "電解質異常", "QT延長・ブルガダ症候群", "電撃傷・低体温"],
      risk: "arrest", riskText: "心停止。ただちにCPRと除細動。除細動までの時間が予後を左右する。",
    },
    asystole: {
      label: "心静止", group: "arrest", lead: "II",
      explain: "ほぼ平坦な波形。誘導・電極・感度を確認し、細かい心室細動でないことを確かめる。",
      causes: ["長時間の心停止の終末像", "高度の低酸素", "高カリウム血症", "広範な心筋障害"],
      risk: "arrest", riskText: "心停止。電気ショックの適応はない。CPRとアドレナリン、可逆的な原因（4H4T）の検索。",
    },
    pea: {
      label: "無脈性電気活動（PEA）", group: "arrest", lead: "II",
      context: "反応なし・正常な呼吸なし・頸動脈の拍動を触れない",
      explain: "モニターに規則的な波形があるのに脈拍が触れない状態。波形だけでは判断できず、脈拍の確認が必須。",
      causes: ["低酸素", "循環血液量減少（出血）", "高/低カリウム血症", "低体温", "緊張性気胸", "心タンポナーデ", "肺血栓塞栓症・心筋梗塞（血栓）", "中毒"],
      risk: "arrest", riskText: "心停止。電気ショックの適応はない。CPRとアドレナリン、4H4Tの検索と治療。",
    },
    idio: {
      label: "心室固有調律", group: "vent", lead: "II",
      explain: "P波のない幅広いQRSが、20〜40回/分で規則的に続く（心室からの補充調律）。",
      causes: ["完全房室ブロック・洞停止に対する補充", "広範な心筋梗塞", "高カリウム血症", "心停止前の状態"],
      risk: "high", riskText: "心拍出が保てないことが多い。脈拍を確認し（PEAではないか）、ペーシングを準備。",
    },
    avb1: {
      label: "1度房室ブロック", group: "avb", lead: "II",
      explain: "PR間隔が0.20秒を超えて延長しているが、すべてのP波にQRSが続く。",
      causes: ["加齢", "薬剤（β遮断薬・Ca拮抗薬・ジギタリス）", "迷走神経緊張", "下壁梗塞", "電解質異常"],
      risk: "low", riskText: "単独では症状がなく、経過観察が多い。",
    },
    wenck: {
      label: "2度房室ブロック（ウェンケバッハ型）", group: "avb", lead: "II",
      explain: "PR間隔が徐々に延び、やがてQRSが1拍脱落する。これを繰り返す。",
      causes: ["迷走神経緊張（睡眠中・スポーツ心臓）", "下壁梗塞", "薬剤（β遮断薬・ジギタリス）"],
      risk: "mid", riskText: "房室結節レベルの障害が多く、比較的良性。症状があれば評価。",
    },
    mobitz2: {
      label: "2度房室ブロック（モビッツII型）", group: "avb", lead: "II",
      explain: "PR間隔は一定のまま、突然QRSが脱落する。",
      causes: ["His束以下の伝導障害", "前壁梗塞", "刺激伝導系の変性"],
      risk: "high", riskText: "完全房室ブロックへ進行しうる。ペーシングの準備と循環器内科への相談。",
    },
    highavb: {
      label: "高度房室ブロック", group: "avb", lead: "II",
      explain: "P波が2拍以上続けて伝導しない（3:1・4:1など）。P波はQRSより多い。",
      causes: ["刺激伝導系の障害", "急性心筋梗塞", "薬剤", "高カリウム血症"],
      risk: "high", riskText: "高度の徐脈で失神・心停止の危険。ペーシングを準備。",
    },
    avb3: {
      label: "完全房室ブロック（3度）", group: "avb", lead: "II",
      explain: "P波とQRSがそれぞれ一定の間隔で、互いに無関係（房室解離）。補充調律は遅い。",
      causes: ["刺激伝導系の変性（加齢）", "急性心筋梗塞（特に下壁）", "薬剤", "高カリウム血症", "心サルコイドーシス"],
      risk: "high", riskText: "失神（アダムス・ストークス発作）・心停止の危険。アトロピンは効きにくく、経皮ペーシングを準備。",
    },
    rbbb: {
      label: "完全右脚ブロック", group: "cond", lead: "V1",
      explain: "V1でrsR'型（M字型）、QRS幅0.12秒以上。I・V6では幅広いS波。",
      causes: ["健常者でもみられる", "肺血栓塞栓症（急性右心負荷）", "心房中隔欠損症", "虚血性心疾患"],
      risk: "low", riskText: "単独なら多くは良性。新たに出現し胸痛・呼吸困難を伴うなら肺塞栓や虚血を考える。",
    },
    lbbb: {
      label: "完全左脚ブロック", group: "cond", lead: "V1",
      explain: "V1で深く幅広いS波（QS型）、QRS幅0.12秒以上。I・V6では幅広い結節性R波。",
      causes: ["虚血性心疾患", "高血圧性心疾患", "心筋症", "大動脈弁狭窄症"],
      risk: "mid", riskText: "基礎心疾患を伴うことが多い。新規の左脚ブロック＋胸痛は急性冠症候群として扱う。",
    },
    wpw: {
      label: "WPW症候群", group: "cond", lead: "II",
      explain: "PR短縮（0.12秒未満）、QRSの立ち上がりがなだらか（デルタ波）、QRS幅の軽度拡大。",
      causes: ["副伝導路（ケント束）の先天的な存在"],
      risk: "mid", riskText: "発作性上室頻拍を起こしやすい。心房細動を合併すると心室細動に移行しうる。",
    },
    stemiInf: {
      label: "ST上昇（下壁梗塞）", group: "isch", lead: "II",
      explain: "II誘導でSTが上に凸に上昇し、T波と一体化している。III・aVFでも上昇し、I・aVLで鏡像のST低下を伴う。",
      causes: ["急性下壁心筋梗塞（右冠動脈・回旋枝の閉塞）", "右室梗塞の合併に注意"],
      risk: "high", riskText: "急性心筋梗塞。すぐに循環器内科へ連絡し再灌流療法へ。徐脈・房室ブロック・低血圧を合併しやすい。",
    },
    stemiAnt: {
      label: "ST上昇（前壁梗塞）", group: "isch", lead: "V2",
      explain: "V1〜V4でSTが上昇。前壁中隔の梗塞を示す。",
      causes: ["急性前壁心筋梗塞（左前下行枝の閉塞）"],
      risk: "high", riskText: "広い範囲の梗塞になりやすく、心不全・心原性ショック・致死的不整脈の危険が高い。再灌流療法を急ぐ。",
    },
    stdep: {
      label: "ST低下（心内膜下虚血）", group: "isch", lead: "V5",
      explain: "STが水平型または下降型に低下（0.5mm以上）。",
      causes: ["狭心症・非ST上昇型急性冠症候群", "左室肥大（ストレイン）", "ジギタリス効果", "低カリウム血症", "後壁梗塞の鏡像（V1〜V3）"],
      risk: "mid", riskText: "症状があれば急性冠症候群として評価（トロポニン・経時的な心電図）。",
    },
    qwave: {
      label: "異常Q波", group: "isch", lead: "III",
      explain: "幅0.04秒以上、または深さがR波の1/4以上のQ波。",
      causes: ["陳旧性心筋梗塞", "発症から時間のたった急性心筋梗塞", "肥大型心筋症"],
      risk: "mid", riskText: "心筋の壊死を示す。過去の心電図と比べ、新しいものか確認。",
    },
    hyperk: {
      label: "高カリウム血症の心電図", group: "other", lead: "II",
      explain: "幅が狭く先の尖ったテント状T波。進行するとP波の平低化、QRS幅の拡大、サインカーブ様波形へ。",
      causes: ["腎不全・透析患者", "薬剤（ACE阻害薬・ARB・K保持性利尿薬）", "横紋筋融解・溶血", "アシドーシス・副腎不全"],
      risk: "high", riskText: "急に心室細動・心静止に至ることがある。血清Kを至急測定し、治療を急ぐ。",
    },
    longqt: {
      label: "QT延長", group: "other", lead: "II",
      explain: "T波の終わりが遅く、QTcが延長（男性450ms・女性460ms以上、500ms以上は高リスク）。",
      causes: ["薬剤（抗不整脈薬・抗精神病薬・抗うつ薬・マクロライド・抗真菌薬）", "低K・低Mg・低Ca血症", "先天性QT延長症候群", "徐脈・頭蓋内出血"],
      risk: "mid", riskText: "トルサード・ド・ポアントの危険。原因薬剤の確認と電解質の補正。",
    },
    brugada: {
      label: "ブルガダ型心電図", group: "other", lead: "V1",
      explain: "V1〜V2でJ点が高く、STがドーム状（coved型）に下降して陰性T波に続く。",
      causes: ["ブルガダ症候群（心筋のNaチャネル異常）", "発熱で顕在化することがある"],
      risk: "mid", riskText: "心室細動による突然死の原因になる。失神・家族歴があれば専門医へ。",
    },
    paced: {
      label: "ペースメーカー調律", group: "other", lead: "II",
      explain: "鋭く細いペーシングスパイクの直後に、幅広いQRSが続く（心室ペーシング）。",
      causes: ["ペースメーカー植込み後（房室ブロック・洞不全症候群）"],
      risk: "low", riskText: "正常に作動していれば問題ない。スパイク後にQRSが続かない（捕捉不全）、自己心拍を感知しない（感知不全）に注意。",
    },
  };

  const RISK_LABEL = { arrest: "心停止", high: "高い", mid: "中等度", low: "低い" };

  function makeStrip(type, seconds, seed) {
    const rand = rng(seed || 1);
    const R = (lo, hi) => lo + rand() * (hi - lo);
    const amp = R(0.85, 1.15);
    const parts = [];
    const beat = (c, o) => parts.push(beatFn(c, Object.assign({ amp }, o)));
    const pOnly = (c) => parts.push((t) => g(t, c, 0.022, 0.15 * amp));
    const rrFor = (lo, hi) => 60 / R(lo, hi);
    const series = (rr, o, jitter) => {
      for (let c = R(0.25, 0.55); c < seconds + 0.6; c += rr + (rand() - 0.5) * (jitter || 0.03)) beat(c, o);
    };
    let hr = null;
    const w = WAVES[type] ? type : "nsr";
    switch (w) {
      case "nsr": {
        const rr = rrFor(62, 92);
        series(rr, { pr: R(0.14, 0.18) });
        hr = 60 / rr;
        break;
      }
      case "stach": {
        const rr = rrFor(108, 140);
        series(rr, { pr: 0.13, tAt: 0.22 });
        hr = 60 / rr;
        break;
      }
      case "sbrady": {
        const rr = rrFor(38, 52);
        series(rr, { pr: 0.17 });
        hr = 60 / rr;
        break;
      }
      case "sarr": {
        let c = 0.4;
        const base = rrFor(68, 80);
        const ph = R(0, 6);
        let n = 0;
        while (c < seconds + 0.6) {
          beat(c, { pr: 0.16 });
          c += base * (1 + 0.22 * Math.sin(ph + n * 1.2));
          n++;
        }
        hr = 60 / base;
        break;
      }
      case "af": {
        const mean = R(0.45, 0.85);
        let c = 0.3;
        let n = 0;
        while (c < seconds + 0.6) {
          beat(c, { p: 0 });
          c += mean * R(0.55, 1.45);
          n++;
        }
        const ph = [R(0, 6), R(0, 6), R(0, 6)];
        parts.push((t) => 0.05 * Math.sin(2 * Math.PI * 6.3 * t + ph[0]) + 0.035 * Math.sin(2 * Math.PI * 8.9 * t + ph[1]) + 0.03 * Math.sin(2 * Math.PI * 4.7 * t + ph[2]));
        hr = 60 / mean;
        break;
      }
      case "afl": {
        const off = R(0, 0.2);
        const ratio = rand() < 0.6 ? 2 : 4;
        parts.push((t) => {
          const x = ((t + off) * 5) % 1;
          return amp * (x < 0.75 ? 0.12 - (0.3 * x) / 0.75 : -0.18 + (0.3 * (x - 0.75)) / 0.25);
        });
        for (let c = 0.3 + off; c < seconds + 0.6; c += 0.2 * ratio) beat(c, { p: 0, t: 0.15 });
        hr = 300 / ratio;
        break;
      }
      case "psvt": {
        const rr = rrFor(160, 210);
        for (let c = 0.2; c < seconds + 0.6; c += rr) {
          beat(c, { p: 0, tAt: 0.18, tSd: 0.035, t: 0.22 });
          parts.push((t) => g(t, c + 0.09, 0.015, -0.08));
        }
        hr = 60 / rr;
        break;
      }
      case "pac":
      case "pvc": {
        const rr = rrFor(64, 84);
        let c = 0.4;
        let i = 0;
        const every = 3 + Math.floor(rand() * 2);
        while (c < seconds + 0.6) {
          if (i % every === every - 1) {
            if (w === "pvc") {
              beat(c - rr * 0.4, { qrs: rand() < 0.5 ? "wide" : "wideNeg", p: 0, t: -0.35, tAt: 0.3, tSd: 0.06, amp: amp * 1.2 });
              c += rr * 0.6 + rr;
            } else {
              beat(c - rr * 0.35, { pr: 0.14, p: -0.1 });
              c += rr * 0.65 + rr * 0.95;
            }
          } else {
            beat(c, { pr: 0.16 });
            c += rr;
          }
          i++;
        }
        hr = 60 / rr;
        break;
      }
      case "junc": {
        const rr = rrFor(42, 58);
        for (let c = 0.4; c < seconds + 0.6; c += rr) {
          beat(c, { p: 0 });
          parts.push((t) => g(t, c + 0.1, 0.02, -0.1));
        }
        hr = 60 / rr;
        break;
      }
      case "vt": {
        const rr = rrFor(150, 200);
        const neg = rand() < 0.4;
        for (let c = 0.2; c < seconds + 0.6; c += rr) beat(c, { qrs: neg ? "wideNeg" : "wide", p: 0, t: neg ? 0.3 : -0.35, tAt: 0.2, tSd: 0.05, amp: amp * 1.1 });
        hr = 60 / rr;
        break;
      }
      case "pvt":
      case "tdp": {
        const rr = rrFor(200, 260);
        let n = 0;
        const per = w === "tdp" ? R(8, 12) : 0;
        for (let c = 0.15; c < seconds + 0.6; c += rr * R(0.9, 1.1), n++) {
          const m = w === "tdp" ? Math.sin((2 * Math.PI * n) / per) : R(-1, 1);
          const sign = m >= 0 ? 1 : -1;
          beat(c, { qrs: sign > 0 ? "wide" : "wideNeg", p: 0, t: -0.2 * sign, tAt: 0.16, tSd: 0.04, amp: amp * (0.4 + 1.1 * Math.abs(m)) });
        }
        hr = 60 / rr;
        break;
      }
      case "vf": {
        const ph = [R(0, 6), R(0, 6)];
        const f = R(4.5, 6.5);
        const big = R(0.25, 0.55);
        parts.push((t) => (big + 0.3 * Math.sin(2 * Math.PI * 0.35 * t + ph[0])) * Math.sin(2 * Math.PI * f * t + 0.8 * Math.sin(2 * Math.PI * 1.1 * t)) + 0.15 * Math.sin(2 * Math.PI * 7.7 * t + ph[1]));
        break;
      }
      case "asystole": {
        const ph = R(0, 6);
        parts.push((t) => 0.03 * Math.sin(2 * Math.PI * 0.4 * t + ph));
        break;
      }
      case "pea": {
        const rr = rrFor(40, 75);
        series(rr, { pr: 0.16, qrs: rand() < 0.5 ? "narrow" : "slightlyWide", amp: amp * 0.7 });
        hr = 60 / rr;
        break;
      }
      case "idio": {
        const rr = rrFor(25, 40);
        for (let c = R(0.3, 0.8); c < seconds + 0.6; c += rr) beat(c, { qrs: "wide", p: 0, t: -0.3, tAt: 0.32, tSd: 0.06 });
        hr = 60 / rr;
        break;
      }
      case "avb1": {
        const rr = rrFor(60, 80);
        series(rr, { pr: R(0.28, 0.36) });
        hr = 60 / rr;
        break;
      }
      case "wenck": {
        const pp = rrFor(70, 85);
        const prs = [0.16, 0.25, 0.31, null];
        let i = Math.floor(rand() * 4);
        for (let p = 0.25; p < seconds + 0.6; p += pp, i++) {
          const pr = prs[i % 4];
          pOnly(p);
          if (pr) beat(p + pr, { p: 0 });
        }
        hr = (60 / pp) * 0.75;
        break;
      }
      case "mobitz2": {
        const pp = rrFor(70, 85);
        let i = Math.floor(rand() * 3);
        for (let p = 0.25; p < seconds + 0.6; p += pp, i++) {
          pOnly(p);
          if (i % 3 !== 2) beat(p + 0.18, { p: 0, qrs: "slightlyWide" });
        }
        hr = (60 / pp) * (2 / 3);
        break;
      }
      case "highavb": {
        const pp = rrFor(80, 95);
        let i = Math.floor(rand() * 3);
        for (let p = 0.2; p < seconds + 0.6; p += pp, i++) {
          pOnly(p);
          if (i % 3 === 0) beat(p + 0.2, { p: 0, qrs: "slightlyWide" });
        }
        hr = (60 / pp) / 3;
        break;
      }
      case "avb3": {
        const pp = rrFor(75, 95);
        const rr = rrFor(30, 42);
        for (let p = R(0.1, 0.4); p < seconds + 0.6; p += pp) pOnly(p);
        for (let c = R(0.5, 1.0); c < seconds + 0.6; c += rr) beat(c, { qrs: rand() < 0.5 ? "wide" : "slightlyWide", p: 0, t: -0.25, tAt: 0.3 });
        hr = 60 / rr;
        break;
      }
      case "rbbb": {
        const rr = rrFor(62, 90);
        series(rr, { pr: 0.16, qrs: "rbbb", t: -0.2, tAt: 0.3 });
        hr = 60 / rr;
        break;
      }
      case "lbbb": {
        const rr = rrFor(62, 90);
        series(rr, { pr: 0.16, qrs: "lbbb", t: 0.35, tAt: 0.32, tSd: 0.06 });
        hr = 60 / rr;
        break;
      }
      case "wpw": {
        const rr = rrFor(62, 88);
        series(rr, { pr: 0.1, qrs: "delta" });
        hr = 60 / rr;
        break;
      }
      case "stemiInf":
      case "stemiAnt": {
        const rr = rrFor(70, 100);
        const ant = w === "stemiAnt";
        series(rr, { pr: 0.16, qrs: ant ? "wideNeg" : "narrow", st: R(0.25, 0.4), t: R(0.45, 0.6), tAt: 0.25, tSd: 0.07, amp: amp * (ant ? 0.7 : 1) });
        hr = 60 / rr;
        break;
      }
      case "stdep": {
        const rr = rrFor(70, 105);
        series(rr, { pr: 0.15, st: -R(0.15, 0.25), t: 0.12, tAt: 0.3 });
        hr = 60 / rr;
        break;
      }
      case "qwave": {
        const rr = rrFor(62, 85);
        series(rr, { pr: 0.16, qrs: "qwave", t: -0.15 });
        hr = 60 / rr;
        break;
      }
      case "hyperk": {
        const rr = rrFor(55, 80);
        series(rr, { pr: 0.18, p: 0.05, qrs: "slightlyWide", t: R(0.8, 1.0), tAt: 0.24, tSd: 0.028 });
        hr = 60 / rr;
        break;
      }
      case "longqt": {
        const rr = rrFor(58, 72);
        series(rr, { pr: 0.16, t: 0.25, tAt: R(0.44, 0.5), tSd: 0.06 });
        hr = 60 / rr;
        break;
      }
      case "brugada": {
        const rr = rrFor(62, 85);
        series(rr, { pr: 0.16, qrs: "brugada", t: -0.3, tAt: 0.28, tSd: 0.05 });
        hr = 60 / rr;
        break;
      }
      case "paced": {
        const rr = 60 / (rand() < 0.5 ? 60 : 70);
        series(rr, { p: 0, qrs: "paced", t: -0.3, tAt: 0.32, tSd: 0.06 }, 0.001);
        hr = 60 / rr;
        break;
      }
    }
    const nz = [R(0, 6), R(0, 6), R(0.15, 0.35), R(0.01, 0.05)];
    const y = (t) => parts.reduce((s, fn) => s + fn(t), 0) + 0.012 * Math.sin(2 * Math.PI * 23 * t + nz[0]) + nz[3] * Math.sin(2 * Math.PI * nz[2] * t + nz[1]);
    const info = WAVES[w];
    return { type: w, label: info.label, lead: info.lead, seconds, hr: hr ? Math.round(hr) : null, y };
  }

  // 出題用の選択肢: 正解1つ + 同じ仲間から2つ + ほかから1つ(PEA と洞調律は見分けられないので同時に出さない)
  function quizChoices(type, rand) {
    rand = rand || Math.random;
    const keys = Object.keys(WAVES);
    const shuffle = (a) => a.map((x) => [rand(), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
    const sinusLike = ["nsr", "sbrady", "stach", "sarr"];
    const ok = (k) => k !== type && !(type === "pea" && sinusLike.includes(k)) && !(k === "pea" && sinusLike.includes(type));
    const same = shuffle(keys.filter((k) => ok(k) && WAVES[k].group === WAVES[type].group)).slice(0, 2);
    const rest = shuffle(keys.filter((k) => ok(k) && !same.includes(k))).slice(0, 3 - same.length);
    return shuffle([type].concat(same, rest));
  }

  // 方眼紙(1mm・5mm)の上に波形を描く。25mm/秒・10mm/mV。
  function drawStrip(canvas, strip, pxPerMm, colors) {
    const mmW = strip.seconds * 25;
    const mmH = 32;
    canvas.width = Math.round(mmW * pxPerMm);
    canvas.height = Math.round(mmH * pxPerMm);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = colors.paper;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i <= mmW; i++) {
      ctx.strokeStyle = i % 5 === 0 ? colors.major : colors.minor;
      ctx.lineWidth = i % 5 === 0 ? 1.1 : 0.5;
      ctx.beginPath();
      ctx.moveTo(i * pxPerMm + 0.5, 0);
      ctx.lineTo(i * pxPerMm + 0.5, canvas.height);
      ctx.stroke();
    }
    for (let j = 0; j <= mmH; j++) {
      ctx.strokeStyle = j % 5 === 0 ? colors.major : colors.minor;
      ctx.lineWidth = j % 5 === 0 ? 1.1 : 0.5;
      ctx.beginPath();
      ctx.moveTo(0, j * pxPerMm + 0.5);
      ctx.lineTo(canvas.width, j * pxPerMm + 0.5);
      ctx.stroke();
    }
    const base = 19 * pxPerMm;
    ctx.strokeStyle = colors.trace;
    ctx.lineWidth = Math.max(1.4, pxPerMm * 0.28);
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let x = 0; x <= canvas.width; x++) {
      const t = x / pxPerMm / 25;
      const yy = base - strip.y(t) * 10 * pxPerMm;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
    if (strip.lead) {
      ctx.fillStyle = colors.trace;
      ctx.font = `bold ${Math.round(pxPerMm * 3.2)}px sans-serif`;
      ctx.fillText(strip.lead, pxPerMm * 2, pxPerMm * 4.5);
    }
  }

  const api = { evaluate, qtc, LEADS, WAVES, RHYTHMS: WAVES, RISK_LABEL, makeStrip, drawStrip, quizChoices };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.VAEcg = api;
})(typeof window !== "undefined" ? window : globalThis);
