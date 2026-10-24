// Authentification de l'administration : mot de passe, session en cookie signé (HMAC-SHA256), jeton CSRF.

import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppEnv, Env, Session } from '../env';
import { getSettings, setSettings, type Settings } from './settings';

export const SESSION_COOKIE = 'vd_session';
export const SESSION_TTL_MS = 14 * 24 * 3600 * 1000;
const PBKDF2_ITERATIONS = 100_000; // maximum accepté par Workers

const enc = new TextEncoder();

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

function randomId(bytes = 18): string {
  const u8 = new Uint8Array(bytes);
  crypto.getRandomValues(u8);
  return b64url(u8);
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export function secretsConfigured(env: Env): boolean {
  return Boolean(env.SESSION_SECRET && env.SESSION_SECRET.length >= 16 && env.ADMIN_PASSWORD);
}

/** Longueur minimale du mot de passe de l'administration. */
export const MIN_PASSWORD = 10;

/**
 * Le mot de passe en vigueur est le secret ADMIN_PASSWORD (jamais changé dans Réglages) et il est trop court :
 * l'administration affiche alors un avertissement (jamais la page de connexion, qui renseignerait un attaquant).
 */
export function weakAdminPassword(env: Env, settings: Pick<Settings, 'admin_password_hash'>): boolean {
  return !settings.admin_password_hash && Boolean(env.ADMIN_PASSWORD) && env.ADMIN_PASSWORD!.length < MIN_PASSWORD;
}

// ---------------------------------------------------------------- mots de passe

/** Empreinte PBKDF2-SHA256 : « pbkdf2$<itérations>$<sel>$<empreinte> ». */
export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const bits = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64url(salt)}$${b64url(bits)}`;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

/** Comparaison à temps constant de deux chaînes (via HMAC + verify). */
async function constantTimeEqual(a: string, b: string, secret: string): Promise<boolean> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(a));
  return crypto.subtle.verify('HMAC', key, sig, enc.encode(b));
}

/**
 * Vérifie le mot de passe admin : l'empreinte enregistrée dans les réglages si le mot de passe
 * a été changé depuis l'administration, sinon le secret ADMIN_PASSWORD.
 */
export async function verifyAdminPassword(env: Env, password: string): Promise<boolean> {
  if (!secretsConfigured(env) || !password) return false;
  const settings = await getSettings(env.DB);
  const stored = settings.admin_password_hash;
  if (stored) {
    const [scheme, iter, salt, hash] = stored.split('$');
    if (scheme !== 'pbkdf2' || !iter || !salt || !hash) return false;
    const bits = await pbkdf2(password, fromB64url(salt), Number(iter));
    return constantTimeEqual(b64url(bits), hash, env.SESSION_SECRET!);
  }
  return constantTimeEqual(env.ADMIN_PASSWORD!, password, env.SESSION_SECRET!);
}

/** Change le mot de passe admin et invalide toutes les sessions ouvertes. Renvoie la nouvelle époque. */
export async function changeAdminPassword(env: Env, newPassword: string): Promise<string> {
  const settings = await getSettings(env.DB);
  const epoch = String((Number(settings.session_epoch) || 0) + 1);
  await setSettings(env.DB, { admin_password_hash: await hashPassword(newPassword), session_epoch: epoch });
  return epoch;
}

// ---------------------------------------------------------------- sessions

async function sign(secret: string, data: string): Promise<string> {
  return b64url(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(data)));
}

export async function encodeSession(secret: string, session: Session): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify(session)));
  return `${payload}.${await sign(secret, payload)}`;
}

export async function decodeSession(secret: string, value: string | undefined): Promise<Session | null> {
  if (!value) return null;
  const [payload, sig] = value.split('.');
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64url(sig), enc.encode(payload));
    if (!ok) return null;
    const s = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as Session;
    if (typeof s.sid !== 'string' || typeof s.exp !== 'number' || typeof s.epoch !== 'string') return null;
    if (s.exp < Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}

function isHttps(c: Context): boolean {
  return new URL(c.req.url).protocol === 'https:';
}

/** Ouvre une session admin et pose le cookie (HttpOnly; Secure; SameSite=Lax). */
export async function startSession(c: Context<AppEnv>, epoch?: string): Promise<Session> {
  const ep = epoch ?? (await getSettings(c.env.DB)).session_epoch;
  const session: Session = { sid: randomId(), exp: Date.now() + SESSION_TTL_MS, epoch: ep };
  setCookie(c, SESSION_COOKIE, await encodeSession(c.env.SESSION_SECRET!, session), {
    httpOnly: true,
    // Toujours « Secure » en production (https) ; omis seulement sur http://localhost (wrangler dev).
    secure: isHttps(c),
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return session;
}

export function endSession(c: Context<AppEnv>): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: isHttps(c), httpOnly: true, sameSite: 'Lax' });
}

/** Session admin valide de la requête (signature, expiration et époque vérifiées), sinon null. */
export async function readSession(c: Context<AppEnv>): Promise<Session | null> {
  if (!secretsConfigured(c.env)) return null;
  const s = await decodeSession(c.env.SESSION_SECRET!, getCookie(c, SESSION_COOKIE));
  if (!s) return null;
  const { session_epoch } = await getSettings(c.env.DB);
  return s.epoch === session_epoch ? s : null;
}

// ---------------------------------------------------------------- CSRF

/** Jeton CSRF lié à la session (HMAC du sid). */
export async function csrfTokenFor(secret: string, session: Session): Promise<string> {
  return sign(secret, `csrf:${session.sid}`);
}

export async function verifyCsrf(secret: string, session: Session, token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  return constantTimeEqual(await csrfTokenFor(secret, session), token, secret);
}

/** Refuse les requêtes dont l'en-tête Origin (s'il est présent) n'est pas celui du site. */
export function sameOrigin(c: Context): boolean {
  const origin = c.req.header('origin');
  if (!origin) return true; // en-tête absent (anciens navigateurs) : le jeton CSRF suffit
  return origin === new URL(c.req.url).origin;
}
