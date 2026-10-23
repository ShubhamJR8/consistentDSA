import { env } from '../config/env.js';

// One place that decides how an event is written, so production logs are machine-parseable and the
// events that need a human can be matched by a log-based alert without a vendor SDK.
//
//   info / warn / error : ordinary logging.
//   alert               : something that needs a person (money mismatch, dispute, outage). Same as
//                         error, plus `"alert":true`, which is the field to build alert rules on.
//
// In production each event is one JSON line; elsewhere it stays readable. Swap the body of `emit`
// (or add a call to an error tracker in `alert`) to change where events go — callers don't change.
type Level = 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

/** Errors serialize to nothing useful by default, and a full error object can carry request details
 *  (headers, bodies). Keep the message and stack only. */
export const describeError = (error: unknown): { message: string; stack?: string } =>
  error instanceof Error
    ? { message: error.message, stack: env.NODE_ENV === 'production' ? error.stack : undefined }
    : { message: String(error) };

const emit = (level: Level, event: string, fields: Fields, alert = false): void => {
  const write = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (env.NODE_ENV === 'production') {
    write(
      JSON.stringify({
        time: new Date().toISOString(),
        level,
        event,
        ...(alert && { alert: true }),
        ...fields,
      })
    );
    return;
  }
  write(`[${alert ? 'ALERT ' : ''}${event}]`, fields);
};

export const logger = {
  info: (event: string, fields: Fields = {}) => emit('info', event, fields),
  warn: (event: string, fields: Fields = {}) => emit('warn', event, fields),
  error: (event: string, fields: Fields = {}) => emit('error', event, fields),
  alert: (event: string, fields: Fields = {}) => emit('error', event, fields, true),
};
