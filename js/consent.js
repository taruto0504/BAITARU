(function () {
  "use strict";

  // Bump the version when the terms change so everyone has to agree again.
  const CONSENT_KEY = "vaTermsAccepted_v2";

  function hasConsent() {
    try {
      return !!localStorage.getItem(CONSENT_KEY);
    } catch (e) {
      return false;
    }
  }

  function saveConsent() {
    try {
      localStorage.setItem(CONSENT_KEY, JSON.stringify({ acceptedAt: new Date().toISOString() }));
    } catch (e) {
      /* storage unavailable: consent lasts for this page only */
    }
  }

  window.MSTConsent = { has: hasConsent };
  if (hasConsent()) return;

  const icon = window.icon || (() => "");

  const overlay = document.createElement("div");
  overlay.className = "consent-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "consent-title");
  overlay.innerHTML = `
    <div class="consent-box">
      <div class="consent-head">
        <img src="icons/icon.svg" alt="">
        <h2 id="consent-title">ご利用前にご確認ください</h2>
      </div>
      <ul class="consent-points">
        <li>VITAL ASSESS は医療従事者向けの<strong>診療の参考と学習のためのツール</strong>であり、<strong>医療機器ではありません</strong>。</li>
        <li>緊急度・疾患の候補・次の行動・心電図の判定は、入力された値と所見からガイドライン等の基準で示す参考情報で、診断ではありません。</li>
        <li>診断・治療の判断は、医師の指示・施設のプロトコルに基づき、<strong>利用者ご自身の責任</strong>で行ってください。</li>
        <li>本アプリの利用により生じたいかなる損害についても、<strong>開発者は責任を負いません</strong>。</li>
        <li>患者の氏名・IDなど、個人を特定できる情報は入力しないでください。記録はこの端末の中だけに保存されます。</li>
        <li>写真の読み取りを使うと、その画像は読み取りのために Claude に送られます。氏名・IDが写らないように撮影してください。</li>
      </ul>
      <a class="consent-link" href="#terms">${icon("note")} 利用規約・免責事項(全文)を読む</a>
      <label class="consent-check"><input type="checkbox" id="consent-check"> 上記および利用規約に同意します</label>
      <button class="btn-primary" id="consent-accept" type="button" disabled>同意して利用する</button>
    </div>`;
  document.body.appendChild(overlay);
  document.documentElement.classList.add("consent-open");

  // 全文を読むときは同意画面をいったん閉じ、規約の下に同意ボタンを出す
  overlay.querySelector(".consent-link").addEventListener("click", () => {
    overlay.hidden = true;
    document.documentElement.classList.remove("consent-open");
    const bar = document.createElement("div");
    bar.className = "consent-bar";
    bar.innerHTML = `<button class="btn-primary" type="button">${icon("check")} 同意して利用を開始する</button>`;
    bar.querySelector("button").addEventListener("click", () => {
      saveConsent();
      bar.remove();
      overlay.remove();
      document.documentElement.classList.remove("has-consent-bar");
      location.hash = "#home";
    });
    document.body.appendChild(bar);
    document.documentElement.classList.add("has-consent-bar");
  });

  const check = overlay.querySelector("#consent-check");
  const accept = overlay.querySelector("#consent-accept");
  check.addEventListener("change", () => {
    accept.disabled = !check.checked;
  });
  accept.addEventListener("click", () => {
    if (!check.checked) return;
    saveConsent();
    overlay.remove();
    document.documentElement.classList.remove("consent-open");
    window.dispatchEvent(new Event("consentaccepted"));
  });
})();
