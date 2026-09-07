/**
 * Оснастка тестового окружения. Кодом виджета не является и в бандл не попадает.
 *
 * Node 26 объявляет собственные экспериментальные глобали веб-хранилища, и в Vitest
 * они перекрывают реализацию jsdom:
 *   - `globalThis.localStorage` — аксессор Node, который без флага `--localstorage-file`
 *     возвращает `undefined` и печатает ExperimentalWarning;
 *   - глобальный `Storage` и фактический `sessionStorage` оказываются разных классов,
 *     поэтому `vi.spyOn(Storage.prototype, ...)` не влияет на настоящее хранилище.
 *
 * Тестам нужно предсказуемое хранилище, чьи методы лежат на прототипе глобального
 * `Storage`: тогда и обычная работа с `localStorage`, и подмена `Storage.prototype.getItem`
 * ведут себя так, как в браузере. Здесь оба глобала заменяются на одну согласованную
 * реализацию в памяти.
 *
 * Доступ к значениям как к свойствам (`storage.ключ`) не поддерживается намеренно:
 * `shared/api/storage` пользуется только методами, а Proxy ради неиспользуемого пути
 * усложнил бы оснастку.
 */

class MemoryStorage {
  readonly #items = new Map<string, string>()

  get length(): number {
    return this.#items.size
  }

  key(index: number): string | null {
    return [...this.#items.keys()][index] ?? null
  }

  getItem(name: string): string | null {
    return this.#items.get(String(name)) ?? null
  }

  setItem(name: string, value: string): void {
    this.#items.set(String(name), String(value))
  }

  removeItem(name: string): void {
    this.#items.delete(String(name))
  }

  clear(): void {
    this.#items.clear()
  }
}

function install(name: 'localStorage' | 'sessionStorage'): void {
  Object.defineProperty(globalThis, name, {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  })
}

Object.defineProperty(globalThis, 'Storage', {
  value: MemoryStorage,
  configurable: true,
  writable: true,
})

install('localStorage')
install('sessionStorage')

/*
 * `CSS.escape` в jsdom нет вовсе — не урезан, а отсутствует объект `CSS`
 * целиком. Браузер даёт его нативно, и движок наложения им пользуется, находя
 * уже наложенные элементы по метке (`app/lib/overlay/engine.ts`, `findApplied`).
 * Без этой заглушки весь слайс наложения непроверяем: первый же `applyLayer`
 * падает на `CSS.escape is undefined`.
 *
 * Реализация — по спецификации CSS.escape для тех входов, которые в проекте
 * встречаются: экранируются все символы, кроме букв, цифр, дефиса и
 * подчёркивания, а ведущая цифра уходит в шестнадцатеричную форму. Полного
 * алгоритма спецификации здесь нет намеренно: `id` записи виджет генерирует
 * сам, и экзотических входов у него не бывает.
 */
Object.defineProperty(globalThis, 'CSS', {
  value: {
    escape(value: string): string {
      return String(value).replace(/[^\w-]|^(?=\d)/gu, (char) =>
        char === '' ? '' : `\\${char.codePointAt(0)?.toString(16)} `,
      )
    },
  },
  configurable: true,
  writable: true,
})
