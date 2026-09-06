import type { ComponentChildren, JSX } from 'preact'
import { EntryList } from 'widgets/entry-list'
import { Button } from 'shared/ui/Button'
import { IconClose } from 'shared/ui/icons'

export interface ReviewModeProps {
  /**
   * Закрыть ящик. ЕДИНСТВЕННОЕ действие выхода отсюда.
   *
   * Прежде их было два — «Правка» и «Свернуть», — потому что разбор был
   * отдельной панелью и уйти из него можно было либо в другую панель, либо
   * в кнопку. Панелей больше нет: инструменты доступны прямо на рейке
   * при открытом ящике, и «вернуться к правке» стало означать ровно то же,
   * что «закрыть ящик».
   */
  onCollapse: () => void
  /**
   * Счётчик правок и кнопка выгрузки. Передаётся сверху, а не импортируется
   * здесь: решение «счётчик доступен всегда» (FR-25) принимается в одном
   * месте — в `app/ui/Root`.
   */
  exportSummary?: ComponentChildren
}

/**
 * Содержимое ящика разбора.
 *
 * Листа со своей рамкой и тенью здесь нет: лист — это сам ящик, а панель
 * внутри панели была бы карточкой в карточке. Своей геометрии у этого блока
 * тоже нет — её задаёт `.kalka-drawer`.
 */
export function ReviewMode({ onCollapse, exportSummary }: ReviewModeProps): JSX.Element {
  // Кнопка ЗАГРУЗКИ живёт внутри `EntryList` и только здесь
  // (решение 20 плана вехи): импорт — инструмент разработчика, а не рецензента.
  // Положить её рядом с «Экспортом» на виду значило бы предлагать заказчику
  // затереть свою работу чужим файлом на ровном месте.
  return (
    <>
      <div class="kalka-drawer__head">
        <p class="kalka-title">Разбор</p>
        <Button icon={<IconClose />} label="Закрыть разбор" onClick={onCollapse} />
      </div>

      <EntryList />
      {exportSummary}
    </>
  )
}
