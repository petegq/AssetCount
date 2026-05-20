import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  SLACK_BOT_TOKEN: z.string().min(1, 'SLACK_BOT_TOKEN is required'),
  SLACK_SIGNING_SECRET: z.string().min(1, 'SLACK_SIGNING_SECRET is required'),
  // Required only when SOCKET_MODE=true — validated separately below
  SLACK_APP_TOKEN: z.string().optional(),

  DATABASE_URL: z.string().default('file:./dev.db'),

  PORT: z.coerce.number().int().positive().default(3000),
  SOCKET_MODE: z
    .string()
    .transform((v) => v.toLowerCase() !== 'false' && v !== '0')
    .default('true'),

  DISCREPANCY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.05),
  AUDIT_CHANNEL: z.string().default('#warehouse-audit'),
  DAILY_SUMMARY_CHANNEL: z.string().default('#warehouse-daily'),
  DAILY_SUMMARY_CRON: z.string().default('0 6 * * *'),

  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
});

function loadConfig() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    // Intentional console.error — this runs before logger is initialised
    // eslint-disable-next-line no-console
    console.error('Invalid environment variables:');
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(result.error.flatten().fieldErrors, null, 2));
    process.exit(1);
  }

  const cfg = result.data;

  if (cfg.SOCKET_MODE && !cfg.SLACK_APP_TOKEN) {
    // eslint-disable-next-line no-console
    console.error(
      'SLACK_APP_TOKEN is required when SOCKET_MODE=true.\n' +
        'Create an app-level token with scope: connections:write',
    );
    process.exit(1);
  }

  return cfg;
}

export const config = loadConfig();
export type Config = typeof config;
