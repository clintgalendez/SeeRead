/**
 * Persistent settings shared by both windows. In the app this is the Tauri store
 * (`settings.json` in the app config directory); in a browser it is localStorage.
 * Everything read back is sanitized, since stored data is untrusted.
 */
import { load, type Store } from "@tauri-apps/plugin-store";
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from "../core/settings";
import { inTauri } from "./env";

const KEY = "settings";
const LOCAL_KEY = "seeread.settings";

type Listener = (s: Settings) => void;
const listeners = new Set<Listener>();
let current: Settings = DEFAULT_SETTINGS;
let loaded = false;
let ready: Promise<Settings> | null = null;
let store: Store | null = null;

function publish(next: Settings) {
  current = next;
  loaded = true;
  for (const l of listeners) l(next);
}

async function readRaw(): Promise<unknown> {
  if (store) return store.get(KEY);
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "null");
  } catch {
    return null;
  }
}

export function loadSettings(): Promise<Settings> {
  ready ??= (async () => {
    if (inTauri) {
      store = await load("settings.json", { autoSave: 200, defaults: {} });
      await store.onKeyChange(KEY, (value) => publish(sanitizeSettings(value)));
    } else {
      window.addEventListener("storage", (e) => {
        if (e.key === LOCAL_KEY) publish(sanitizeSettings(JSON.parse(e.newValue ?? "null")));
      });
    }
    publish(sanitizeSettings(await readRaw()));
    return current;
  })();
  return ready;
}

export const getSettings = () => current;
export const isLoaded = () => loaded;

export function subscribeSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Read-modify-write against the latest stored value.
 * Last write wins across windows; fine for human-speed edits. Add a
 * single-writer queue in Rust if settings ever change from background tasks.
 */
export async function updateSettings(change: (s: Settings) => Settings): Promise<Settings> {
  await loadSettings();
  const latest = (await readRaw()) ?? current;
  const next = sanitizeSettings(change(sanitizeSettings(latest)));
  if (store) await store.set(KEY, next);
  else localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
  publish(next);
  return next;
}

export function resetSettings(): Promise<Settings> {
  return updateSettings(() => ({ ...DEFAULT_SETTINGS, firstRunComplete: true }));
}
