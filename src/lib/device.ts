export type DeviceInfo = {
  deviceKey: string;
  deviceName: string;
  deviceType: string;
  browser: string;
  os: string;
};

const KEY = "sentinel.device.key";

function randomKey() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A registered device identifier stored on this browser only.
 * No covert hardware fingerprinting, no MAC address access — browsers
 * intentionally block that, and we do not attempt to work around it.
 */
export function getDeviceInfo(): DeviceInfo {
  if (typeof window === "undefined") {
    return {
      deviceKey: "server",
      deviceName: "Server",
      deviceType: "Unknown",
      browser: "Unknown",
      os: "Unknown",
    };
  }
  let key = window.localStorage.getItem(KEY);
  if (!key) {
    key = randomKey();
    window.localStorage.setItem(KEY, key);
  }

  const ua = navigator.userAgent;
  const os = /Android/i.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/i.test(ua)
      ? "iOS"
      : /Mac OS X/i.test(ua)
        ? "macOS"
        : /Windows/i.test(ua)
          ? "Windows"
          : /Linux/i.test(ua)
            ? "Linux"
            : "Unknown";

  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /OPR\//i.test(ua)
      ? "Opera"
      : /Chrome\//i.test(ua)
        ? "Chrome"
        : /Safari\//i.test(ua)
          ? "Safari"
          : /Firefox\//i.test(ua)
            ? "Firefox"
            : "Unknown";

  const deviceType = /Mobi|Android|iPhone/i.test(ua)
    ? "Mobile"
    : /iPad|Tablet/i.test(ua)
      ? "Tablet"
      : "Desktop";

  return { deviceKey: key, deviceName: `${browser} on ${os}`, deviceType, browser, os };
}
