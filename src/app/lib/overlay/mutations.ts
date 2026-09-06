import { ROOT_SELECTOR } from 'shared/config/constants'
import { createLogger } from 'shared/lib/log'

const log = createLogger('overlay:mutations')

export interface MutationWatcher {
  /** Полное снятие наблюдения. */
  stop(): void
  /** Отключить наблюдатель на время собственного прохода наложения. */
  suspend(): void
  /** Отбросить накопленное за время паузы и наблюдать снова. */
  resume(): void
}

/**
 * Наблюдение за перерисовкой носителя без смены маршрута.
 *
 * Носитель может перерисовать блок, не трогая адрес: подгрузил данные, раскрыл
 * аккордеон, переключил вкладку. Наложенная правка при этом стирается — и это
 * же наблюдение страхует эвристику «два кадра после готовности документа»
 * из `onHydrated`.
 *
 * Про повторный вход MDN предупреждает прямо: колбэк наблюдателя может вызвать
 * мутации, которые снова его разбудят. У нас это ГАРАНТИРОВАНО — переприменение
 * слоя и есть мутация DOM носителя.
 *
 * Фильтра «мутация не под корнем виджета» здесь НЕДОСТАТОЧНО, хотя образец
 * навыка ограничивается им: наложенный текст лежит в DOM носителя, а не под
 * host-элементом, поэтому собственный проход наложения выглядит как чужая
 * мутация и даёт бесконечный цикл. Отсюда пара suspend/resume: на время прохода
 * наблюдатель отключается, после прохода накопленные записи отбрасываются
 * через takeRecords(). Фильтр по корню виджета и дебаунс остаются второй линией.
 */
export function watchMutations(onChange: () => void): MutationWatcher {
  let active = false

  const observer = new MutationObserver((records) => {
    const foreign = records.some((record) => {
      const target =
        record.target.nodeType === Node.ELEMENT_NODE
          ? (record.target as Element)
          : record.target.parentElement
      return target ? !target.closest(ROOT_SELECTOR) : true
    })
    if (!foreign) return

    // Лог обязан быть дешёвым: колбэк вызывается часто, вся работа уходит
    // в дебаунсированное переприменение.
    log.debug('носитель перерисовал страницу', { записейМутаций: records.length })
    onChange()
  })

  function observe(): void {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      // attributes намеренно НЕ наблюдаются. MDN предупреждает о цене
      // subtree: true на большом дереве, и атрибуты — самый шумный её источник:
      // чужой роутер и анимации меняют классы постоянно. Нам нужны только
      // структура и текст, а собственную метку APPLIED_ATTRIBUTE наблюдать
      // и вовсе противопоказано — это прямой путь в цикл.
    })
    active = true
  }

  observe()

  return {
    stop(): void {
      observer.disconnect()
      active = false
    },

    suspend(): void {
      if (!active) return
      observer.disconnect()
      active = false
    },

    resume(): void {
      if (active) return
      // Записи, накопленные до disconnect и во время паузы, — наши собственные.
      // Без takeRecords() они пришли бы первым же колбэком после возобновления.
      observer.takeRecords()
      observe()
    },
  }
}
