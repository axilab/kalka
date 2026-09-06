import { applyStatus } from 'entities/anchor'
import { entryStore, sanitizeHtml } from 'entities/entry'
import type { Entry } from 'shared/model/format'
import type { AnchorMethod, EntryStatus } from 'shared/model/layer'
import { APPLIED_ATTRIBUTE, REAPPLY_DEBOUNCE_MS, TARGET_ATTRIBUTE } from 'shared/config/constants'
import { debounce } from 'shared/lib/debounce'
import { clearScrollTarget, onHydrated } from 'shared/lib/dom'
import { createLogger } from 'shared/lib/log'
import { currentRoute } from 'shared/lib/route'
import { safely } from 'shared/lib/safe'
import { watchNavigationEnhanced } from './navigation'
import { watchMutations } from './mutations'
import type { MutationWatcher } from './mutations'

const log = createLogger('overlay:engine')

/** Причина очередного переприменения — только для лога. */
type Reason = 'первое наложение' | 'навигация' | 'мутация' | 'изменение хранилища'

/** Сводка прохода: то, что попадает в лог вместо текста правок. */
interface Summary {
  applied: number
  drifted: number
  lost: number
  foreign: number
}

/**
 * Наблюдатель на время прохода. Модульная переменная, а не параметр: проход
 * запускается из четырёх мест, и протаскивать наблюдатель через каждое из них
 * значило бы делать `applyLayer` неудобной ради одной строки.
 */
let watcher: MutationWatcher | null = null

/*
 * Память наложенного: `id` записи → её `wasHtml` на момент наложения.
 *
 * Нужна ровно для одного случая — запись УДАЛИЛИ. Проход `applyLayer` обходит
 * существующие записи, а у удалённой записи нет: помеченный элемент остался бы
 * на странице с чужим текстом и с меткой навсегда, и FR-11 («текст возвращается
 * к оригиналу») не выполнялся бы. Восстановить из самой записи уже нечем —
 * её нет, поэтому оригинал держит здесь тот, кто след и оставил.
 *
 * Хранилище при этом не обрастает «отложенно удалёнными» записями: уборка
 * следов — задача движка, а не файла обмена.
 */
const appliedHtml = new Map<string, string>()

/** Атрибут собственного элемента <style> движка: по нему он и снимается. */
const HIGHLIGHT_ATTRIBUTE = 'data-kalka-highlight'

/*
 * Собственный элемент <style> движка наложения.
 *
 * Правило носителя не трогается вовсе: подсветка приходит собственным
 * элементом <style>, который движок создаёт и удаляет сам. Свойство везде —
 * `outline`, а не `border` и не `background`: outline не занимает места
 * и не сдвигает вёрстку носителя, а сдвинуть её виджет не имеет права.
 *
 * Элемент живёт в <head>, куда наблюдатель мутаций не смотрит (он наблюдает
 * document.body), — собственная подсветка не будит переприменение. Атрибуты
 * им тоже не наблюдаются (`mutations.ts`), поэтому и постановка
 * `data-kalka-target` на чужой элемент слой не будит.
 *
 * ── Элемент живёт, ПОКА ПОДНЯТ СЛОЙ ─────────────────────────────────────────
 *
 * Правило в нём осталось ровно одно — подсветка ЦЕЛИ прокрутки (FR-31, куда
 * только что перешли из списка разбора), — и она нужна всё время, пока слой
 * поднят. Второе правило, пунктир вокруг изменённых мест по тумблеру FR-22,
 * снято: тумблер управляет теперь подчёркиваниями в теневом слое (см. ниже).
 * Снятие элемента остаётся в `revertLayer`: страница после демонтажа обязана
 * быть неотличима от исходной.
 */

/*
 * ── Подсветки изменённых мест здесь БОЛЬШЕ НЕТ, и это решение, а не пропуск ──
 *
 * Правило `[data-kalka-applied]{outline:2px dashed …}` рисовало пунктир вокруг
 * каждого применённого места по тумблеру FR-22. Теперь то же самое множество
 * помечает слой меток — корректорским подчёркиванием под правкой текста
 * (`widgets/mark-layer`), и тумблер FR-22 управляет видимостью именно его.
 *
 * Оставить оба значило бы рисовать одно место дважды: пунктир вокруг абзаца
 * и подчёркивание под ним — про одну и ту же правку и по одному и тому же
 * тумблеру.
 *
 * Из двух убрано именно это правило, а не подчёркивание. Причины:
 * — подчёркивание живёт в своём теневом слое, а правило уезжало в <head>
 *   НОСИТЕЛЯ: одно место, где виджет трогает чужую страницу, стало нулём;
 * — подчёркивание получает сквозной номер и связывает метку со строкой списка,
 *   а обводка атрибутом номера нести не может;
 * — `style-wish` атрибута `data-kalka-applied` не получает вовсе — пожелание
 *   оформления на страницу не накладывается, — и правило его не показывало.
 *
 * Сам атрибут APPLIED_ATTRIBUTE остаётся: по нему движок находит уже
 * наложенные элементы и снимает их при демонтаже.
 */

/*
 * Подсветка цели прокрутки (FR-31).
 *
 * Цвет — литерал по той же причине, что и выше. Источник значения —
 * --kalka-redline (#c8362a).
 *
 * Сплошная линия против пунктира FR-22: «вот сюда я прокрутил» и «здесь есть
 * правка» не имеют права выглядеть одинаково — иначе на странице с десятком
 * правок цель теряется среди них.
 *
 * ── Второй признак: ЗАЛИВКА против голого контура ───────────────────────────
 *
 * Обводка наведения (`shared/lib/dom.ts`, HOVER_CSS) теперь того же красного:
 * виджет обязан метить своё одним цветом. После переезда инструментов на рейку
 * выбор инструмента перестаёт зависеть от режима, и сочетание «выбран «Текст»
 * + прокрутка к записи из списка» становится достижимым — то есть цель
 * и наведение способны оказаться на экране вместе. Разницы в один пиксель
 * обводки для этого мало: на чужой вёрстке её не считают.
 *
 * Поэтому у цели есть заливка, а у наведения её нет. Контур говорит «это
 * возьмётся, если нажать», заливка — «вот оно, я привёл». Различие читается
 * на монохромном экране и не зависит от толщины линии. Заливка полупрозрачна
 * и держится доли секунды, вёрстку носителя не сдвигает и снимается вместе
 * с атрибутом и элементом <style> в `revertLayer` (NFR-06).
 */
const TARGET_CSS = `[${TARGET_ATTRIBUTE}]{outline:3px solid rgba(200,54,42,.9);outline-offset:3px;background-color:rgba(200,54,42,.12)}`

/**
 * Приводит собственный `<style>` к нужному состоянию.
 *
 * `alive` — поднят ли слой вообще. Правило в нём теперь ровно одно — подсветка
 * цели прокрутки (FR-31), — и оно нужно всё время, пока слой поднят. Флага
 * подсветки изменений здесь больше нет: тумблер FR-22 управляет метками
 * в теневом слое, а не правилом в чужом `<head>` (см. выше).
 */
function syncStyle(root: Document, alive: boolean): void {
  const existing = root.querySelector(`style[${HIGHLIGHT_ATTRIBUTE}]`)

  if (!alive) {
    if (existing) {
      existing.remove()
      log.debug('собственный <style> снят вместе со слоем')
    }
    return
  }

  if (existing) return

  const style = root.createElement('style')
  style.setAttribute(HIGHLIGHT_ATTRIBUTE, '')
  style.textContent = TARGET_CSS
  // head может отсутствовать на экзотической странице — тогда подсветки
  // просто не будет, и ронять из-за неё наложение слоя нельзя.
  root.head?.appendChild(style)
  log.debug('собственный <style> поднят')
}

/** Уже наложенные элементы на текущей странице, найденные по метке. */
function findApplied(id: string, root: Document): Element | null {
  return root.querySelector(`[${APPLIED_ATTRIBUTE}="${CSS.escape(id)}"]`)
}

/**
 * Возвращает элемент к исходному виду из `wasHtml`.
 *
 * Источник истины — запись, а не снимок DOM: снимок теряется при перерисовке
 * носителя, а `wasHtml` есть всегда. Отсюда же идемпотентность наложения —
 * оно всегда «вернуть wasHtml, затем записать now», сколько бы раз ни вызвали.
 */
function restore(el: Element, entry: Entry, root: Document): void {
  el.replaceChildren(sanitizeHtml(entry.wasHtml, root))
}

/** Пишет текст правки в элемент. Разметка проходит белый список (решение 8). */
function write(el: Element, entry: Entry, root: Document): void {
  el.replaceChildren(sanitizeHtml(entry.now, root))
}

/**
 * Убирает следы записей, которых на этом проходе уже не было.
 *
 * Два законных повода: запись удалили из хранилища (FR-11) и запись сменила тип
 * на не-`text-override` — например, рецензент оставил на месте только пожелание
 * по оформлению. В обоих случаях помеченный элемент обязан вернуться
 * к оригиналу: иначе разжалованная запись оставила бы прежний текст на странице
 * навсегда, а удалённая — навсегда и метку.
 *
 * Возвращает число возвращённых элементов по каждой причине.
 */
function sweepStaleMarks(root: Document): { удалена: number; типИзменён: number } {
  const swept = { удалена: 0, типИзменён: 0 }

  for (const el of root.querySelectorAll(`[${APPLIED_ATTRIBUTE}]`)) {
    const id = el.getAttribute(APPLIED_ATTRIBUTE)
    if (id === null) continue

    const entry = entryStore.get(id)
    const reason = !entry ? 'удалена' : entry.type !== 'text-override' ? 'типИзменён' : null
    if (reason === null) continue

    // Оригинал берётся из живой записи, если она есть, и из памяти движка,
    // если записи уже нет. Второй путь — единственный для удалённой правки.
    const original = entry ? entry.wasHtml : appliedHtml.get(id)
    if (original !== undefined) el.replaceChildren(sanitizeHtml(original, root))
    el.removeAttribute(APPLIED_ATTRIBUTE)
    appliedHtml.delete(id)
    swept[reason] += 1
  }

  return swept
}

/**
 * Один проход наложения слоя. Идемпотентен: повторный вызов на уже наложенном
 * слое ничего не меняет и ничего не ломает.
 */
export function applyLayer(root: Document = document): Summary {
  // Собственные мутации не имеют права разбудить наблюдатель: наложенный текст
  // лежит в DOM носителя, и для наблюдателя наш проход неотличим от чужого.
  watcher?.suspend()

  const route = currentRoute()
  const showOriginal = entryStore.showOriginal()
  const summary: Summary = { applied: 0, drifted: 0, lost: 0, foreign: 0 }
  let firstLost: string | null = null

  try {
    // Маршрут публикуется в хранилище здесь, где он уже вычислен: слой меток
    // обязан узнавать о клиентской навигации, а завести второй перехват History
    // API поверх нашего же нельзя — снимать два патча в правильном порядке
    // не получится (решение 12 плана вехи «Область и Указатель»).
    //
    // Внутри try, а не до него: setRoute уведомляет подписчиков, то есть
    // выполняет чужие обработчики, и исключение в любом из них оставило бы
    // наблюдатель мутаций усыплённым навсегда.
    entryStore.setRoute(route)

    for (const entry of entryStore.list()) {
      // Запись чужой страницы — это НЕ потерянная запись. Смешивать их
      // запрещено: «правка для другой страницы» не требует внимания человека,
      // «правка, потерявшая место» требует. Статус такой записи не трогаем.
      if (entry.route !== route) {
        summary.foreign += 1
        // Но и оставлять её наложенной нельзя. Клиентская навигация меняет
        // адрес, не перезагружая документ, и элемент с нашей меткой переживает
        // смену маршрута: без этой уборки на новой странице остались бы правки
        // предыдущей — ровно то, ради чего в перехвате слушается popstate.
        const stale = findApplied(entry.id, root)
        if (stale) {
          restore(stale, entry, root)
          stale.removeAttribute(APPLIED_ATTRIBUTE)
        }
        continue
      }

      // Сначала метка, и только потом три уровня (решение 2). После наложения
      // текст элемента равен `now`, и повторная сверка `was` его отвергла бы:
      // исправная правка спустилась бы на третий уровень и получила «уехала».
      // Без этого правила переприменение ломает само себя.
      const marked = findApplied(entry.id, root)
      let status: EntryStatus
      let method: AnchorMethod | undefined
      // Найденный элемент публикуется в хранилище вместе со статусом: по нему
      // список разбора прокручивает страницу к месту правки (решение 13 плана
      // вехи). При статусе `lost` элемента нет, и поле остаётся пустым.
      let element: Element | undefined

      if (marked) {
        // Метку ставим только мы и только после успешного наложения, поэтому
        // прежний статус сохраняется как есть: пересчитывать его не по чему —
        // текст элемента сейчас равен `now`, а не `was`.
        const previous = entryStore.statusOf(entry.id)
        status = previous?.status ?? 'applied'
        method = previous?.method
        element = marked
        applyToElement(marked, entry, root, showOriginal)
      } else {
        const found = applyStatus(entry, root)
        status = found.status
        method = found.method
        element = found.element
        if (found.element) applyToElement(found.element, entry, root, showOriginal)
      }

      summary[status] += 1
      if (status === 'lost' && firstLost === null) firstLost = entry.id
      entryStore.setStatus(entry.id, status, method, element)
    }

    // Уборка следов — ПОСЛЕ обхода записей: на этом месте уже точно известно,
    // какие метки остались без своей действующей записи (решение 14).
    const swept = sweepStaleMarks(root)
    if (swept.удалена || swept.типИзменён) {
      log.debug('следы правок убраны', swept)
    }

    // Свой <style> держится ВСЁ ВРЕМЯ, пока поднят слой: в нём живёт правило
    // подсветки цели прокрутки (FR-31), нужное и в режиме «оригинал» — именно
    // там человек ищет уехавшее место руками. Флагом FR-22 управляется только
    // второе правило: в режиме «оригинал» меток на странице нет и подсвечивать
    // изменения нечего, но сам флаг при этом не сбрасывается — вернувшись
    // к правкам, рецензент застанет подсветку включённой.
    syncStyle(root, true)
  } finally {
    watcher?.resume()
  }

  if (firstLost !== null) {
    log.warn('на этом маршруте есть правка без своего места', {
      маршрут: route,
      id: firstLost,
      потеряно: summary.lost,
    })
  }

  return summary
}

/**
 * Приводит один элемент к нужному состоянию.
 *
 * Записи типов `style-wish` и `comment` в DOM не применяются НИКОГДА — только
 * получают статус (PRD, «Границы»: автоприменение этих типов не входит
 * в продукт). Для них элемент остаётся нетронутым и метка не ставится.
 *
 * Если метка на элементе всё-таки есть — запись была `text-override` и её
 * разжаловали, — снимает её не эта функция, а `sweepStaleMarks` в конце
 * прохода: у уборки следов один вход, и второй завёлся бы только для того,
 * чтобы со временем разъехаться с первым.
 */
function applyToElement(
  el: Element,
  entry: Entry,
  root: Document,
  showOriginal: boolean,
): void {
  if (entry.type !== 'text-override') return

  // Всегда сперва оригинал: так проход остаётся идемпотентным, а выключенный
  // слой возвращает страницу к исходному виду тем же кодом.
  restore(el, entry, root)

  if (showOriginal) {
    el.removeAttribute(APPLIED_ATTRIBUTE)
    return
  }

  write(el, entry, root)
  el.setAttribute(APPLIED_ATTRIBUTE, entry.id)
  // Запоминаем оригинал ровно в момент, когда след оставлен: если запись потом
  // удалят, восстанавливать будет уже неоткуда (решение 14).
  appliedHtml.set(entry.id, entry.wasHtml)
}

/**
 * Снимает слой: все помеченные элементы возвращаются к `wasHtml`, метки
 * снимаются. Вызывается при демонтаже виджета — страница обязана вернуться
 * к исходному виду.
 */
export function revertLayer(root: Document = document): void {
  watcher?.suspend()
  let reverted = 0

  // Собственный <style> уходит вместе со слоем: снятие виджета обязано вернуть
  // страницу в исходное состояние целиком, а не только её текст.
  syncStyle(root, false)
  // Вместе с ним — подсветка цели прокрутки: атрибут стоит на ЧУЖОМ элементе,
  // и без правила он невидим, но остался бы в разметке носителя навсегда.
  clearScrollTarget()

  try {
    for (const el of root.querySelectorAll(`[${APPLIED_ATTRIBUTE}]`)) {
      const id = el.getAttribute(APPLIED_ATTRIBUTE)
      const entry = id === null ? undefined : entryStore.get(id)
      // Запись могли удалить, пока элемент был на странице: тогда оригинал
      // берётся из памяти движка. Метку снимаем в любом случае, иначе она
      // останется в чужом DOM после демонтажа.
      const original = entry ? entry.wasHtml : id === null ? undefined : appliedHtml.get(id)
      if (original !== undefined) el.replaceChildren(sanitizeHtml(original, root))
      el.removeAttribute(APPLIED_ATTRIBUTE)
      reverted += 1
    }
    // Память живёт ровно столько же, сколько слой: слой снят — восстанавливать
    // больше нечего и не из чего.
    appliedHtml.clear()
  } finally {
    watcher?.resume()
  }

  log.debug('слой снят', { возвращеноЭлементов: reverted })
}

/**
 * Поднимает движок наложения. Возвращает полное снятие.
 *
 * Всё, что пересекает границу с носителем, обёрнуто `safely`: исключение
 * виджета не имеет права уйти в код носителя (NFR-06).
 */
export function startOverlay(): () => void {
  let first = true

  const pass = (reason: Reason): void => {
    const summary = applyLayer()
    const fields = {
      маршрут: currentRoute(),
      причина: reason,
      наложено: summary.applied,
      уехало: summary.drifted,
      потеряно: summary.lost,
      чужойМаршрут: summary.foreign,
    }
    if (first) {
      first = false
      log.info('слой наложен впервые', fields)
    } else {
      log.debug('слой переприменён', fields)
    }
  }

  // Причина последнего запроса на переприменение: дебаунс схлопывает пачку
  // событий в один проход, и в лог должно попасть то, что его вызвало.
  let pending: Reason = 'первое наложение'
  const reapply = debounce(
    safely(log, 'переприменение слоя', () => pass(pending)),
    REAPPLY_DEBOUNCE_MS,
  )

  const request = (reason: Reason): void => {
    pending = reason
    reapply()
  }

  watcher = watchMutations(() => request('мутация'))
  const stopNavigation = watchNavigationEnhanced(() => request('навигация'))
  const stopStore = entryStore.subscribe(() => request('изменение хранилища'))

  // Первое наложение — после готовности документа и двух кадров: правка,
  // наложенная до конца гидрации, будет стёрта фреймворком носителя.
  const cancelHydrated = onHydrated(safely(log, 'первое наложение', () => pass('первое наложение')))

  return (): void => {
    cancelHydrated()
    reapply.cancel()
    stopStore()
    stopNavigation()
    watcher?.stop()
    // revertLayer после stop(): наблюдатель уже снят, будить его нечем.
    watcher = null
    revertLayer()
  }
}
