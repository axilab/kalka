import { beforeEach, describe, expect, it, vi } from 'vitest'

import { shouldActivate } from './activation'

describe('shouldActivate', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('без параметра и без флага виджет не поднимается', () => {
    expect(shouldActivate('')).toBe(false)
  })

  it('?kalka включает и запоминает флаг', () => {
    expect(shouldActivate('?kalka')).toBe(true)
    expect(localStorage.getItem('kalka:enabled')).toBe('1')
  })

  it('?kalka=1 включает', () => {
    expect(shouldActivate('?kalka=1')).toBe(true)
  })

  it('запомненный флаг поднимает виджет без параметра', () => {
    shouldActivate('?kalka')

    expect(shouldActivate('')).toBe(true)
  })

  it('?kalka=0 выключает и стирает флаг', () => {
    shouldActivate('?kalka')

    expect(shouldActivate('?kalka=0')).toBe(false)
    expect(localStorage.getItem('kalka:enabled')).toBeNull()
  })

  it('имя параметра чувствительно к регистру, а значение — нет', () => {
    shouldActivate('?kalka')

    // ?KALKA=OFF — не наш параметр: решение принимает запомненный флаг.
    expect(shouldActivate('?KALKA=OFF')).toBe(true)
    // ?kalka=OFF — наш параметр, значение регистронезависимо.
    expect(shouldActivate('?kalka=OFF')).toBe(false)
  })

  it('параметр находится среди чужих параметров адреса', () => {
    expect(shouldActivate('?other=1&kalka=off')).toBe(false)
  })

  it('недоступное хранилище не мешает решению и не бросает', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('отказано')
    })

    expect(() => shouldActivate('')).not.toThrow()
    expect(shouldActivate('')).toBe(false)
  })
})
