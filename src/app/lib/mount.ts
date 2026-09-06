import { render } from 'preact'
import type { VNode } from 'preact'
import { ROOT_ATTRIBUTE, TOP_LAYER_Z_INDEX } from 'shared/config/constants'
import { createLogger } from 'shared/lib/log'
import { safely } from 'shared/lib/safe'
import styles from '../ui/host.css?inline'

const log = createLogger('mount')

/**
 * Стили в shadow root.
 *
 * Основной путь — adoptedStyleSheets: браузер парсит таблицу один раз, и она
 * не участвует в дереве. Запасной путь — элемент <style>: конструируемые таблицы
 * есть не везде (в частности, их нет в jsdom, на котором идут наши тесты),
 * а падать из-за стилей виджет не имеет права.
 */
function applyStyles(shadow: ShadowRoot, css: string): void {
  const supported =
    typeof CSSStyleSheet === 'function' &&
    'replaceSync' in CSSStyleSheet.prototype &&
    'adoptedStyleSheets' in shadow

  if (supported) {
    try {
      const sheet = new CSSStyleSheet()
      sheet.replaceSync(css)
      shadow.adoptedStyleSheets = [sheet]
      log.debug('стили через adoptedStyleSheets')
      return
    } catch (error) {
      log.warn('adoptedStyleSheets не сработали, запасной путь', { ошибка: error })
    }
  }

  const style = document.createElement('style')
  style.textContent = css
  shadow.appendChild(style)
  log.debug('стили через элемент style')
}

/**
 * Создаёт host-элемент, изолирует интерфейс и монтирует его.
 * Возвращает полный демонтаж.
 *
 * Принимает готовый `VNode`, а не импортирует `Root`: так файл остаётся `.ts`
 * без JSX, как записано в ARCHITECTURE.md, и не тянет за собой слой `ui`.
 * О `window.__kalka` этот модуль не знает вовсе — им владеет `app/index.ts`.
 */
export function mountKalka(view: VNode): () => void {
  const host = document.createElement('div')
  host.setAttribute(ROOT_ATTRIBUTE, '')
  const mountPoint = document.createElement('div')
  mountPoint.className = 'kalka-root'
  const BOUNDARY_EVENTS = ['pointerdown', 'mousedown', 'click'] as const
  const stop = safely(log, 'событие интерфейса', (event: Event) => event.stopPropagation())
  let listenersAttached = false
  let renderStarted = false
  let disposed = false

  // Внешнее author-правило с !important сильнее обычного inline-стиля. Поэтому
  // критические свойства получают тот же приоритет: inline !important выигрывает
  // у общих правил носителя и не даёт им сдвинуть или спрятать интерфейс.
  //
  // ⚠ ЗАВИСИМОСТЬ, О КОТОРОЙ НАДО ПОМНИТЬ ПРИ ПРАВКЕ ЭТОГО СПИСКА.
  // Слой меток (`widgets/mark-layer`) лежит ВНУТРИ host и позиционируется
  // `position: fixed; inset: 0` от вьюпорта — то есть на всю страницу, а не
  // на угловую панель. Так он работает только потому, что у host нет ни
  // `transform`, ни `filter`, ни `will-change`: любое из этих трёх свойств
  // создаёт новый контейнер для фиксированных потомков, и слой меток
  // схлопнется в размер панели в правом нижнем углу.
  // Появилась нужда в анимации host — метки переезжают в собственный
  // host-элемент, а не «пробуются, вдруг обойдётся» (решение 8 плана вехи
  // «Область и Указатель»).
  const hostStyles = [
    ['all', 'initial'],
    ['display', 'block'],
    ['position', 'fixed'],
    ['right', '16px'],
    ['bottom', '16px'],
    ['z-index', String(TOP_LAYER_Z_INDEX)],
  ] as const
  for (const [property, value] of hostStyles) {
    host.style.setProperty(property, value, 'important')
  }

  function teardown(): void {
    if (disposed) return
    disposed = true

    if (listenersAttached) {
      for (const type of BOUNDARY_EVENTS) mountPoint.removeEventListener(type, stop)
    }

    if (renderStarted) {
      try {
        render(null, mountPoint)
      } catch (error) {
        // Демонтаж остаётся безопасной границей: host всё равно удаляется.
        log.error('не удалось размонтировать дерево Preact', { ошибка: error })
      }
    }

    host.remove()
  }

  try {
    // host вешается прямо на document.body: контекст наложения, созданный
    // носителем на промежуточном контейнере (transform, filter, opacity < 1,
    // will-change), запер бы виджет внутри себя, и z-index не помог бы.
    document.body.appendChild(host)

    // mode: 'open', а не 'closed': закрытый режим не даёт безопасности,
    // зато ломает отладку и наш собственный обход DOM.
    const shadow = host.attachShadow({ mode: 'open' })
    applyStyles(shadow, styles)

    // Класс обязателен: базовая типографика и box-sizing живут на .kalka-root,
    // а не на :host — инлайновый all: initial на host перебивает правила :host
    // (см. комментарий в app/ui/host.css).
    shadow.appendChild(mountPoint)

    // События интерфейса не должны срабатывать на обработчиках носителя: они
    // композитные и всплывают до document. Одного click мало — страницы закрывают
    // меню, модальные окна и поповеры по «нажатию снаружи», а его ловят на
    // pointerdown или mousedown, то есть раньше, чем случится click.
    // stopPropagation — да, preventDefault — нет: он сломает фокус и ввод с клавиатуры.
    for (const type of BOUNDARY_EVENTS) mountPoint.addEventListener(type, stop)
    listenersAttached = true

    renderStarted = true
    render(view, mountPoint)
    log.info('виджет смонтирован')
  } catch (error) {
    // Монтирование транзакционно: частичный host не остаётся в чужом DOM.
    teardown()
    throw error
  }

  return (): void => {
    teardown()
    log.info('виджет размонтирован')
  }
}
