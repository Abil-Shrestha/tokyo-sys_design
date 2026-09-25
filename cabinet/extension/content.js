// Hold ⌥ Option (Alt) and click an image to save it to Cabinet.
(() => {
  if (window.__cabinetContent) return;
  window.__cabinetContent = true;

  function toast(text, ok) {
    const el = document.createElement("div");
    el.textContent = text;
    el.setAttribute(
      "style",
      `position:fixed;z-index:2147483647;right:20px;bottom:20px;padding:10px 16px;border-radius:12px;font:500 14px -apple-system,system-ui,sans-serif;color:#fff;background:${ok ? "#1f1d1a" : "#d93a2b"};box-shadow:0 10px 30px rgba(0,0,0,.25);transition:opacity .3s;opacity:1`,
    );
    document.documentElement.appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 300);
    }, 2200);
  }

  function imageSource(target) {
    const img = target.closest("img, picture img");
    if (img) return img.currentSrc || img.src;
    const video = target.closest("video");
    if (video && video.poster) return video.poster;
    // Many galleries put the picture in a CSS background.
    let el = target;
    for (let i = 0; el && i < 4; i++, el = el.parentElement) {
      const bg = getComputedStyle(el).backgroundImage;
      const m = /url\(["']?([^"')]+)["']?\)/.exec(bg || "");
      if (m) return new URL(m[1], location.href).href;
    }
    return null;
  }

  document.addEventListener(
    "click",
    (e) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || !(e.target instanceof Element)) return;
      const src = imageSource(e.target);
      if (!src || src.startsWith("blob:")) return;
      e.preventDefault();
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: "save-image", src, pageUrl: location.href, pageTitle: document.title }, (res) => {
        if (chrome.runtime.lastError) return toast("Couldn't reach Cabinet", false);
        if (res && res.ok) toast(res.duplicate ? "Already in Cabinet" : "Image saved to Cabinet", true);
        else toast((res && res.error) || "Couldn't save", false);
      });
    },
    true,
  );
})();
