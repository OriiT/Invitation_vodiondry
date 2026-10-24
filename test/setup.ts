import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach } from 'vitest';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// Base vide avant chaque test.
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM responses'),
    env.DB.prepare('DELETE FROM opens'),
    env.DB.prepare('DELETE FROM guests'),
    env.DB.prepare('DELETE FROM tables'),
    env.DB.prepare('DELETE FROM settings'),
    env.DB.prepare('DELETE FROM former_names'),
  ]);
});
