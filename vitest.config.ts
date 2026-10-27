import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            ADMIN_PASSWORD: 'mot-de-passe-test',
            SESSION_SECRET: 'secret-de-test-0123456789abcdef',
            // Emails de réponse : interceptés par test/setup.ts (aucun appel réseau vers Resend).
            RESEND_API_KEY: 're_cle_de_test',
            NOTIFY_EMAIL: 'maries@example.test',
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/setup.ts'],
    },
  };
});
