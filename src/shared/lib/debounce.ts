/** Дебаунсированная функция вместе с отменой отложенного вызова. */
export interface Debounced {
  (): void
  /**
   * Отменяет запланированный вызов. Обязательна: снятие виджета не имеет права
   * оставить висящий таймер, который дёрнет наложение на уже снятом слое.
   */
  cancel(): void
}

/**
 * Откладывает вызов `fn` на `ms` от последнего обращения.
 *
 * `setTimeout` берётся из `window`, а не из глобали: в бандле для браузера
 * это одно и то же, но тип возвращаемого значения не путается с Node.
 */
export function debounce(fn: () => void, ms: number): Debounced {
  let timer: number | undefined

  const run = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = undefined
      fn()
    }, ms)
  }

  run.cancel = (): void => {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
  }

  return run
}
