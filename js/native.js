(function () {
  "use strict";

  const cap = window.Capacitor;
  if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return;

  // capacitor.config sets light status-bar text for the blue header; the Android
  // gesture bar sits on the light page background, so it needs dark icons.
  if (cap.getPlatform() === "android") {
    cap.nativePromise("SystemBars", "setStyle", { style: "LIGHT", bar: "NavigationBar" }).catch(() => {});
  }
})();
