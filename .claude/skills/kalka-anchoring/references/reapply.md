# Наложение после гидрации и переприменение при навигации

Реализация FR-19.

## Почему нельзя накладывать сразу

Прототип на React/Vue/Svelte сначала отдаёт серверный HTML, потом фреймворк «гидрирует»
его — берёт существующий DOM под свой контроль и с этого момента считает себя
единственным его владельцем.

Правка, наложенная до гидрации, будет стёрта: фреймворк увидит расхождение между
своим виртуальным деревом и реальным DOM и восстановит «правильное» состояние.
Внешне это выглядит как «правка мигнула и исчезла» — и объяснить это без знания
про гидрацию невозможно.

## Момент первого наложения

Надёжного кросс-фреймворкового события «гидрация закончилась» не существует.
Практичный подход — дождаться готовности документа и уступить фреймворку кадр:

```ts
function onReady(fn: () => void): void {
  const run = () => requestAnimationFrame(() => requestAnimationFrame(fn))

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    run()
  } else {
    document.addEventListener('DOMContentLoaded', run, { once: true })
  }
}
```

Два вложенных `requestAnimationFrame` дают фреймворку отработать свой первый цикл
отрисовки. Это эвристика, а не гарантия — поэтому она подстрахована `MutationObserver`
(ниже), который переприменит слой, если носитель всё-таки перерисовал страницу позже.

## Перехват клиентской навигации

Задача: узнать обо **всех** сменах маршрута, которые делает чужой код.

### Патч History API

`pushState` и `replaceState` — основной способ навигации SPA, и по MDN они
**не порождают событие `popstate`**. Единственный способ узнать о них из стороннего
скрипта — обернуть их.

```ts
type Cleanup = () => void

function watchNavigation(onChange: () => void): Cleanup {
  const origPush = history.pushState
  const origReplace = history.replaceState

  function wrap<T extends typeof history.pushState>(orig: T): T {
    return function (this: History, ...args: Parameters<T>) {
      const result = orig.apply(this, args)   // сначала носитель
      try {
        onChange()                            // потом мы, и только в try
      } catch {
        /* ошибка виджета не должна ломать навигацию сайта — NFR-06 */
      }
      return result
    } as T
  }

  history.pushState = wrap(origPush)
  history.replaceState = wrap(origReplace)

  const onPop = () => onChange()
  const onHash = () => onChange()
  window.addEventListener('popstate', onPop)
  window.addEventListener('hashchange', onHash)

  return () => {
    history.pushState = origPush
    history.replaceState = origReplace
    window.removeEventListener('popstate', onPop)
    window.removeEventListener('hashchange', onHash)
  }
}
```

Правила безопасного патча чужого объекта:

1. **Оригинал сохраняется** и вызывается **всегда**, первым.
2. **Результат оригинала возвращается** без изменений.
3. **`this` пробрасывается** через `apply` — иначе сломается вызов вида
   `const p = history.pushState; p.call(history, …)`.
4. **Наш код в `try`.** Исключение из виджета не имеет права сорвать навигацию носителя.
5. **Есть откат.** `watchNavigation` возвращает функцию снятия — виджет должен уметь
   полностью убраться со страницы.

### Зачем `hashchange` отдельно

По MDN `hashchange` **не срабатывает**, если хеш изменён через `pushState`/`replaceState`.
И наоборот, прямая правка `location.hash` не проходит через патченные методы.
Два события покрывают разные пути; нужны оба.

### Зачем `popstate`, если методы уже пропатчены

Патч ловит только программную навигацию. Кнопки «назад»/«вперёд» и `history.back()`
через `pushState` не проходят — их ловит `popstate`.

Проверено на стенде (спайк R1): возврат кнопкой «назад» дал ровно одно событие —
`popstate`, и ни одного `pushState`. Слой, переприменяемый только по патчу, после
«назад» остался бы на прежнем маршруте: правки чужой страницы поверх текущей.
`popstate` обязателен, а не «на всякий случай».

## Navigation API как улучшение

Navigation API достиг **Baseline Newly Available в январе 2026** (Firefox 147 от 2026-01-13,
Safari 26.2 от 2025-12-12, Chrome/Edge раньше). Его событие `navigate` ловит навигации
любого происхождения, включая инициированные чужим кодом, — то есть решает задачу
без патча чужих методов.

Но «newly available» — это поддержка в **актуальных** версиях. Рецензент по PRD часто
работает на корпоративной машине, где браузер обновляют не сразу. Поэтому:

```ts
function watchNavigationEnhanced(onChange: () => void): Cleanup {
  const cleanupBase = watchNavigation(onChange)   // база работает всегда

  if (!('navigation' in window)) return cleanupBase

  const nav = (window as any).navigation
  const onNavigate = () => onChange()
  nav.addEventListener('navigate', onNavigate)

  return () => {
    nav.removeEventListener('navigate', onNavigate)
    cleanupBase()
  }
}
```

**База — патч History API. Navigation API — сверху.** Не наоборот: выбор Navigation API
как основного с откатом на патч означал бы, что на чуть более старом браузере виджет
работает по менее проверенному пути.

Двойное срабатывание (и патч, и `navigate`) безвредно — переприменение идемпотентно
и защищено дебаунсом.

> [!warning] `navigate` срабатывает ДО смены URL
> Проверено на живом стенде (спайк R1, 18 событий навигации): событие `navigate`
> приходит раньше, чем обновляется `location`. Обработчик, читающий
> `location.pathname`, получает **старый** адрес — в журнале это выглядело как
> девять переходов «`/` → `/`» подряд при переходах на разные маршруты.
>
> Для `onChange()` без аргументов это безобидно: переприменение всё равно читает
> актуальный маршрут позже. Но как только обработчику понадобится знать, **куда**
> идёт навигация, брать адрес надо из события:
>
> ```ts
> const onNavigate = (event: NavigateEvent) => {
>   const to = new URL(event.destination.url).pathname
>   onChange(to)
> }
> ```
>
> Отсюда общее правило: **Navigation API — не «то же самое, только новее»**.
> У него другой момент срабатывания, и код, написанный по образцу патча
> `pushState`, на нём молча сломается.
>
> Охват при этом совпал: оба источника поймали все пять переходов роутером.
> Navigation API ловит их раньше, патч — надёжнее.

## MutationObserver: перерисовка без смены маршрута

Носитель может перерисовать блок, не меняя URL: подгрузил данные, раскрыл аккордеон,
переключил вкладку. Наложенная правка при этом стирается.

```ts
function watchMutations(onChange: () => void): Cleanup {
  const observer = new MutationObserver((records) => {
    // Игнорируем мутации, которые виджет сделал сам, — иначе бесконечный цикл.
    const foreign = records.some((r) => {
      const target = r.target.nodeType === Node.ELEMENT_NODE
        ? (r.target as Element)
        : r.target.parentElement
      return target ? !target.closest(WIDGET_ROOT_SELECTOR) : true
    })
    if (foreign) onChange()
  })

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  })

  return () => observer.disconnect()
}
```

**Про re-entrancy.** MDN прямо предупреждает: колбэк наблюдателя может вызвать мутации,
которые снова разбудят наблюдателя. У нас это гарантировано — переприменение слоя
и есть мутация. Отсюда два обязательных предохранителя: фильтр «мутация не наша»
и дебаунс.

**Про производительность.** MDN предупреждает и о цене `subtree: true` на большом дереве.
Смягчается тем, что `attributes` **не** наблюдаются (нам нужны только структура и текст),
а колбэк дешёвый — вся работа уходит в дебаунсированное переприменение.

## Дебаунс и идемпотентность

```ts
function debounce(fn: () => void, ms: number): () => void {
  let t: number | undefined
  return () => {
    if (t !== undefined) clearTimeout(t)
    t = setTimeout(fn, ms) as unknown as number
  }
}

const reapply = debounce(() => {
  applyLayer(currentRoute())
}, 100)
```

`applyLayer` обязана быть **идемпотентной**: вызов на уже наложенном слое ничего не меняет
и ничего не ломает. Достигается тем, что источником истины считается хранилище правок,
а не текущее состояние DOM: перед наложением элемент приводится к исходному состоянию
из `was`, затем накладывается `now`.

## Сборка

```ts
function startLayer(): Cleanup {
  const reapply = debounce(() => applyLayer(currentRoute()), 100)

  onReady(() => applyLayer(currentRoute()))

  const stopNav = watchNavigationEnhanced(reapply)
  const stopMut = watchMutations(reapply)

  return () => {
    stopMut()
    stopNav()
    removeLayer()
  }
}
```

Полное снятие обязательно: виджет должен уметь исчезнуть со страницы, вернув и DOM,
и пропатченные методы носителя в исходное состояние.

## Чек-лист

- [ ] Первое наложение — после `DOMContentLoaded` и двух кадров, не раньше
- [ ] `pushState` и `replaceState` пропатчены с сохранением оригинала и `this`
- [ ] Оригинал вызывается первым, его результат возвращается
- [ ] Наш код в патче обёрнут в `try` — исключение не уходит в носителя
- [ ] Слушаются и `popstate`, и `hashchange`
- [ ] Navigation API подключается только как дополнение, при `'navigation' in window`
- [ ] `MutationObserver` игнорирует собственные мутации виджета
- [ ] `attributes` в наблюдателе выключены
- [ ] Переприменение дебаунсировано
- [ ] `applyLayer` идемпотентна
- [ ] Есть полное снятие: DOM восстановлен, методы `history` возвращены
