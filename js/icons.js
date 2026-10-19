(function () {
  "use strict";

  // Line icons (24x24, stroked with currentColor), used as <svg class="ic"><use href="#i-NAME"/></svg>.
  const ICONS = {
    "chevron-left": '<path d="M15 18l-6-6 6-6"/>',
    "chevron-right": '<path d="M9 18l6-6-6-6"/>',
    drip: '<path d="M10 2h4"/><path d="M6.5 4h11v7.5a5.5 5.5 0 0 1-11 0z"/><path d="M9.5 8h3M9.5 11h2"/><path d="M12 17v1.5"/><path d="M12 20.2c-.7.8-1 1.3-1 1.6a1 1 0 0 0 2 0c0-.3-.3-.8-1-1.6z"/>',
    oxygen: '<rect x="7" y="8" width="10" height="14" rx="3"/><path d="M10 8V5h4v3M9 2.5h6M10.5 13h3"/>',
    stopwatch: '<circle cx="12" cy="14" r="8"/><path d="M12 14v-4M10 2h4M12 2v4M18.5 7.5 20 6"/>',
    "heart-pulse":
      '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/><path d="M3.5 12h4l1.5-2.5 2.5 5 2-3.5h7"/>',
    calculator:
      '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8.5 6h7M9 11h.01M12 11h.01M15 11h.01M9 14.5h.01M12 14.5h.01M15 14.5h.01M9 18h.01M12 18h.01M15 18h.01"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
    play: '<path d="M7 4.5v15l12-7.5z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
    volume: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4M8 22h8"/>',
    expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
    collapse: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
    ecg: '<path d="M2 12h4l2.5-6 4 12 3-9 2 3H22"/>',
    lungs:
      '<path d="M12 3v8M12 11l-3 2M12 11l3 2"/><path d="M8.5 7.5C6 7.5 3 11.5 3 16.5c0 2.2 1 3.5 3 3.5 2.5 0 3-1.5 3-3.5V11"/><path d="M15.5 7.5c2.5 0 5.5 4 5.5 9 0 2.2-1 3.5-3 3.5-2.5 0-3-1.5-3-3.5V11"/>',
    drop: '<path d="M12 2.7 6.3 8.9a8 8 0 1 0 11.4 0z"/>',
    syringe:
      '<path d="M18 2l4 4M20 4l-3 3M17.5 5.5l1 1M19 9.5 9.5 19a2 2 0 0 1-2.8 0L5 17.3a2 2 0 0 1 0-2.8L14.5 5"/><path d="M9.5 10.5l2 2M12 8l2 2M5.5 18.5 2 22"/>',
    note: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    star: '<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    pill: '<path d="M10.5 20.5 3.5 13.5a4.95 4.95 0 0 1 7-7l7 7a4.95 4.95 0 0 1-7 7z"/><path d="M8.5 8.5l7 7"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  };

  const symbols = Object.keys(ICONS)
    .map((name) => `<symbol id="i-${name}" viewBox="0 0 24 24">${ICONS[name]}</symbol>`)
    .join("");
  document.body.insertAdjacentHTML(
    "afterbegin",
    `<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">${symbols}</svg>`
  );

  window.icon = function (name, extraClass) {
    return `<svg class="ic${extraClass ? " " + extraClass : ""}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  };
})();
