# Публикация «Кальки» на GitHub — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Репозиторий становится публичным (`axilab/kalka`, MIT), а собранный виджет раздаётся по постоянному адресу `https://axilab.github.io/kalka/kalka.js`, который обновляется конвейером на каждый push в `main`.

**Architecture:** Локальная подготовка (лицензия, метаданные, шаблон страницы, сборщик каталога сайта, конвейер, README) делается коммитами в текущем репозитории. Затем ветка переименовывается в `main`, репозиторий создаётся через `gh`, Pages включается в режиме «GitHub Actions». Конвейер прогоняет проверки, собирает бандл, складывает каталог `site/` (бандл плюс страница) и выкладывает его официальными действиями Pages. Ветка `gh-pages` не заводится, `dist/` в историю не попадает.

**Tech Stack:** Node 26, npm, Vite 7 (сборка одного IIFE-файла), Vitest, ESLint, TypeScript, GitHub Actions (`actions/configure-pages@v5`, `actions/upload-pages-artifact@v3`, `actions/deploy-pages@v4`), GitHub CLI (`gh`).

**Spec:** `docs/superpowers/specs/2026-09-06-github-publication-design.md`

## Global Constraints

- Владелец и имя репозитория: `axilab/kalka`. Публичный.
- Лицензия: MIT, строка `Copyright (c) 2026 axilab`.
- Публичные адреса: `https://axilab.github.io/kalka/kalka.js` (сборка) и `https://axilab.github.io/kalka/` (страница). Никаких папок версий — только latest.
- Ветка по умолчанию: `main`. Ветки `feature/*` не отправляются.
- Вся документация и комментарии — по-русски, как во всём репозитории.
- `dist/` остаётся в `.gitignore`: собранный файл никогда не попадает в историю.
- В `dist/` должен лежать **ровно один** файл `kalka.js` — это проверяет `scripts/check-bundle.mjs` и роняет сборку иначе. Поэтому `index.html` кладётся не в `dist/`, а в отдельный каталог `site/`.
- Бюджет бандла: не больше 100 КБ gzip (102 400 байт). Проверка входит в `npm run build`.
- `private: true` в `package.json` **сохраняется**: в npm пакет не публикуется.
- В бандле не должно быть ни одного внешнего адреса и ни одного вызова `console` — это уже проверяет `check:bundle`, и страница сайта тоже ничего не грузит извне.

---

## Структура файлов

**Создаются:**

| Файл | За что отвечает |
|---|---|
| `LICENSE` | текст MIT |
| `scripts/site/index.html` | шаблон единственной страницы сайта: адрес файла и строка подключения |
| `scripts/build-site.mjs` | сборка каталога `site/` из `dist/kalka.js` и шаблона |
| `.github/workflows/pages.yml` | проверки на каждый push и PR, выкладка на Pages с `main` |

**Правятся:**

| Файл | Что меняется |
|---|---|
| `package.json` | `license`, `repository`, `homepage`, `keywords`, скрипт `build:site` |
| `.gitignore` | добавляется `site/` |
| `README.md:31` | из «чего ещё нет» уходит упоминание отсутствующего адреса |
| `README.md:77-84` | раздел «Подключение» получает публичный адрес и оговорку про latest |

---

## Task 1: Лицензия и метаданные пакета

**Files:**
- Create: `LICENSE`
- Modify: `package.json`

**Interfaces:**
- Consumes: ничего.
- Produces: поле `homepage` в `package.json` со значением `https://axilab.github.io/kalka/` — тот же адрес повторяется в Task 2 (шаблон страницы) и Task 4 (README); все три должны совпадать посимвольно.

- [ ] **Step 1: Создать `LICENSE`**

```
MIT License

Copyright (c) 2026 axilab

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Добавить метаданные в `package.json`**

Вставить сразу после строки `"description": "Калька — слой правок поверх прототипа",`:

```json
  "license": "MIT",
  "homepage": "https://axilab.github.io/kalka/",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/axilab/kalka.git"
  },
  "keywords": [
    "widget",
    "preact",
    "shadow-dom",
    "prototyping",
    "overlay",
    "annotations"
  ],
```

Поле `"private": true` не трогать — оно остаётся.

- [ ] **Step 3: Проверить, что `package.json` остался корректным JSON**

Run: `node -e "const p=require('./package.json'); if(p.license!=='MIT') throw new Error('нет license'); if(p.private!==true) throw new Error('потерян private'); if(p.homepage!=='https://axilab.github.io/kalka/') throw new Error('не тот homepage'); console.log('✓ метаданные на месте')"`

Expected: `✓ метаданные на месте`

- [ ] **Step 4: Убедиться, что сборка и проверки не сломались**

Run: `npm run lint && npm run typecheck && npm test`

Expected: всё зелёное. `package.json` читается в `vite.config.ts` ради `__VERSION__`, поэтому проверка не формальная.

- [ ] **Step 5: Коммит**

```bash
git add LICENSE package.json
git commit -F - <<'EOF'
chore(repo): лицензия MIT и метаданные пакета

Репозиторий готовится к публикации: появляется LICENSE и поля
license, homepage, repository, keywords. Флаг private сохранён —
в npm пакет не публикуется.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013U4AykEoL27fFxRovyPvNh
EOF
```

---

## Task 2: Каталог сайта

**Files:**
- Create: `scripts/site/index.html`
- Create: `scripts/build-site.mjs`
- Modify: `package.json` (скрипт `build:site`)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `dist/kalka.js` — результат существующего `npm run build`.
- Produces: команда `npm run build:site`, собирающая каталог `site/` с двумя файлами: `site/kalka.js` и `site/index.html`. Task 3 вызывает именно эту команду.

- [ ] **Step 1: Создать шаблон страницы `scripts/site/index.html`**

Страница ничего не грузит извне — ни шрифтов, ни стилей, ни скриптов. Это то же требование, что и к бандлу.

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Калька — слой правок поверх прототипа</title>
    <style>
      body {
        max-width: 720px;
        margin: 0 auto;
        padding: 32px 16px 96px;
        font-family: Georgia, serif;
        line-height: 1.6;
        color: #1a1a1a;
        background: #fff;
      }
      code,
      pre {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 14px;
      }
      pre {
        padding: 12px 16px;
        border: 1px solid #ddd;
        border-radius: 8px;
        overflow-x: auto;
        background: #fafafa;
      }
      table {
        border-collapse: collapse;
        width: 100%;
      }
      th,
      td {
        text-align: left;
        padding: 8px 12px 8px 0;
        border-bottom: 1px solid #eee;
        vertical-align: top;
      }
      footer {
        margin-top: 48px;
        padding-top: 16px;
        border-top: 1px solid #eee;
        font-size: 14px;
      }
    </style>
  </head>
  <body>
    <h1>Калька</h1>
    <p>
      Слой правок поверх прототипа. Заказчик правит тексты и оставляет аннотации
      прямо на странице, а разработчик получает правки в применимом виде.
      Тексты не меняются в источнике — они подменяются при отображении.
    </p>

    <h2>Подключение</h2>
    <p>Одна строка в разметке страницы:</p>
    <pre><code>&lt;script src="https://axilab.github.io/kalka/kalka.js"&gt;&lt;/script&gt;</code></pre>
    <p>
      По этому адресу всегда лежит последняя сборка из ветки <code>main</code>.
      Версия не закрепляется: прототип, подключённый сегодня, завтра получит
      новую сборку.
    </p>

    <h2>Включение</h2>
    <p>
      Виджет молчит, пока его не включили явно, — забытый скрипт не уезжает
      в прод рабочим.
    </p>
    <table>
      <thead>
        <tr>
          <th>Адрес</th>
          <th>Что происходит</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><code>?kalka</code></td>
          <td>включает и запоминает: виджет переживёт переход по внутренним ссылкам</td>
        </tr>
        <tr>
          <td><code>?kalka=0</code>, <code>?kalka=off</code>, <code>?kalka=false</code></td>
          <td>выключает и забывает</td>
        </tr>
        <tr>
          <td>без параметра</td>
          <td>решает запомненный признак</td>
        </tr>
      </tbody>
    </table>

    <footer>
      Исходный код и документация:
      <a href="https://github.com/axilab/kalka">github.com/axilab/kalka</a>.
      Лицензия MIT.
    </footer>
  </body>
</html>
```

- [ ] **Step 2: Создать сборщик `scripts/build-site.mjs`**

```js
/**
 * Каталог сайта для GitHub Pages.
 *
 * Собирается отдельно от dist/, а не поверх него: check-bundle.mjs требует,
 * чтобы в dist/ лежал ровно один файл kalka.js (FR-01, подключение одной
 * строкой). Положить index.html рядом с бандлом — уронить сборку.
 */
import { copyFileSync, mkdirSync, rmSync, statSync } from 'node:fs'

const SITE = 'site'
const BUNDLE = 'dist/kalka.js'
const PAGE = 'scripts/site/index.html'

const bundle = statSync(BUNDLE, { throwIfNoEntry: false })

if (!bundle) {
  console.error(`✗ нет ${BUNDLE}: сначала npm run build`)
  process.exit(1)
}

rmSync(SITE, { recursive: true, force: true })
mkdirSync(SITE, { recursive: true })
copyFileSync(BUNDLE, `${SITE}/kalka.js`)
copyFileSync(PAGE, `${SITE}/index.html`)

console.log(`✓ ${SITE}/: kalka.js (${(bundle.size / 1024).toFixed(1)} КБ) и index.html`)
```

- [ ] **Step 3: Добавить скрипт в `package.json`**

В блок `"scripts"`, сразу после строки `"check:bundle": "node scripts/check-bundle.mjs",`:

```json
    "build:site": "node scripts/build-site.mjs",
```

- [ ] **Step 4: Добавить `site/` в `.gitignore`**

Строка `site/` ставится сразу после `dist/`:

```
node_modules/
dist/
site/
*.log
```

- [ ] **Step 5: Проверить, что сборщик падает без бандла**

Run: `rm -rf dist site && npm run build:site; echo "код возврата: $?"`

Expected: `✗ нет dist/kalka.js: сначала npm run build` и код возврата не 0 (npm добавит свой шум — важен именно ненулевой код).

- [ ] **Step 6: Проверить, что сборщик собирает каталог**

Run: `npm run build && npm run build:site && ls -1 site && node -e "const {statSync}=require('node:fs'); const a=statSync('dist/kalka.js').size, b=statSync('site/kalka.js').size; if(a!==b) throw new Error('размеры разошлись'); console.log('✓ бандл скопирован целиком:', a, 'байт')"`

Expected: в `site/` ровно два файла — `index.html` и `kalka.js` — и сообщение о совпадении размеров.

- [ ] **Step 7: Убедиться, что `site/` не просочился в git**

Run: `git status --porcelain | grep -c "^?? site/" || echo "✓ site/ игнорируется"`

Expected: `✓ site/ игнорируется`

- [ ] **Step 8: Коммит**

```bash
git add scripts/site/index.html scripts/build-site.mjs package.json .gitignore
git commit -F - <<'EOF'
feat(site): каталог сайта для Pages рядом с бандлом

npm run build:site складывает site/ из собранного kalka.js и шаблона
страницы. Отдельный каталог, а не dist/, потому что check-bundle
требует в dist/ ровно один файл.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013U4AykEoL27fFxRovyPvNh
EOF
```

---

## Task 3: Конвейер GitHub Actions

**Files:**
- Create: `.github/workflows/pages.yml`

**Interfaces:**
- Consumes: команды `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run build:site` (последняя — из Task 2).
- Produces: сайт на `https://axilab.github.io/kalka/`. Task 7 ждёт первый прогон этого конвейера, Task 8 проверяет его результат.

- [ ] **Step 1: Создать `.github/workflows/pages.yml`**

```yaml
name: Pages

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

# Выкладки не наступают друг на друга: следующая ждёт, а не отменяет
# уже начатую — иначе публичный адрес может остаться на середине.
concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 26
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      # build сам зовёт check:bundle: один файл, бюджет 100 КБ gzip,
      # ни одного внешнего адреса, нет react-dom, нет вызовов console.
      - run: npm run build

  deploy:
    needs: check
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 26
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npm run build:site
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: site
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Проверить, что YAML разбирается**

Run: `node -e "const s=require('node:fs').readFileSync('.github/workflows/pages.yml','utf8'); if(!/actions\/deploy-pages@v4/.test(s)) throw new Error('нет deploy-pages'); if(/path: dist/.test(s)) throw new Error('выкладывается dist вместо site'); console.log('✓ конвейер на месте')"`

Expected: `✓ конвейер на месте`

Если в системе есть `yq` или `python3` с `pyyaml` — дополнительно прогнать разбор YAML: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/pages.yml')); print('✓ YAML валиден')"`. Если ни того, ни другого нет, шаг пропускается: настоящую проверку даст первый прогон в Task 7.

- [ ] **Step 3: Прогнать локально ту же цепочку, что и в конвейере**

Run: `npm ci && npm run lint && npm run typecheck && npm test && npm run build && npm run build:site`

Expected: всё зелёное, в конце — строка про собранный `site/`. Смысл шага: конвейер не должен быть первым местом, где эта цепочка запускается.

- [ ] **Step 4: Коммит**

```bash
git add .github/workflows/pages.yml
git commit -F - <<'EOF'
ci(pages): проверки и выкладка сборки на GitHub Pages

Job check гоняет lint, typecheck, тесты и сборку на каждый push и PR.
Job deploy выкладывает каталог site/ с ветки main официальными
действиями Pages — ветка gh-pages не заводится.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013U4AykEoL27fFxRovyPvNh
EOF
```

---

## Task 4: README под публичный адрес

**Files:**
- Modify: `README.md:31` (перечень «чего ещё нет»)
- Modify: `README.md:77-84` (раздел «Подключение»)

**Interfaces:**
- Consumes: адрес `https://axilab.github.io/kalka/kalka.js`, тот же, что в Task 1 и Task 2.
- Produces: ничего для последующих задач.

- [ ] **Step 1: Убрать из перечня отсутствующий адрес**

Было (строки 30–31):

```markdown
Чего ещё **нет**: скилла `kalka-apply`, применяющего правки в исходниках,
и единого адреса для подключения бандла. Это следующие вехи, а не пропуски.
```

Стало:

```markdown
Чего ещё **нет**: скилла `kalka-apply`, применяющего правки в исходниках.
Это следующая веха, а не пропуск.
```

- [ ] **Step 2: Поставить публичный адрес в раздел «Подключение»**

Было (строки 79–84):

````markdown
Одна строка в разметке страницы:

```html
<script src="/kalka.js"></script>
```
````

Стало:

````markdown
Одна строка в разметке страницы:

```html
<script src="https://axilab.github.io/kalka/kalka.js"></script>
```

По этому адресу лежит последняя сборка из `main`: конвейер обновляет его
на каждый push. Версия не закрепляется — прототип, подключённый сегодня,
завтра получит новую сборку. Свой файл подключается так же, локальным
путём вида `/kalka.js`.
````

- [ ] **Step 3: Проверить, что старый путь больше не выдаётся за адрес подключения**

Run: `grep -n "axilab.github.io/kalka/kalka.js" README.md && grep -n "единого адреса" README.md; echo "---"; grep -c "src=\"/kalka.js\"" README.md`

Expected: адрес найден; строка «единого адреса» не найдена (grep вернёт пустоту); счётчик `src="/kalka.js"` равен 0.

- [ ] **Step 4: Коммит**

```bash
git add README.md
git commit -F - <<'EOF'
docs(readme): публичный адрес бандла вместо локального пути

Единый адрес подключения появился, поэтому он уходит из перечня
недостающего и встаёт в раздел «Подключение» с оговоркой о том,
что версия не закрепляется.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013U4AykEoL27fFxRovyPvNh
EOF
```

---

## Task 5: GitHub CLI

**Files:** нет — задача про окружение.

**Interfaces:**
- Consumes: ничего.
- Produces: рабочая команда `gh`, авторизованная под учётной записью `axilab`. Tasks 6 и 7 без этого не начинаются.

- [ ] **Step 1: Поставить `gh`**

Run: `brew install gh`

Expected: команда `gh` появляется в `PATH`.

- [ ] **Step 2: Убедиться, что бинарь на месте**

Run: `gh --version`

Expected: строка вида `gh version 2.x.x`.

- [ ] **Step 3: Авторизация — вручную пользователем**

Ввод интерактивный, агент его выполнить не может. Попросить пользователя выполнить в этой сессии:

```
! gh auth login
```

Выбрать: GitHub.com → HTTPS → авторизоваться в браузере.

- [ ] **Step 4: Проверить, что авторизация прошла и под тем аккаунтом**

Run: `gh api user --jq .login`

Expected: `axilab`. Если вернулось другое имя — остановиться и спросить пользователя: имя репозитория в спеке привязано к `axilab`.

---

## Task 6: Публичный репозиторий и первый push

**Files:** нет — задача про git и GitHub.

**Interfaces:**
- Consumes: авторизованный `gh` из Task 5, коммиты из Tasks 1–4.
- Produces: репозиторий `https://github.com/axilab/kalka` с веткой `main`. Task 7 включает на нём Pages.

- [ ] **Step 1: Убедиться, что рабочее дерево чистое и remote ещё нет**

Run: `git status --porcelain; git remote -v; echo "---"; git rev-parse --abbrev-ref HEAD`

Expected: список изменений пуст, remote пуст, текущая ветка `master`. Если remote уже есть — остановиться и разобраться, а не перезаписывать.

- [ ] **Step 2: Переименовать ветку**

Run: `git branch -m master main && git rev-parse --abbrev-ref HEAD`

Expected: `main`.

- [ ] **Step 3: Создать публичный репозиторий и отправить только `main`**

```bash
gh repo create axilab/kalka \
  --public \
  --source=. \
  --remote=origin \
  --push \
  --description "Калька — слой правок поверх прототипа: заказчик правит тексты прямо на странице, разработчик получает правки в применимом виде"
```

Expected: репозиторий создан, ветка `main` отправлена. Ветки `feature/*` не отправляются: `--push` отправляет текущую ветку.

- [ ] **Step 4: Убедиться, что уехала ровно одна ветка**

Run: `git ls-remote --heads origin`

Expected: ровно одна строка, `refs/heads/main`.

- [ ] **Step 5: Проставить топики**

```bash
gh repo edit axilab/kalka \
  --add-topic widget \
  --add-topic preact \
  --add-topic shadow-dom \
  --add-topic prototyping \
  --add-topic overlay \
  --add-topic typescript
```

Expected: команда отработала без ошибок.

- [ ] **Step 6: Проверить видимость и лицензию глазами GitHub**

Run: `gh repo view axilab/kalka --json visibility,licenseInfo,defaultBranchRef,repositoryTopics`

Expected: `visibility: PUBLIC`, лицензия MIT распознана, ветка по умолчанию `main`, топики на месте.

---

## Task 7: Включение Pages и первый прогон

**Files:** нет — задача про настройки GitHub.

**Interfaces:**
- Consumes: репозиторий из Task 6, конвейер из Task 3.
- Produces: работающий сайт. Task 8 проверяет его содержимое.

- [ ] **Step 1: Включить Pages в режиме GitHub Actions**

```bash
gh api --method POST /repos/axilab/kalka/pages \
  -H "Accept: application/vnd.github+json" \
  -f build_type=workflow
```

Expected: ответ 201 с полем `html_url`. Если вернулось 409 «already exists» — Pages уже включён, тогда перевести источник:

```bash
gh api --method PUT /repos/axilab/kalka/pages \
  -H "Accept: application/vnd.github+json" \
  -f build_type=workflow
```

- [ ] **Step 2: Убедиться, что источник именно Actions**

Run: `gh api /repos/axilab/kalka/pages --jq '{build_type, html_url, status}'`

Expected: `build_type: workflow`, адрес `https://axilab.github.io/kalka/`.

- [ ] **Step 3: Дождаться прогона конвейера**

Run: `gh run watch --exit-status`

Expected: прогон завершается успехом. Если `deploy` упал с жалобой на разрешения Pages — вернуться к шагу 1: до включения Pages job выкладки не имеет права публиковать. После включения перезапустить: `gh run rerun --failed`.

- [ ] **Step 4: Посмотреть, что именно выложилось**

Run: `gh run view --log | grep -i "site/\|page_url" | head -20`

Expected: в журнале видно строку сборщика про `site/` и адрес развёртывания.

---

## Task 8: Приёмка

**Files:** нет — задача про проверку результата.

**Interfaces:**
- Consumes: сайт из Task 7, локальную сборку из Task 2.
- Produces: подтверждённый факт, что публичный адрес работает.

Пока все три проверки не показаны, работа не закрыта. Зелёный значок конвейера сам по себе ничего не доказывает.

- [ ] **Step 1: Адрес отдаёт JavaScript**

Run: `curl -sI https://axilab.github.io/kalka/kalka.js | head -5`

Expected: `HTTP/2 200` и `content-type: text/javascript` (или `application/javascript`). Первое развёртывание может занять до пары минут — если пришло 404, подождать и повторить.

- [ ] **Step 2: Выложенный файл совпадает с локальной сборкой**

Run: `npm run build && curl -s https://axilab.github.io/kalka/kalka.js -o /tmp/kalka-remote.js && node -e "const {statSync}=require('node:fs'); const a=statSync('dist/kalka.js').size, b=statSync('/tmp/kalka-remote.js').size; console.log('локально', a, 'байт; по адресу', b, 'байт'); if(a!==b) throw new Error('файлы разошлись — на Pages не та сборка')"`

Expected: размеры совпали. Расхождение означает, что на Pages уехало не то, что собирается сейчас, — разбираться, а не списывать на кэш.

- [ ] **Step 3: Страница сайта открывается**

Run: `curl -s https://axilab.github.io/kalka/ | grep -c "axilab.github.io/kalka/kalka.js"`

Expected: не 0 — страница отдаётся и содержит строку подключения.

- [ ] **Step 4: Виджет поднимается с публичного адреса**

Создать временную мишень и открыть её в браузере:

```bash
cat > /tmp/kalka-remote.html <<'EOF'
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <title>Проверка публичного адреса</title>
  </head>
  <body>
    <h1>Тарифы на подключение</h1>
    <p>Страница подключает виджет по публичному адресу.</p>
    <script src="https://axilab.github.io/kalka/kalka.js"></script>
  </body>
</html>
EOF
open "file:///tmp/kalka-remote.html?kalka"
```

Expected: у правого края появляется рейка виджета шириной 48px с тремя инструментами. Если рейки нет — смотреть консоль браузера: без `?kalka` виджет молчит намеренно.

- [ ] **Step 5: Сверить README с действительностью**

Run: `grep -n "единого адреса\|axilab.github.io/kalka/kalka.js" README.md`

Expected: строки «единого адреса» нет, публичный адрес найден. Правки README сделаны в Task 4 — этот шаг только подтверждает, что документация не разошлась с тем, что реально работает. Коммита здесь нет.

- [ ] **Step 6: Финальный отчёт пользователю**

Сообщить: адрес подключения, факт совпадения размеров, что версия не закрепляется и что папки версий можно добавить позже, не ломая существующий адрес.

---

## Проверка плана на соответствие спеке

| Требование спеки | Где закрыто |
|---|---|
| Публичный `axilab/kalka` | Task 6 |
| MIT, `Copyright (c) 2026 axilab` | Task 1 |
| Адрес `…/kalka.js`, только latest | Tasks 2, 3, 8 |
| Страница с краткой инструкцией, без демо | Task 2 |
| Всё содержимое как есть | Task 6 (ничего не удаляется) |
| История целиком, только `main` | Task 6, шаги 2–4 |
| Триггер — каждый push в `main` | Task 3 |
| `check`: lint, typecheck, тесты, сборка | Task 3 |
| Отдельный каталог `site/` из-за check-bundle | Task 2 |
| `dist/` и `site/` вне истории | Tasks 2 (шаги 4, 7) |
| `private: true` сохраняется | Task 1 (шаг 3 проверяет) |
| README без «нет единого адреса» | Task 4 |
| Топики репозитория | Task 6, шаг 5 |
| Pages в режиме Actions | Task 7 |
| Приёмка по трём фактам | Task 8 |
