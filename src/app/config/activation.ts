import { ACTIVATION_PARAM, ENABLED_KEY } from 'shared/config/constants'
import { read, remove, write } from 'shared/api/storage'
import { createLogger } from 'shared/lib/log'

const log = createLogger('activation')

/** Значения параметра, которые выключают виджет и стирают запомненный флаг. */
const OFF_VALUES = new Set(['0', 'off', 'false'])

/**
 * Решает, должен ли виджет подняться на этой странице.
 *
 * Приоритет:
 *   1. ?kalka=0|off|false — выключить и забыть; виджет не поднимается
 *   2. ?kalka (любое другое значение) — включить и запомнить
 *   3. запомненный флаг в хранилище — поднять без параметра
 *   4. иначе — не подниматься
 *
 * Параметр `search` существует ради тестируемости: чистая функция от строки
 * запроса проверяется без подмены `location`. Прикладной код зовёт её без аргументов.
 */
export function shouldActivate(search: string = location.search): boolean {
  const params = new URLSearchParams(search)

  if (params.has(ACTIVATION_PARAM)) {
    const value = params.get(ACTIVATION_PARAM) ?? ''
    if (OFF_VALUES.has(value.trim().toLowerCase())) {
      remove(ENABLED_KEY)
      log.info('выключено параметром адреса')
      return false
    }
    write(ENABLED_KEY, '1')
    log.info('включено параметром адреса')
    return true
  }

  const remembered = read(ENABLED_KEY) === '1'
  log.debug('решение по запомненному флагу', { включено: remembered })
  return remembered
}
