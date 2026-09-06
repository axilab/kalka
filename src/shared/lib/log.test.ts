import { describe, expect, it, vi } from 'vitest'

import { createLogger } from './log'

describe('createLogger', () => {
  it('пишет в console.debug с префиксом области и полями', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})

    createLogger('mount').debug('поднялись', { x: 1 })

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('[kalka:mount]', 'поднялись', { x: 1 })
  })

  it('без полей вызывает console двумя аргументами, а не тремя с undefined', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})

    createLogger('mount').debug('поднялись')

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]).toEqual(['[kalka:mount]', 'поднялись'])
  })

  it('child уточняет область в префиксе', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})

    createLogger('mount').child('styles').info('готово')

    expect(spy).toHaveBeenCalledWith('[kalka:mount:styles]', 'готово')
  })

  it('warn и error идут в свои каналы, а не в общий', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    const log = createLogger('boot')
    log.warn('внимание')
    log.error('сбой', { code: 7 })

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('[kalka:boot]', 'внимание')
    expect(error).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledWith('[kalka:boot]', 'сбой', { code: 7 })
  })
})
