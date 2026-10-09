// User settings that outlive a session (display, sound, instrument connection).
// Stored in localStorage; every access tolerates storage being unavailable.
const KEY = 'accordionTrainer.prefs';

type Value = string | boolean;

function load(): Record<string, Value> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Value>;
  } catch {
    return {};
  }
}

const cache = load();

export function getPref(key: string): Value | undefined {
  return cache[key];
}

export function setPref(key: string, value: Value): void {
  cache[key] = value;
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Not persisted, but the setting still applies for this session.
  }
}

// Restores a control's saved value and saves it again whenever the user changes it.
// `apply` runs after restoring so dependent state (labels, volume, channels) catches up.
export function persist(el: HTMLInputElement | HTMLSelectElement, key: string, apply?: () => void): void {
  const saved = getPref(key);
  if (el instanceof HTMLInputElement && el.type === 'checkbox') {
    if (typeof saved === 'boolean') el.checked = saved;
    el.addEventListener('change', () => setPref(key, el.checked));
  } else {
    if (typeof saved === 'string' && (!(el instanceof HTMLSelectElement) || [...el.options].some(o => o.value === saved))) {
      el.value = saved;
    }
    el.addEventListener(el instanceof HTMLSelectElement ? 'change' : 'input', () => setPref(key, el.value));
  }
  apply?.();
}
