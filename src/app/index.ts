import { h } from 'preact'
import { shouldActivate } from 'app/config/activation'
import { mountKalka } from 'app/lib/mount'
import { startOverlay } from 'app/lib/overlay/engine'
import { Root } from 'app/ui/Root'
import { startUnsavedGuard } from 'features/export-entries'
import { entryStore, restoreEntries, startPersist } from 'entities/entry'
import type { Entry } from 'shared/model/format'
import { onDocumentReady } from 'shared/lib/dom'
import { createLogger } from 'shared/lib/log'

const log = createLogger('boot')

function start(): void {
  // Восстановление идёт ПЕРВЫМ — до монтирования интерфейса и до подъёма слоя.
  // Раньше отрисовки: иначе счётчик правок в панели мигнёт нулём и только потом
  // покажет настоящее число. Раньше первого прохода наложения: иначе слой ляжет
  // пустым и переприменится только по следующей мутации носителя, то есть
  // рецензент увидит страницу без своих правок на неопределённое время.
  //
  // Свой try/catch: отказ восстановления не имеет права уронить виджет.
  // Рецензент останется с чистым набором, но с работающей панелью (NFR-06).
  try {
    restoreEntries()
  } catch (error) {
    log.error('не удалось восстановить сохранённые правки', { ошибка: error })
  }

  // Запись поднимается сразу после восстановления и тоже в своём try/catch:
  // она запоминает ревизию набора на старте, и подъём до восстановления
  // заставил бы её записать обратно то, что оттуда только что прочитали.
  let stopPersist = (): void => {}
  try {
    stopPersist = startPersist()
  } catch (error) {
    log.error('не удалось включить сохранение правок', { ошибка: error })
  }

  // Вопрос браузера при закрытии вкладки с неэкспортированными правками
  // (FR-26). Единственное место, где виджет намеренно меняет поведение чужой
  // страницы, — и потому снятие ниже обязательно, а не желательно.
  let stopGuard = (): void => {}
  try {
    stopGuard = startUnsavedGuard()
  } catch (error) {
    log.error('не удалось включить вопрос при закрытии вкладки', { ошибка: error })
  }

  const unmount = mountKalka(h(Root, {}))

  // Слой поднимается ПОСЛЕ интерфейса и в своём try/catch: отказ движка
  // наложения не имеет права уронить уже смонтированный виджет — рецензент
  // останется с работающей панелью, просто без правок на странице.
  let stopOverlay = (): void => {}
  try {
    stopOverlay = startOverlay()
    log.info('слой правок поднят')
  } catch (error) {
    log.error('не удалось поднять слой правок, виджет работает без него', { ошибка: error })
  }

  // Демонтаж снимает и глобальное свойство: иначе страница после unmount()
  // отличается от исходной, а повторный подъём виджета навсегда заблокирован
  // проверкой двойного подключения.
  const api: NonNullable<Window['__kalka']> = {
    version: __VERSION__,
    unmount: () => {
      // Снятие записи — ПЕРЕД снятием слоя: оно сбрасывает отложенный снимок
      // в хранилище, и сделать это надо раньше, чем что-либо начнёт
      // разбираться. Иначе правка, сделанная за миг до демонтажа, теряется.
      try {
        stopPersist()
      } catch (error) {
        log.error('сбой при снятии сохранения правок', { ошибка: error })
      }

      // Снимается в любом случае: оставленный beforeunload переживёт демонтаж
      // и продолжит переспрашивать у заказчика на каждое закрытие вкладки.
      try {
        stopGuard()
      } catch (error) {
        log.error('сбой при снятии вопроса о закрытии вкладки', { ошибка: error })
      }

      // Порядок снятия: сперва слой, затем интерфейс. Снятие слоя возвращает
      // страницу и методы history в исходное состояние и при этом ещё может
      // писать в лог — интерфейс ему для этого не нужен, а обратный порядок
      // оставил бы правки в чужом DOM на лишний такт.
      try {
        stopOverlay()
        log.info('слой правок снят')
      } catch (error) {
        // Демонтаж обязан дойти до конца: интерфейс снимается в любом случае.
        log.error('сбой при снятии слоя правок', { ошибка: error })
      }
      unmount()
      // Старая сохранённая ссылка не имеет права удалить более новый экземпляр.
      if (window.__kalka === api) delete window.__kalka
    },
    // Ветка целиком вырезается минификатором в продакшен-сборке: import.meta.env.DEV
    // заменяется на false, и поля seed в отгружаемом бандле не остаётся.
    //
    // С вехи «Хранение и экспорт» подсунутые стендом записи попадают и
    // в localStorage: seed поднимает ревизию набора, а её слушает запись
    // снимка. На стендах это полезно — так проверяется, что правка переживает
    // перезагрузку, — но означает, что после экспериментов хранилище стенда
    // надо чистить, иначе фикстуры прошлого прогона всплывут в следующем.
    ...(import.meta.env.DEV
      ? { seed: (entries: unknown[]) => entryStore.seed(entries as Entry[]) }
      : {}),
  }
  window.__kalka = api
}

function boot(): void {
  if (window.__kalka) {
    log.warn('скрипт подключён дважды, вторая загрузка пропущена')
    return
  }

  if (!shouldActivate()) {
    log.debug('виджет не включён — ничего не делаем')
    return
  }

  let cancelReady = (): void => {}
  const reservation: NonNullable<Window['__kalka']> = {
    version: __VERSION__,
    unmount: () => {
      cancelReady()
      if (window.__kalka === reservation) delete window.__kalka
    },
  }

  // Признак занятости ставится ЗДЕСЬ, синхронно, а не после монтирования:
  // оба тега <script> в <head> отрабатывают раньше DOMContentLoaded, и позднее
  // выставление признака вернуло бы два виджета на одну страницу.
  // Временный unmount не пустой: до DOMContentLoaded он отменяет отложенный запуск.
  window.__kalka = reservation

  try {
    cancelReady = onDocumentReady(() => {
      // Отменённая или заменённая reservation не имеет права монтировать виджет.
      if (window.__kalka !== reservation) return

      try {
        start()
      } catch (error) {
        // Неудачная загрузка не должна блокировать следующую, исправную.
        if (window.__kalka === reservation) delete window.__kalka
        // Сайт-носитель продолжает работать (NFR-06). Наружу — ничего (NFR-03).
        log.error('не удалось поднять виджет', { ошибка: error })
      }
    })
  } catch (error) {
    // Ошибка самой постановки ожидания тоже снимает только нашу reservation.
    if (window.__kalka === reservation) delete window.__kalka
    throw error
  }
}

// Файл намеренно ничего не экспортирует: пока точке входа нечего экспортировать,
// Rollup не заводит глобальную переменную Kalka, и виджет не пишет в window
// ничего, кроме window.__kalka после успешной активации.
try {
  boot()
} catch (error) {
  log.error('сбой при загрузке', { ошибка: error })
}
