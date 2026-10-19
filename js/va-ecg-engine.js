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

  const RHYTHMS = {
    nsr: { label: "正常洞調律", explain: "各QRSの前に同じ形のP波があり、RR間隔は一定。心拍数は60〜100回/分。" },
    stach: { label: "洞性頻脈", explain: "洞性P波を伴う規則的な頻拍（100回/分超）。原因（発熱・脱水・出血・疼痛・低酸素など）を探す。" },
    sbrady: { label: "洞性徐脈", explain: "洞性P波を伴う規則的な徐脈（60回/分未満）。症状と血行動態を確認する。" },
    af: { label: "心房細動", explain: "P波がなく基線が細かく揺れ（f波）、RR間隔が完全に不規則。" },
    afl: { label: "心房粗動", explain: "鋸歯状の粗動波（F波・約300回/分）。2:1伝導では心拍数が約150回/分になる。" },
    psvt: { label: "発作性上室頻拍", explain: "幅の狭いQRSの規則的な頻拍（150回/分以上）で、P波が見えないかQRSの後ろにある。" },
    vt: { label: "心室頻拍", explain: "幅の広いQRSが規則的に速く続く。脈拍の有無で対応が変わる（無脈なら除細動）。" },
    vf: { label: "心室細動", explain: "形・大きさの定まらない不規則な波で、QRSが識別できない。ただちにCPRと除細動。" },
    asystole: { label: "心静止", explain: "ほぼ平坦な波形。誘導・電極・感度を確認し、細かいVFでないことを確かめる。" },
    avb1: { label: "1度房室ブロック", explain: "PR間隔が200msを超えて延長しているが、すべてのP波にQRSが続く。" },
    wenck: { label: "2度房室ブロック（ウェンケバッハ型）", explain: "PR間隔が徐々に延び、やがてQRSが1拍脱落する。これを繰り返す。" },
    mobitz2: { label: "2度房室ブロック（モビッツII型）", explain: "PR間隔は一定のまま、突然QRSが脱落する。完全房室ブロックへ進行しうる。" },
    avb3: { label: "完全房室ブロック", explain: "P波とQRSがそれぞれ一定の間隔で、互いに無関係（房室解離）。" },
    pvc: { label: "心室期外収縮", explain: "洞調律の中に、P波を伴わない早期の幅広いQRSが出現し、その後に代償性休止がある。" },
  };

  function makeStrip(type, seconds, seed) {
    const rand = rng(seed || 1);
    const parts = [];
    const narrowBeat = (c, opt) => {
      opt = opt || {};
      if (opt.pr) parts.push((t) => g(t, c - opt.pr, 0.022, 0.15));
      parts.push((t) => g(t, c - 0.026, 0.008, -0.12) + g(t, c, 0.01, 1.1) + g(t, c + 0.024, 0.009, -0.3) + g(t, c + 0.27, 0.045, 0.3));
    };
    const wideBeat = (c, amp) => {
      const a = amp || 1;
      parts.push((t) => g(t, c, 0.032, 1.0 * a) + g(t, c + 0.075, 0.03, -0.55 * a) + g(t, c + 0.3, 0.06, -0.35 * a));
    };
    const pWave = (c) => parts.push((t) => g(t, c, 0.022, 0.15));
    const sinus = (rr, pr) => {
      for (let c = 0.35 + rand() * 0.2; c < seconds + 0.5; c += rr + (rand() - 0.5) * 0.03) narrowBeat(c, { pr });
    };
    let hr = null;
    switch (type) {
      case "nsr":
        sinus(0.82, 0.16);
        hr = 73;
        break;
      case "stach":
        sinus(0.5, 0.13);
        hr = 120;
        break;
      case "sbrady":
        sinus(1.36, 0.17);
        hr = 44;
        break;
      case "avb1":
        sinus(0.9, 0.32);
        hr = 67;
        break;
      case "af": {
        let c = 0.3;
        let n = 0;
        while (c < seconds + 0.5) {
          narrowBeat(c);
          c += 0.38 + rand() * 0.55;
          n++;
        }
        const ph = [rand() * 6, rand() * 6, rand() * 6];
        parts.push((t) => 0.05 * Math.sin(2 * Math.PI * 6.3 * t + ph[0]) + 0.035 * Math.sin(2 * Math.PI * 8.9 * t + ph[1]) + 0.03 * Math.sin(2 * Math.PI * 4.7 * t + ph[2]));
        hr = Math.round((n / (seconds + 0.2)) * 60);
        break;
      }
      case "afl": {
        const off = rand() * 0.2;
        parts.push((t) => {
          const x = ((t + off) * 5) % 1;
          return x < 0.75 ? 0.12 - (0.3 * x) / 0.75 : -0.18 + (0.3 * (x - 0.75)) / 0.25;
        });
        for (let c = 0.3 + off; c < seconds + 0.5; c += 0.4) narrowBeat(c);
        hr = 150;
        break;
      }
      case "psvt":
        for (let c = 0.2; c < seconds + 0.5; c += 0.34) {
          narrowBeat(c);
          parts.push((t) => g(t, c + 0.09, 0.015, -0.08));
        }
        hr = 176;
        break;
      case "vt":
        for (let c = 0.2; c < seconds + 0.5; c += 0.36) wideBeat(c, 1.1);
        hr = 167;
        break;
      case "vf": {
        const ph = [rand() * 6, rand() * 6];
        parts.push((t) => (0.45 + 0.3 * Math.sin(2 * Math.PI * 0.35 * t + ph[0])) * Math.sin(2 * Math.PI * 5.2 * t + 0.8 * Math.sin(2 * Math.PI * 1.1 * t)) + 0.18 * Math.sin(2 * Math.PI * 7.7 * t + ph[1]));
        break;
      }
      case "asystole":
        parts.push((t) => 0.03 * Math.sin(2 * Math.PI * 0.4 * t));
        break;
      case "wenck": {
        const prs = [0.16, 0.25, 0.31, null];
        let i = Math.floor(rand() * 4);
        for (let p = 0.25; p < seconds + 0.5; p += 0.8, i++) {
          const pr = prs[i % 4];
          pWave(p);
          if (pr) narrowBeat(p + pr);
        }
        hr = 56;
        break;
      }
      case "mobitz2": {
        let i = Math.floor(rand() * 3);
        for (let p = 0.25; p < seconds + 0.5; p += 0.8, i++) {
          pWave(p);
          if (i % 3 !== 2) narrowBeat(p + 0.18);
        }
        hr = 50;
        break;
      }
      case "avb3": {
        for (let p = 0.1 + rand() * 0.3; p < seconds + 0.5; p += 0.72) pWave(p);
        for (let c = 0.6 + rand() * 0.5; c < seconds + 0.5; c += 1.65) wideBeat(c, 0.9);
        hr = 36;
        break;
      }
      case "pvc": {
        let c = 0.4;
        let i = 0;
        while (c < seconds + 0.5) {
          if (i % 4 === 3) {
            wideBeat(c - 0.35, 1.3);
            c += 0.82;
          } else narrowBeat(c, { pr: 0.16 });
          c += 0.82;
          i++;
        }
        hr = 73;
        break;
      }
      default:
        sinus(0.82, 0.16);
    }
    const noise = [rand() * 6, rand() * 6];
    const y = (t) => parts.reduce((s, fn) => s + fn(t), 0) + 0.012 * Math.sin(2 * Math.PI * 23 * t + noise[0]) + 0.03 * Math.sin(2 * Math.PI * 0.25 * t + noise[1]);
    return { type, label: (RHYTHMS[type] || {}).label, seconds, hr, y };
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
  }

  const api = { evaluate, qtc, LEADS, RHYTHMS, makeStrip, drawStrip };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.VAEcg = api;
})(typeof window !== "undefined" ? window : globalThis);
