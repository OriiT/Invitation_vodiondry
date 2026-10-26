// Codes personnels des invités : 8 caractères base32 (alphabet de Crockford, en minuscules,
// sans i/l/o/u pour éviter les confusions), tirés avec crypto.getRandomValues.
// 32^8 ≈ 1,1 × 10^12 combinaisons : impossible à deviner en pratique.

export const CODE_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
export const CODE_LENGTH = 8;

const CODE_RE = /^[0-9abcdefghjkmnpqrstvwxyz]{8}$/;

export function generateCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let out = '';
  // 256 est un multiple de 32 : « & 31 » n'introduit aucun biais.
  for (const b of bytes) out += CODE_ALPHABET[b & 31];
  return out;
}

/** Normalise un code saisi (casse, espaces) ; renvoie null s'il est invalide. */
export function normalizeCode(input: string | undefined | null): string | null {
  if (!input) return null;
  const c = input.trim().toLowerCase();
  return CODE_RE.test(c) ? c : null;
}
