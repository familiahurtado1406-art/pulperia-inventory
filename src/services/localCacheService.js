import { auth } from "../firebase/config";

const PREFIX = "pulperia_cache_v1";

const buildKey = (key) => {
  const uid = auth.currentUser?.uid || "anon";
  return `${PREFIX}:${uid}:${key}`;
};

export const readLocalCache = (key, maxAgeMs) => {
  try {
    const raw = localStorage.getItem(buildKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const createdAt = Number(parsed?.createdAt || 0);
    if (!createdAt || Date.now() - createdAt > Number(maxAgeMs || 0)) {
      return null;
    }
    return parsed.value ?? null;
  } catch {
    return null;
  }
};

export const writeLocalCache = (key, value) => {
  try {
    localStorage.setItem(
      buildKey(key),
      JSON.stringify({
        createdAt: Date.now(),
        value,
      })
    );
  } catch {
    // Ignore cache write errors (quota, private mode, etc.)
  }
};

