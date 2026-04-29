import { randomBytes } from 'crypto';

// Tokens lisibles : 16 caracteres alphanumeriques (pas de 0, O, 1, I, l)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

export function generateEditToken() {
  const bytes = randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}
