
export const getStorageItem = <T>(key: string, defaultValue: T): T => {
  const saved = localStorage.getItem(key);
  if (saved) {
    try {
      return JSON.parse(saved) as T;
    } catch (e) {
      console.error(`Error parsing localStorage key "${key}":`, e);
    }
  }
  return defaultValue;
};

export const setStorageItem = <T>(key: string, value: T): void => {
  localStorage.setItem(key, JSON.stringify(value));
};

/**
 * Parse a JSON string, returning `fallback` if the value is empty or malformed.
 * Prevents a bad DB value from throwing during render and blanking a route.
 */
export const safeJsonParse = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch (e) {
    console.error('safeJsonParse failed for value:', value, e);
    return fallback;
  }
};
