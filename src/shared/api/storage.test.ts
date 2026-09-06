import { beforeEach, describe, expect, it, vi } from 'vitest'

import { read, remove, write } from './storage'

describe('обёртки над localStorage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('пишет и читает по ключу с префиксом kalka:', () => {
    expect(write('enabled', '1')).toBe(true)

    expect(read('enabled')).toBe('1')
    expect(localStorage.getItem('kalka:enabled')).toBe('1')
  })

  it('незнакомое имя читается как null', () => {
    expect(read('нет-такого')).toBeNull()
  })

  it('после удаления значение больше не читается', () => {
    write('enabled', '1')

    expect(remove('enabled')).toBe(true)
    expect(read('enabled')).toBeNull()
  })

  it('недоступное хранилище на чтении даёт null, а не исключение', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('отказано')
    })

    expect(() => read('enabled')).not.toThrow()
    expect(read('enabled')).toBeNull()
  })

  it('недоступное хранилище на записи даёт false, а не исключение', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('отказано')
    })

    expect(() => write('enabled', '1')).not.toThrow()
    expect(write('enabled', '1')).toBe(false)
  })
})
