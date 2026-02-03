const cache = {
  fetchedAt: null, // Date
  pngBuffer: null, // Buffer
};

function isValid(ttlMin) {
  if (!cache.fetchedAt || !cache.pngBuffer) return false;
  const ageMs = Date.now() - cache.fetchedAt.getTime();
  return ageMs < ttlMin * 60 * 1000;
}

function ageText() {
  if (!cache.fetchedAt) return "";
  const s = Math.floor((Date.now() - cache.fetchedAt.getTime()) / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m`;
}

function set(buffer, fetchedAt = new Date()) {
  cache.pngBuffer = buffer;
  cache.fetchedAt = fetchedAt;
}

function get() {
  return { pngBuffer: cache.pngBuffer, fetchedAt: cache.fetchedAt };
}

module.exports = { isValid, ageText, set, get };