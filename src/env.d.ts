/// <reference types="vite/client" />

declare module '*.css?inline' {
  const content: string
  export default content
}

/** Подставляется сборкой из поля `version` корневого package.json. */
declare const __VERSION__: string

interface Window {
  /** Единственное, что «Калька» пишет в глобальную область носителя. */
  __kalka?: {
    readonly version: string
    readonly unmount: () => void
    /**
     * Подать записи напрямую, минуя хранилище браузера.
     *
     * Только в DEV-сборке: ветка вырезается вместе с `import.meta.env.DEV`,
     * и в продакшен-бандле этого поля нет. Существует ради дев-стенда —
     * инструмент «Текст» ещё не написан, импорта ещё нет, а проверять слой
     * на чём-то надо. Чтение записей из localStorage сюда не тянется:
     * это FR-23 из вехи «Хранение и экспорт».
     *
     * Тип намеренно `unknown[]`: `env.d.ts` — глобальные объявления, и импорт
     * `Entry` превратил бы файл в модуль, отключив их. Разбор — в app/index.ts.
     */
    readonly seed?: (entries: unknown[]) => void
  }
}
