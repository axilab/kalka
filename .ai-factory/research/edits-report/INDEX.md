<!-- aif:research-mode:ultra -->
# Research Index: Отчёт о правках

Topic: Отчёт о правках — печатаемый документ для человека рядом с файлом обмена
Slug: edits-report
Updated: 2026-09-05 23:52
Status: active

## Purpose

Можно ли дать человеку, передающему задачу разработчику, читаемый документ
с внесёнными правками, замечаниями и картинками мест правки — не тронув при этом
файл обмена JSON, который остаётся главным продуктом, и не выйдя за бюджет
бандла в 100 КБ gzip.

## Artifact Index

| Artifact | Purpose | Why included | Status |
|----------|---------|--------------|--------|
| [RESEARCH.md](RESEARCH.md) | Активная сводка и история сессий | Обязателен | active |
| [C4-CONTEXT.md](C4-CONTEXT.md) | Действующие лица и два артефакта, которые виджет отдаёт наружу | Тема пересекает границы четырёх действующих лиц и двух внешних систем (ИИ-агент, сайт-носитель), а главный риск RISK-002 живёт именно на ручной передаче «менеджер → разработчик», а не внутри кода | active |
| [DEPENDENCY-GRAPH.md](DEPENDENCY-GRAPH.md) | Направление зависимостей между дорожкой выгрузки и дорожкой отчёта | Затронуто больше трёх слайсов с нелинейными связями; есть критический порядок (файл обмена скачивается первым) и риск связности (вырезка не должна стать полем записи). Это форма, в которой требование «JSON главное» становится проверяемым | active |
| [ADR-0001-print-instead-of-pdf-generator.md](ADR-0001-print-instead-of-pdf-generator.md) | Печать браузером вместо собственного генератора PDF | Решение материально, имеет измеренные альтернативы и дорого в откате: от него зависит весь способ доставки документа | accepted |
| [ADR-0002-dom-cutout-instead-of-raster.md](ADR-0002-dom-cutout-instead-of-raster.md) | Вырезка вёрстки вместо растрового снимка | Решение материально, альтернативы измерены в килобайтах, откат меняет хранение, рендерер и договор о качестве. Несёт таблицу замеров гейта 2026-09-05 | accepted |
| [ADR-0003-indexeddb-for-cutouts.md](ADR-0003-indexeddb-for-cutouts.md) | IndexedDB для вырезок — рассмотрено и отклонено | Сохранён как история спора о хранилище. Его арифметика объёма опровергнута замером 2026-09-05 (576–1260 байт gzip против «~30 КБ»); ценность документа — в таблице альтернатив, а не в числах | superseded |
| [ADR-0004-scratch-buffer-for-cutouts.md](ADR-0004-scratch-buffer-for-cutouts.md) | Черновой буфер со сроком жизни вместо постоянного хранилища | Решение материально и неочевидно: «только оперативная память» уцелела бы при клиентской навигации в SPA и ломается на полной перезагрузке, а исключить её нельзя. Следующий читатель придёт к той же идее, и разбор нужен ему целиком | accepted |

## Reading Order

1. [RESEARCH.md](RESEARCH.md) — что решено, чем ограничено, что не закрыто
2. [C4-CONTEXT.md](C4-CONTEXT.md) — кто кому что передаёт и где рвётся
3. [ADR-0001-print-instead-of-pdf-generator.md](ADR-0001-print-instead-of-pdf-generator.md) — как получается PDF
4. [ADR-0002-dom-cutout-instead-of-raster.md](ADR-0002-dom-cutout-instead-of-raster.md) — как получается картинка места правки
5. [ADR-0004-scratch-buffer-for-cutouts.md](ADR-0004-scratch-buffer-for-cutouts.md) — где картинки лежат до печати
6. [DEPENDENCY-GRAPH.md](DEPENDENCY-GRAPH.md) — чем гарантируется, что отчёт не испортит выгрузку
7. [ADR-0003-indexeddb-for-cutouts.md](ADR-0003-indexeddb-for-cutouts.md) — вытеснённый вариант хранилища, только для истории

## Traceability

| ID | Finding / requirement | Evidence | Decision or artifact |
|----|-----------------------|----------|----------------------|
| DEC-001 | PDF получаем печатью браузера; своего генератора нет | `dist/kalka.js` 33 695 байт gzip; базовые шрифты PDF без кириллицы | [ADR-0001](ADR-0001-print-instead-of-pdf-generator.md) |
| DEC-002 | Картинка места правки — вырезка вёрстки, не растр | Замеры html2canvas 71.6 КБ / snapdom 52.0 КБ / html-to-image 8.4 КБ gzip | [ADR-0002](ADR-0002-dom-cutout-instead-of-raster.md) |
| DEC-003 | Вырезки — черновой буфер в `localStorage`, стирается после печати | Встречное предложение пользователя 2026-09-05; `.ai-factory/DESCRIPTION.md` | [ADR-0004](ADR-0004-scratch-buffer-for-cutouts.md), вытесняет [ADR-0003](ADR-0003-indexeddb-for-cutouts.md) |
| DEC-013 | Запись без вырезки показывается текстом с явной пометкой | Выбор пользователя 2026-09-05 | [RESEARCH.md](RESEARCH.md) |
| DEC-014 | Вид документа — деловая записка для менеджера | Выбор пользователя 2026-09-05 | [RESEARCH.md](RESEARCH.md) |
| DEC-015 | Общая точка сборки съёмки вырезки — слой `features` | `src/features/edit-text/model/create.ts`; `.ai-factory/ARCHITECTURE.md` | [DEPENDENCY-GRAPH.md](DEPENDENCY-GRAPH.md) |
| DEC-005 | Файл обмена не меняется ни в одном байте | `src/entities/entry/model/serialize.ts`; `src/shared/model/format.ts` | [DEPENDENCY-GRAPH.md](DEPENDENCY-GRAPH.md), «Безопасная точка разделения» |
| DEC-006 | Вырезка снимает исходное состояние в точке захвата `was`/`wasHtml` | `src/features/edit-text/model/create.ts:21,29` | [RESEARCH.md](RESEARCH.md) |
| DEC-010 | Файл обмена скачивается первым; сбой отчёта его не отменяет | `src/features/export-entries/model/export.ts` | [DEPENDENCY-GRAPH.md](DEPENDENCY-GRAPH.md), «Критический путь выгрузки» |
| RISK-001 | Вырезка может выглядеть не как оригинал | Гейт 2026-09-05 на живом прототипе: 3 из 4 совпали, провал героя обнаруживается контрастом 1.00 | [ADR-0002](ADR-0002-dom-cutout-instead-of-raster.md), Evidence |
| DEC-007 | Самопроверка вырезки — по контрасту, не по размерам и тексту | Гейт: у провалившейся вырезки размеры и текст совпали идеально | [RESEARCH.md](RESEARCH.md) |
| DEC-016 | Документ отчёта несёт правила `@font-face` сайта | Гейт: `document.fonts` пуст в изолированном документе, строка 58.6px против 60.66px | [ADR-0002](ADR-0002-dom-cutout-instead-of-raster.md) |
| DEC-004 | Отчёт заменяет второй файл выгрузки; правится PRD и DESCRIPTION.md | `.ai-factory/DESCRIPTION.md`, «Экспорт двух файлов»; PRD, FR-27 | [RESEARCH.md](RESEARCH.md) |
| RISK-002 | Менеджер отправит разработчику только PDF | PRD, раздел 1 «Проблема», строка 40; раздел 6, шаг 9 | [C4-CONTEXT.md](C4-CONTEXT.md), Boundary Notes |
