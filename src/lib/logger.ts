import pino from 'pino';
import { config } from './config';

const transport =
  config.NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
      }
    : {};

export const logger = pino({
  level: config.LOG_LEVEL,
  ...transport,
});
