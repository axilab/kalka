import { describe, expect, it, vi } from 'vitest'

import type { Logger } from './log'
import { safely } from './safe'

function stubLogger(): Logger {
  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => logger,
  }
  return logger
}

describe('safely', () => {
  it('не выпускает исключение наружу и сообщает о границе', () => {
    const log = stubLogger()
    const wrapped = safely(log, 'событие интерфейса', () => {
      throw new Error('внутренний сбой')
    })

    expect(() => wrapped()).not.toThrow()
    expect(log.error).toHaveBeenCalledTimes(1)
    expect(vi.mocked(log.error).mock.calls[0]?.[0]).toBe('сбой на границе: событие интерфейса')
  })

  it('передаёт аргументы без изменений', () => {
    const log = stubLogger()
    const run = vi.fn()
    const wrapped = safely<[string, number]>(log, 'граница', run)

    wrapped('текст', 7)

    expect(run).toHaveBeenCalledWith('текст', 7)
    expect(log.error).not.toHaveBeenCalled()
  })
})
