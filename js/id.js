// Permanent player ID generator (spec L194).
// Prefers crypto.randomUUID() (Safari 15.4+, Chrome 92+).
// Falls back to a UUIDv4 built from crypto.getRandomValues per RFC 4122 §4.4.
// Last-resort: Math.random based prefix (NOT cryptographically strong; logged warning).

export function newId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      // Per RFC 4122 §4.4: set version (4) and variant (10).
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
      return (
        hex.slice(0, 4).join('') + '-' +
        hex.slice(4, 6).join('') + '-' +
        hex.slice(6, 8).join('') + '-' +
        hex.slice(8, 10).join('') + '-' +
        hex.slice(10, 16).join('')
      );
    }
  } catch (e) {
    // fall through to last-resort
  }
  console.warn('id: crypto unavailable; using non-cryptographic fallback');
  return 'p_' + Math.random().toString(36).slice(2, 14) + Math.random().toString(36).slice(2, 14);
}
