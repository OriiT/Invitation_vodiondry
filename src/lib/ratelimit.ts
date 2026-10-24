// Limitation de débit simple, en mémoire (par instance du Worker).
// Suffisant pour freiner les abus sur /api/rsvp et les essais de mot de passe.

const buckets = new Map<string, number[]>();
const MAX_KEYS = 5000;

/**
 * Enregistre une tentative pour `key` et indique si elle est autorisée
 * (au plus `limit` tentatives sur une fenêtre glissante de `windowMs`).
 */
export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const since = now - windowMs;
  const hits = (buckets.get(key) ?? []).filter((t) => t > since);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > MAX_KEYS) prune(since);
  return true;
}

/**
 * Rend une tentative enregistrée par rateLimit(key, …, at) : sert à compter une tentative AVANT une vérification
 * asynchrone (des requêtes simultanées ne peuvent pas toutes passer), puis à la rendre si elle a réussi.
 */
export function releaseHit(key: string, at: number): void {
  const hits = buckets.get(key);
  if (!hits) return;
  const i = hits.lastIndexOf(at);
  if (i >= 0) hits.splice(i, 1);
}

/** Vérifie sans consommer de tentative. */
export function isRateLimited(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const since = now - windowMs;
  return (buckets.get(key) ?? []).filter((t) => t > since).length >= limit;
}

function prune(since: number) {
  for (const [k, hits] of buckets) {
    if (!hits.some((t) => t > since)) buckets.delete(k);
  }
  // Toujours trop de clés : on repart de zéro plutôt que de grossir sans fin.
  if (buckets.size > MAX_KEYS) buckets.clear();
}

/**
 * Adresse IP du client telle que vue par Cloudflare. Une adresse IPv6 est ramenée à son préfixe /64 : un même
 * abonné dispose de tout le bloc et pourrait sinon changer d'adresse à chaque essai.
 */
export function clientIp(req: Request): string {
  return ipBucket(req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip') ?? 'local');
}

/**
 * « 2001:db8:1:2:aaaa::1 » → « 2001:db8:1:2::/64 ». Une adresse IPv4, une IPv4 dans une IPv6 (« ::ffff:1.2.3.4 »)
 * ou une adresse illisible est rendue telle quelle.
 */
export function ipBucket(ip: string): string {
  const a = ip.trim().toLowerCase();
  if (!a.includes(':') || /[.%]/.test(a)) return ip;
  const halves = a.split('::');
  if (halves.length > 2) return ip;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return ip;
  const all = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  const prefix = all.slice(0, 4);
  if (!prefix.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return ip;
  return `${prefix.map((g) => parseInt(g, 16).toString(16)).join(':')}::/64`;
}
