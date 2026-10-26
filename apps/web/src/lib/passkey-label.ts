// Browsers do not reliably expose a phone model. This is an editable suggestion,
// describing where the key was created rather than restricting where it works.
export function suggestPasskeyLabel(device: { userAgent: string; platform?: string; maxTouchPoints?: number }): string {
  const ua = device.userAgent;
  const os = /Android/i.test(ua) ? "Android"
    : /iPad/i.test(ua) || device.platform === "MacIntel" && (device.maxTouchPoints ?? 0) > 1 ? "iPadOS"
    : /iPhone|iPod/i.test(ua) ? "iOS"
    : /Windows/i.test(ua) ? "Windows"
    : /Macintosh|Mac OS X/i.test(ua) ? "macOS"
    : /Linux/i.test(ua) ? "Linux" : "Устройство";
  const browser = /SamsungBrowser\//i.test(ua) ? "Samsung Internet"
    : /Edg(?:e|A|iOS)?\//i.test(ua) ? "Edge"
    : /OPR\/|OPiOS\//i.test(ua) ? "Opera"
    : /Firefox\/|FxiOS\//i.test(ua) ? "Firefox"
    : /Chrome\/|CriOS\//i.test(ua) ? "Chrome"
    : /Safari\//i.test(ua) ? "Safari" : "Браузер";
  return `${os} · ${browser}`;
}
