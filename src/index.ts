import { app } from './lib/slack';
import { config } from './lib/config';
import { logger } from './lib/logger';

// Handlers registered here in later milestones
// import './handlers';

async function main() {
  await app.start();

  logger.info(
    {
      socketMode: config.SOCKET_MODE,
      port: config.SOCKET_MODE ? null : config.PORT,
      nodeEnv: config.NODE_ENV,
    },
    'Asset Count Bot started',
  );
}

main().catch((err: unknown) => {
  logger.error(err, 'Fatal error during startup');
  process.exit(1);
});
