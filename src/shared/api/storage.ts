import { STORAGE_PREFIX } from 'shared/config/constants'
import { createLogger } from 'shared/lib/log'

const log = createLogger('storage')

function key(name: string): string {
  return `${STORAGE_PREFIX}${name}`
}

// Здесь лежат ПРАВКИ ЗАКАЗЧИКА: снимок набора записей вместе с их текстом
// и имя рецензента. Значения в лог не попадают никогда — ни целиком, ни куском.
// В логе остаются ключ, признак наличия значения и его длина: этого достаточно,
// чтобы понять, что происходит с хранилищем, и недостаточно, чтобы прочитать
// в консоли чужую страницу и чужие замечания.

/** Читает значение. Недоступное хранилище — это `null`, а не исключение. */
export function read(name: string): string | null {
  try {
    const value = localStorage.getItem(key(name))
    log.debug('чтение', { ключ: key(name), есть: value !== null, длина: value?.length ?? 0 })
    return value
  } catch (error) {
    log.warn('хранилище недоступно при чтении', { ключ: key(name), ошибка: error })
    return null
  }
}

/** Пишет значение. Возвращает `false`, если записать не удалось. */
export function write(name: string, value: string): boolean {
  try {
    localStorage.setItem(key(name), value)
    log.debug('запись', { ключ: key(name), длина: value.length })
    return true
  } catch (error) {
    log.warn('хранилище недоступно при записи', { ключ: key(name), ошибка: error })
    return false
  }
}

/** Удаляет значение. Возвращает `false`, если удалить не удалось. */
export function remove(name: string): boolean {
  try {
    localStorage.removeItem(key(name))
    log.debug('удаление', { ключ: key(name) })
    return true
  } catch (error) {
    log.warn('хранилище недоступно при удалении', { ключ: key(name), ошибка: error })
    return false
  }
}
