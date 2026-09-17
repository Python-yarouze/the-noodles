/**
 * Local cosmetic skin (THE CURRY easter egg). Not synced over the network.
 * Internal card IDs / declarations stay noodles names.
 */

export const SKIN_NOODLES = "noodles";
export const SKIN_CURRY = "curry";

const STORAGE_KEY = "noodles.skin";

/** @type {Record<string, string>} */
export const CURRY_DISPLAY_NAMES = {
  めん: "ルー",
  ごはん: "カレー粉",
  えび: "シーフード",
  ぶた: "カツ",
  とり: "チキン",
  バター: "チーズ",
  たまご: "たまご",
  しお: "ブイヨン",
  しょうゆ: "コーヒー",
  みそ: "はちみつ",
  きのこ: "マッシュルーム",
  コーン: "コーン",
  しょうが: "なす",
  にんにく: "なっとう",
  ねぎ: "トマト",
  めんま: "たまねぎ",
  もやし: "福神漬け",
};

/** Longer keys first so しょうゆ is not partially matched by shorter names. */
const REPLACE_KEYS = Object.keys(CURRY_DISPLAY_NAMES).sort((a, b) => b.length - a.length);
const REPLACE_PATTERN = new RegExp(REPLACE_KEYS.map(escapeRegExp).join("|"), "g");

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const KONAMI = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "KeyB",
  "KeyA",
];

/** @type {string} */
let currentSkin = loadSkin();

/** @type {Set<(skin: string) => void>} */
const listeners = new Set();

function loadSkin() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === SKIN_CURRY || v === SKIN_NOODLES) return v;
  } catch {
    /* ignore */
  }
  return SKIN_NOODLES;
}

export function getSkin() {
  return currentSkin;
}

export function isCurrySkin() {
  return currentSkin === SKIN_CURRY;
}

export function brandName() {
  return isCurrySkin() ? "THE CURRY" : "THE NOODLES";
}

export function setSkin(skin) {
  const next = skin === SKIN_CURRY ? SKIN_CURRY : SKIN_NOODLES;
  if (next === currentSkin) return currentSkin;
  currentSkin = next;
  try {
    localStorage.setItem(STORAGE_KEY, currentSkin);
  } catch {
    /* ignore */
  }
  if (typeof document !== "undefined") {
    document.body.classList.toggle("skin-curry", isCurrySkin());
  }
  for (const cb of listeners) {
    try {
      cb(currentSkin);
    } catch {
      /* ignore listener errors */
    }
  }
  return currentSkin;
}

export function toggleSkin() {
  return setSkin(isCurrySkin() ? SKIN_NOODLES : SKIN_CURRY);
}

export function onSkinChange(cb) {
  if (typeof cb !== "function") return () => {};
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Map internal card name to display label for the active skin. */
export function displayCardName(name) {
  if (!name) return "";
  if (!isCurrySkin()) return String(name);
  return CURRY_DISPLAY_NAMES[name] || String(name);
}

/** Replace internal card names inside free text (effects, logs). Single-pass to avoid めん→ごはん→ナン. */
export function applySkinToText(text) {
  const s = String(text ?? "");
  if (!isCurrySkin() || !s) return s;
  return s.replace(REPLACE_PATTERN, (m) => CURRY_DISPLAY_NAMES[m] || m);
}

export function applyBodySkinClass() {
  if (typeof document === "undefined") return;
  document.body.classList.toggle("skin-curry", isCurrySkin());
}

/**
 * Install Konami code listener.
 * @param {(skin: string) => void} [onToggle]
 */
export function installKonamiListener(onToggle) {
  applyBodySkinClass();
  let idx = 0;
  window.addEventListener("keydown", (e) => {
    const t = e.target;
    if (
      t instanceof HTMLElement &&
      (t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.tagName === "SELECT" ||
        t.isContentEditable)
    ) {
      idx = 0;
      return;
    }
    const code = e.code || "";
    if (code === KONAMI[idx]) {
      idx += 1;
      if (idx >= KONAMI.length) {
        idx = 0;
        const skin = toggleSkin();
        if (typeof onToggle === "function") onToggle(skin);
      }
      return;
    }
    idx = code === KONAMI[0] ? 1 : 0;
  });
}
