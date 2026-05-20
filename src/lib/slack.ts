import { App, LogLevel } from '@slack/bolt';
import { config } from './config';

function toBoltLogLevel(level: string): LogLevel {
  const map: Record<string, LogLevel> = {
    fatal: LogLevel.ERROR,
    error: LogLevel.ERROR,
    warn: LogLevel.WARN,
    info: LogLevel.INFO,
    debug: LogLevel.DEBUG,
    trace: LogLevel.DEBUG,
  };
  return map[level] ?? LogLevel.INFO;
}

export const app = new App({
  token: config.SLACK_BOT_TOKEN,
  signingSecret: config.SLACK_SIGNING_SECRET,
  socketMode: config.SOCKET_MODE,
  appToken: config.SLACK_APP_TOKEN,
  logLevel: toBoltLogLevel(config.LOG_LEVEL),
  port: config.PORT,
});
