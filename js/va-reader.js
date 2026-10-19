(function () {
  "use strict";

  // ===== 写真の読み取り(Claude) =====
  // Claude 上で開いたときだけ使えます(claude.use("sample"))。
  // 読み取った値は必ず確認画面を通してから入力欄に反映します。

  let samplePromise = null;
  function getSample() {
    if (!samplePromise) {
      samplePromise =
        window.claude && typeof window.claude.use === "function"
          ? window.claude.use("sample").catch(() => null)
          : Promise.resolve(null);
    }
    return samplePromise;
  }

  // 画像を送れる環境か(送れないときは写真を見ながら手入力)
  async function available() {
    const sample = await getSample();
    if (!sample) return false;
    try {
      const limits = await sample.limits();
      return !!(limits && limits.images);
    } catch (e) {
      return false;
    }
  }

  const VITAL_PROMPT = `あなたは医療機器の画面を読み取るアシスタントです。添付の画像は、生体情報モニター、パソコン画面(電子カルテ・搬送記録)、または紙の記録です。
画像に表示されている「現在の測定値」だけを読み取り、次のJSONだけを返してください。説明文は不要です。

{
  "readable": true または false,
  "reason": "読み取れない場合の理由(反射・ブレ・数値が写っていない など)。読み取れた場合は空文字",
  "values": {
    "hr": 心拍数または脈拍数(回/分)の数値 または null,
    "sys": 血圧の収縮期(mmHg)の数値 または null,
    "dia": 血圧の拡張期(mmHg)の数値 または null,
    "spo2": SpO2(%)の数値 または null,
    "rr": 呼吸数(回/分)の数値 または null,
    "temp": 体温(℃)の数値 または null
  },
  "confidence": { "hr": "high" または "low", "sys": "...", "dia": "...", "spo2": "...", "rr": "...", "temp": "..." },
  "notes": "気づいたこと(例: 血圧は測定時刻が古い、アラーム表示あり)。なければ空文字"
}

ルール:
- 推測で数値を作らない。はっきり読めない項目は null にする。
- 「1」と「7」、「0」と「8」など紛らわしい文字があれば、その項目の confidence を "low" にする。
- アラームの上限・下限の設定値、グラフの目盛り、時刻、ベッド番号は測定値ではないので読まない。
- 平均血圧(MAP、括弧内の値)は sys/dia に入れない。
- 患者の氏名・IDなどの個人情報は出力に含めない。`;

  const ECG_PROMPT = `あなたは心電図の判読を補助するアシスタントです。添付の画像は、心電図の記録紙、生体情報モニター、または除細動器の画面です。
画像から読み取れる所見だけを、次のJSONで返してください。説明文は不要です。

{
  "readable": true または false,
  "reason": "読み取れない場合の理由。読み取れた場合は空文字",
  "quality": ["判読を難しくしている点(反射・ブレ・方眼の欠け・ノイズなど)。なければ空配列"],
  "hr": 心拍数(回/分)の数値 または null,
  "regularity": "reg"(規則的) / "irreg"(やや不規則) / "irregirreg"(完全に不規則) / null,
  "p": "normal"(各QRSの前に同じ形のP波) / "none"(P波が見えない) / "fib"(細動波) / "flutter"(鋸歯状の粗動波) / "more"(P波がQRSより多い) / "retro"(QRSの後ろ) / null,
  "av": "prolonging"(PRが徐々に延長して脱落) / "drop"(PR一定で突然脱落) / "dissoc"(PとQRSが無関係) / null,
  "qrsShape": "normal" / "wide" / "rbbb" / "lbbb" / "delta" / "polymorph" / "chaotic" / "flat" / null,
  "pr": PR間隔(ms)の数値 または null,
  "qrs": QRS幅(ms)の数値 または null,
  "qt": QT間隔(ms)の数値 または null,
  "stUp": ST上昇がある誘導名の配列(I, II, III, aVR, aVL, aVF, V1〜V6 の表記),
  "stDown": ST低下がある誘導名の配列,
  "flags": ["peakedT"(テント状T波), "qwave"(異常Q波), "brugada"(coved型ST), "pacing"(ペーシングスパイク), "noise"(体動・ノイズ) のうち当てはまるもの],
  "rhythm": "最も考えられるリズム名(日本語)",
  "confidence": "high" / "mid" / "low"
}

ルール:
- はっきりしない項目は null または空配列にし、推測で埋めない。
- 紙送り速度や感度が読み取れない場合は、25mm/秒・10mm/mVと仮定せず、計測値(pr, qrs, qt)を null にする。
- 1誘導しか写っていない場合、stUp/stDown はその誘導だけで判断する。
- 患者の氏名・IDなどの個人情報は出力に含めない。`;

  const ERRORS = {
    not_granted: "Claude の利用が許可されませんでした。写真を見ながら手入力してください。",
    sampling_disabled: "この環境では写真の読み取りを使えません。",
    images_unavailable: "この環境では画像を送れません。写真を見ながら手入力してください。",
    image_rejected: "この画像は読み込めませんでした。別の写真を選んでください。",
    rate_limited: "読み取りが混み合っています。少し時間をおいてから試してください。",
    refused: "この画像は読み取れませんでした。数値の部分だけを撮り直してください。",
    invalid_json: "読み取り結果を受け取れませんでした。もう一度試してください。",
    session_expired: "ログインが切れています。Claude にログインし直してください。",
  };

  async function read(kind, file, signal) {
    const sample = await getSample();
    if (!sample) throw { code: "unavailable", message: "この環境では写真の読み取りを使えません。Claude 上で開いたときに使えます。" };
    try {
      return await sample.json(kind === "ecg" ? ECG_PROMPT : VITAL_PROMPT, { images: [file], signal, cache: false });
    } catch (e) {
      throw { code: e && e.code, message: (e && ERRORS[e.code]) || "読み取りに失敗しました。もう一度試してください。" };
    }
  }

  window.VAReader = { available, read };
})();
