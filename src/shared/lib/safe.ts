import type { Logger } from 'shared/lib/log'

/**
 * Обёртка границы с чужим кодом: обработчика события, колбэка наблюдателя,
 * пропатченного метода носителя. Исключение не уходит наружу (NFR-06).
 *
 * Функции, результат которых нужен вызывающему, оборачивать нельзя:
 * обёртка возвращает `void` и намеренно не подавляет ошибку молча.
 */
export function safely<A extends unknown[]>(
  log: Logger,
  label: string,
  run: (...args: A) => void,
): (...args: A) => void {
  return (...args: A): void => {
    try {
      run(...args)
    } catch (error) {
      log.error(`сбой на границе: ${label}`, { ошибка: error })
    }
  }
}
