import { createLogger } from 'shared/lib/log'
import { currentRoute } from 'shared/lib/route'
import { safely } from 'shared/lib/safe'

const log = createLogger('overlay:nav')

/** Снятие: возвращает пропатченные методы и снимает слушатели. */
export type StopWatching = () => void

/**
 * Базовый перехват клиентской навигации: патч History API плюс два события.
 *
 * `pushState` и `replaceState` — основной способ навигации SPA, и по MDN они
 * НЕ порождают `popstate`. Единственный способ узнать о них из стороннего
 * скрипта — обернуть их.
 *
 * Правила безопасного патча чужого объекта соблюдаются все пять:
 * оригинал сохранён и вызывается первым, его результат возвращается без
 * изменений, `this` пробрасывается через `apply`, наш код в `try` (обёртка
 * `safely` — NFR-06), снятие возвращает оригиналы на место.
 */
export function watchNavigation(onChange: () => void): StopWatching {
  const originalPush = history.pushState
  const originalReplace = history.replaceState

  const announce = (source: string): void => {
    log.debug('навигация', { источник: source, маршрут: currentRoute() })
    onChange()
  }

  // Обобщённый параметр здесь не нужен: у pushState и replaceState одна
  // сигнатура, и общий тип History['pushState'] описывает обе точно.
  type StateMethod = History['pushState']

  function wrap(original: StateMethod, source: string): StateMethod {
    const notify = safely(log, `навигация: ${source}`, () => announce(source))
    return function patched(this: History, ...args: Parameters<StateMethod>): void {
      // Сначала носитель: его навигация не имеет права зависеть от нашего кода.
      const result = original.apply(this, args)
      notify()
      return result
    }
  }

  history.pushState = wrap(originalPush, 'pushState')
  history.replaceState = wrap(originalReplace, 'replaceState')

  // Патч ловит только программную навигацию. Кнопки «назад»/«вперёд»
  // и history.back() через pushState не проходят — их ловит popstate.
  // Проверено на спайке R1: возврат «назад» дал ровно одно событие popstate
  // и ни одного pushState; слой, переприменяемый только по патчу, остался бы
  // на прежнем маршруте, то есть с правками чужой страницы поверх текущей.
  const onPopState = safely(log, 'popstate', () => announce('popstate'))
  // И наоборот: по MDN hashchange НЕ срабатывает, если хеш изменён через
  // pushState/replaceState, а прямая правка location.hash не проходит через
  // патченные методы. Два события покрывают разные пути; нужны оба.
  const onHashChange = safely(log, 'hashchange', () => announce('hashchange'))

  window.addEventListener('popstate', onPopState)
  window.addEventListener('hashchange', onHashChange)

  return (): void => {
    // Возврат оригиналов только если их всё ещё держим мы: чужой скрипт мог
    // пропатчить методы поверх нас, и затирать его патч мы не вправе.
    if (history.pushState !== originalPush) history.pushState = originalPush
    if (history.replaceState !== originalReplace) history.replaceState = originalReplace
    window.removeEventListener('popstate', onPopState)
    window.removeEventListener('hashchange', onHashChange)
  }
}

/** Минимум Navigation API, которым здесь пользуемся. */
interface NavigationLike {
  addEventListener(type: 'navigate', listener: () => void): void
  removeEventListener(type: 'navigate', listener: () => void): void
}

/**
 * База плюс Navigation API там, где он есть.
 *
 * Именно в таком порядке: база — патч History API, Navigation API — сверху.
 * Наоборот нельзя. «Baseline newly available» означает поддержку в актуальных
 * версиях браузеров, а рецензент по PRD часто работает на корпоративной машине,
 * где браузер обновляют не сразу; на ней виджет пошёл бы по менее проверенному
 * пути.
 *
 * Двойное срабатывание (и патч, и `navigate`) безвредно: переприменение
 * идемпотентно и защищено дебаунсом.
 *
 * ВАЖНО: событие `navigate` приходит ДО смены `location` — проверено на спайке
 * R1, где обработчик, читавший `location.pathname`, получал старый адрес
 * и записывал девять переходов «/ → /» подряд. Поэтому обработчик здесь адрес
 * НЕ читает, а только просит переприменить слой: актуальный маршрут движок
 * возьмёт позже, уже после дебаунса.
 */
export function watchNavigationEnhanced(onChange: () => void): StopWatching {
  const stopBase = watchNavigation(onChange)

  if (!('navigation' in window)) return stopBase

  const navigation = (window as unknown as { navigation: NavigationLike }).navigation
  const onNavigate = safely(log, 'navigate', () => onChange())

  try {
    navigation.addEventListener('navigate', onNavigate)
  } catch (error) {
    log.warn('Navigation API не подключился, работает базовый перехват', { ошибка: error })
    return stopBase
  }

  log.info('Navigation API подключён как дополнение к патчу History API')

  return (): void => {
    try {
      navigation.removeEventListener('navigate', onNavigate)
    } catch (error) {
      log.warn('не удалось снять слушатель Navigation API', { ошибка: error })
    }
    stopBase()
  }
}
