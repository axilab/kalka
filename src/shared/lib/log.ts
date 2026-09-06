/**
 * Логгер разработки.
 *
 * В продакшен-сборке `import.meta.env.DEV` заменяется на `false`, ветка с console
 * удаляется минификатором целиком, и в бандле не остаётся ни одного вызова console
 * (проверяется scripts/check-bundle.mjs).
 */

type Fields = Readonly<Record<string, unknown>>

export interface Logger {
  debug(message: string, fields?: Fields): void
  info(message: string, fields?: Fields): void
  warn(message: string, fields?: Fields): void
  error(message: string, fields?: Fields): void
  /** Дочерний логгер с уточнённой областью: `mount` → `mount:styles`. */
  child(scope: string): Logger
}

const SILENT: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => SILENT,
}

function verbose(scope: string): Logger {
  const at =
    (level: 'debug' | 'info' | 'warn' | 'error') =>
    (message: string, fields?: Fields): void => {
      const prefix = `[kalka:${scope}]`
      if (fields === undefined) console[level](prefix, message)
      else console[level](prefix, message, fields)
    }

  return {
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    child: (suffix) => verbose(`${scope}:${suffix}`),
  }
}

export function createLogger(scope: string): Logger {
  return import.meta.env.DEV ? verbose(scope) : SILENT
}
