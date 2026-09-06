import { entryStore } from 'entities/entry'
import { VERIFY_DEBOUNCE_MS } from 'shared/config/constants'
import { debounce } from 'shared/lib/debounce'
import { createLogger } from 'shared/lib/log'
import { safely } from 'shared/lib/safe'
import { runVerifyPass } from './check'
import type { VerifySummary } from './check'

const log = createLogger('verify:mode')

/*
 * Вход в режим проверки и выход из него (FR-35).
 *
 * ── Включение проверки ВЫКЛЮЧАЕТ слой правок, и это не побочный эффект ────────
 *
 * Проверка отвечает на вопрос «что сейчас в исходниках», а слой показывает
 * «что просил заказчик». Держать их одновременно значит показывать человеку
 * красную строку «не доехало» рядом с уже исправленным текстом на экране —
 * то есть заставлять его не верить собственным глазам.
 *
 * Поэтому вход ставит `setShowOriginal(true)`, выход возвращает прежнее
 * значение. Побочный эффект тут ПОЛЕЗНЫЙ: при выключенном слое `applyToElement`
 * возвращает элементу `wasHtml` и снимает метку, то есть страница показывает
 * ровно то, что отдал носитель, — и все три исхода читаются с экрана глазами.
 */

/**
 * Поднимает режим проверки. Возвращает полное снятие.
 *
 * Первый проход — СРАЗУ после подписки, а не по первому уведомлению: иначе
 * включённая проверка на неподвижной странице не показала бы ничего, и человек
 * решил бы, что кнопка сломалась.
 *
 * Пересчёт дебаунсирован собственной константой `VERIFY_DEBOUNCE_MS`.
 * `REAPPLY_DEBOUNCE_MS` не переиспользуется по той же причине, по которой
 * заведён `PERSIST_DEBOUNCE_MS`: связать их одним числом значит однажды
 * поменять поведение наложения, правя поведение проверки.
 *
 * Проход обёрнут `safely` (NFR-06): исключение при обходе чужого DOM не имеет
 * права уйти в код носителя.
 */
export function startVerifyMode(): () => void {
  // Прежнее значение запоминается ДО того, как мы его перебьём: выход обязан
  // вернуть страницу в то состояние, в котором её застали, а не в «с правками».
  const previousShowOriginal = entryStore.showOriginal()

  entryStore.setShowOriginal(true)
  entryStore.setVerifyMode(true)

  let last: VerifySummary = { arrived: 0, 'not-arrived': 0, unclear: 0, checked: 0 }

  const pass = safely(log, 'проход проверки', () => {
    last = runVerifyPass()
    log.debug('проверка пересчитана', {
      доехало: last.arrived,
      неДоехало: last['not-arrived'],
      непонятно: last.unclear,
      проверено: last.checked,
    })
  })

  const schedule = debounce(pass, VERIFY_DEBOUNCE_MS)

  // Подписка ДО первого прохода: проход пишет исходы в хранилище и уведомляет,
  // и подписаться после него значило бы пропустить состояние, которое он сам
  // же и создал.
  const stopStore = entryStore.subscribe(schedule)
  pass()

  log.info('режим проверки включён', {
    доехало: last.arrived,
    неДоехало: last['not-arrived'],
    непонятно: last.unclear,
    проверено: last.checked,
  })

  return (): void => {
    stopStore()
    schedule.cancel()
    entryStore.clearVerify()
    entryStore.setVerifyMode(false)
    // Слой возвращается в прежнее состояние ПОСЛЕДНИМ: сперва снимаем пометки
    // исхода, потом показываем правки. Обратный порядок дал бы кадр, в котором
    // правки на экране уже есть, а красные пометки ещё не убраны.
    entryStore.setShowOriginal(previousShowOriginal)
    log.info('режим проверки выключен', { слойВозвращён: !previousShowOriginal })
  }
}
