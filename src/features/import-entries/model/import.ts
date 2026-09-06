import { parseExchangeFile } from 'entities/entry'
import type { ImportRejection } from 'entities/entry'
import { readTextFile } from 'shared/api/files'
import { createLogger } from 'shared/lib/log'
import { mergeImported } from './merge'
import type { MergeReport } from './merge'

const log = createLogger('import')

/*
 * Загрузка файла правок целиком (FR-30, FR-33): прочитать → разобрать → слить.
 *
 * Функция НИЧЕГО НЕ РИСУЕТ и ничего не бросает. Решение о словах принимает
 * интерфейс (`widgets/entry-list`): здесь исход только классифицируется.
 * Это не формальность — фразы для человека обязаны лежать в одном месте рядом
 * друг с другом, иначе «Файл создан другой версией» и «Не удалось прочитать
 * файл» со временем разойдутся по тону и начнут противоречить FR-36.
 */

/**
 * Чем кончилась загрузка.
 *
 * `unreadable-file` отличается от `unreadable` из `ImportRejection` намеренно:
 * первое — файл не удалось ПРОЧИТАТЬ (он слишком велик или браузер отказал),
 * второе — прочитали, но содержимое не разобралось. Человеку в обоих случаях
 * говорится похожее, но в логе это разные события с разными причинами, и
 * склеивать их значило бы усложнить себе первую же разборку «почему не грузится».
 */
export type ImportOutcome =
  | { ok: true; report: MergeReport; skipped: number }
  | { ok: false; reason: ImportRejection | 'unreadable-file' }

export async function importFromFile(file: File): Promise<ImportOutcome> {
  const raw = await readTextFile(file)
  if (raw === null) {
    log.warn('импорт не выполнен', { причина: 'файл не прочитан', имя: file.name })
    return { ok: false, reason: 'unreadable-file' }
  }

  const parsed = parseExchangeFile(raw)
  if (typeof parsed === 'string') {
    log.warn('импорт не выполнен', { причина: parsed, имя: file.name })
    return { ok: false, reason: parsed }
  }

  const report = mergeImported(parsed)

  // Ни имя автора, ни тексты правок, ни содержимое файла (решение 22).
  log.info('импорт выполнен', {
    добавлено: report.added,
    дубликатов: report.duplicates,
    перенумеровано: report.renumbered,
    пропущеноНегодных: parsed.skipped,
  })

  return { ok: true, report, skipped: parsed.skipped }
}
