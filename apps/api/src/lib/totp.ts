import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomInt } from 'node:crypto';
import { config } from '../config';
import { safeEqual, sha256 } from './crypto';

/**
 * Two-factor sign-in with an authenticator app (TOTP, RFC 6238: SHA-1, 6 digits, 30 s), as
 * Google Authenticator, Microsoft Authenticator and others expect. Secrets are stored
 * encrypted; recovery codes only as hashes.
 */

const STEP_SECONDS = 30;
const DIGITS = 6;
/** One step early or late is accepted, for phone clocks that drift a little. */
const WINDOW = 1;

// ───────────── base32 (RFC 4648), what authenticator apps use for the secret ─────────────

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string) {
  const clean = s.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('Not base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ───────────── codes ─────────────

export const newTotpSecret = () => base32Encode(randomBytes(20));

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

/** The code for one time step (RFC 4226 dynamic truncation). */
export function totpCode(secretBase32: string, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secretBase32)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * The time step a code is valid for, or null. Steps at or before `lastStep` are refused, so a
 * code seen by someone looking over a shoulder can't be used again.
 */
export function verifyTotp(secretBase32: string, code: string, lastStep: number | null, now = Date.now()) {
  const digits = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(digits)) return null;
  const step = currentStep(now);
  for (let s = step - WINDOW; s <= step + WINDOW; s++) {
    if (lastStep !== null && s <= lastStep) continue;
    if (safeEqual(totpCode(secretBase32, s), digits)) return s;
  }
  return null;
}

/** What an authenticator app scans: otpauth://totp/Issuer:account?secret=… */
export function otpauthUrl(secretBase32: string, account: string, issuer: string) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({ secret: secretBase32, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${q}`;
}

// ───────────── secrets at rest ─────────────

/** AES-256-GCM key derived from JWT_SECRET (changing JWT_SECRET means everyone sets up 2FA again). */
const key = () => Buffer.from(hkdfSync('sha256', config.JWT_SECRET, 'sft-totp-salt', 'totp secrets v1', 32));

export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}

export function decryptSecret(stored: string) {
  const [version, iv, tag, data] = stored.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unknown secret format');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

// ───────────── recovery codes ─────────────

const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alikes (0/o, 1/l/i)

export const normalizeRecoveryCode = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Eight one-time codes like "k7pm-x2qd"; only their hashes are kept. */
export function newRecoveryCodes() {
  const codes = Array.from({ length: 8 }, () => {
    const s = Array.from({ length: 8 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]).join('');
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
  return { codes, hashes: codes.map((c) => sha256(normalizeRecoveryCode(c))) };
}

/** The hashes left after using `code`, or null when it isn't one of them. */
export function useRecoveryCode(hashes: string[], code: string) {
  const h = sha256(normalizeRecoveryCode(code));
  return hashes.includes(h) ? hashes.filter((x) => x !== h) : null;
}
