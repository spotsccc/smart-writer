# Этап 2. Спроектировать внутреннюю архитектуру

## Цель этапа

Определить, как package выполнит контракт этапа 1, не реализуя production-код. На этом этапе
фиксируются модули, направления зависимостей, внутренние данные и решения известных проблем
legacy-версии.

«Устранить проблему» здесь означает определить новое observable behavior, владельца решения,
ошибку и будущий тест. Фактическое исправление выполняется на этапе 4. AI Travel Core остаётся
read-only до этапа 5.

## Архитектурный стиль

Первая версия — небольшая functional core library:

- public DTO и callbacks на входе;
- pure validation/planning для section graph;
- прямой orchestration flow;
- injected side effects только через `buildPrompt` и `generateText`;
- immutable input и детерминированный output order;
- ошибки как values.

Не нужны DI container, classes, services, repositories, provider adapters, plugin registry,
generic event bus или отдельный framework scheduler.

## Целевая структура source

~~~text
src/
  index.ts
  types.ts
  errors.ts
  section-graph.ts
  markdown.ts
  write.ts
~~~

Назначение файлов:

- `index.ts` — только намеренные public exports;
- `types.ts` — public provider-neutral DTO и callback contracts;
- `errors.ts` — четыре public tagged error category;
- `section-graph.ts` — semantic validation и topological waves;
- `markdown.ts` — section normalization и финальная assembly;
- `write.ts` — linear use case, bounded execution, cancellation и usage aggregation.

Отдельный `usage.ts`, `scheduler.ts` или `callbacks.ts` добавляется только если реализация
докажет самостоятельную нетривиальную ответственность. Для первой версии reducer и chunk loop
остаются в `write.ts`.

## Направление внутренних зависимостей

~~~mermaid
flowchart TD
    INDEX["index.ts"] --> TYPES["types.ts"]
    INDEX --> ERRORS["errors.ts"]
    INDEX --> WRITE["write.ts"]
    WRITE --> TYPES
    WRITE --> ERRORS
    WRITE --> GRAPH["section-graph.ts"]
    WRITE --> MD["markdown.ts"]
    GRAPH --> TYPES
    GRAPH --> ERRORS
    MD --> TYPES
~~~

Ни один package module не зависит от host adapter или application types.

## Внутренние данные

Минимально необходимы только следующие internal representations:

- `SectionWave` — ordered readonly list секций, которые можно выполнять параллельно;
- `Map<sectionId, GeneratedSection>` внутри одного вызова `writeArticle` для dependency lookup;
- mutable локальный `TokenUsage` accumulator внутри orchestration;
- operation-local `AbortController` для остановки sibling calls после первой ошибки.

Эти данные не являются public entities. Для них не создаются DTO classes, factories или
отдельные storage abstractions.

## Контракт `section-graph.ts`

Одна pure function получает `ArticleSectionPlan[]` и возвращает либо ordered waves, либо
`InvalidArticlePlanError`.

Она проверяет до первого callback:

- наличие хотя бы одной section и непустые structural titles;
- непустые и уникальные IDs;
- существование каждой dependency;
- отсутствие duplicate dependency IDs внутри section;
- отсутствие self-dependency;
- отсутствие cycles;
- сохранение plan-order внутри каждой wave.

Dependency context для секции строится только из явно объявленных IDs и также сохраняет
plan-order. Graph module ничего не знает о prompts, Markdown, concurrency или callbacks.

## Контракт `markdown.ts`

Module владеет только topic-agnostic правилами:

- нормализовать line endings к `LF` и убрать внешние пустые строки;
- убрать повтор собственного H2 из model response;
- понизить внутренние H2 до H3, если это часть утверждённого public behavior;
- не менять остальной section content;
- собрать H1, ordered H2 sections и optional conclusion, разделяя blocks ровно `\n\n` и без
  trailing newline.

Распознавание русских слов «Заключение», «Выводы» или «Итоги» не входит в package. Наличие
conclusion задаётся `ArticlePlan.conclusion`, а не языковой эвристикой.

## Контракт `write.ts`

Happy path читается сверху вниз:

1. Проверить `concurrency` и section graph.
2. Создать operation controller и связать его с external signal.
3. Последовательно пройти topological waves.
4. Для текущего wave выделить chunk размером не больше `concurrency`.
5. Построить prompts всего chunk с global index и dependency context; при prompt failure не
   запускать model calls этого chunk.
6. Параллельно вызвать `generateText` для подготовленного chunk с operation signal.
7. После каждого boundary немедленно вернуть typed error при failure.
8. Нормализовать section, сохранить её по ID и сложить usage.
9. Сгенерировать conclusion только при `plan.conclusion !== null`.
10. Восстановить sections в plan-order и собрать `GeneratedArticle`.

При первой ошибке controller отменяет in-flight sibling calls, новые chunks и waves не
стартуют. Первая исходная failure остаётся result и не заменяется последующим sibling abort.
Package не повторяет model call: retries принадлежат host `generateText`.

## Boundary failures

- Returned/thrown error из `buildPrompt` превращается в `PromptBuildError` с target и `cause`.
- Returned/rejected error из `generateText` превращается в `ContentGenerationError` с target и
  `cause`.
- Empty/whitespace model content превращается в `ContentGenerationError`; raw finish reason
  проверяется host adapter до возврата `TextGenerationResponse`.
- External abort или abort-aware callback result превращается в `WritingAbortedError`.
- Invalid graph/concurrency превращается в `InvalidArticlePlanError` до side effects.

Package доверяет собственным TypeScript DTO после public boundary и не добавляет повторные
runtime shape checks. Проверяются только semantic invariants, которые типы выразить не могут.
При failure partial article/usage не возвращаются; host сохраняет per-call accounting в callback.

## Решения проблем legacy-версии

| Проблема | Целевое решение | Владелец |
| --- | --- | --- |
| Entry тянет DB, AI SDK, ENV и app barrels | Два injected callback и собственные DTO | Public boundary |
| Prompt читается из DB на каждую секцию | Host загружает единый snapshot до `writeArticle` | App adapter |
| Первая секция определяется отсутствием dependencies | `isFirst` вычисляется по global plan index | `write.ts` |
| Independent calls запускаются без limit | Waves и chunks с explicit concurrency | graph + `write.ts` |
| Missing IDs и cycles обнаруживаются поздно | Semantic validation до callbacks | graph |
| Conclusion всегда генерируется, даже если выбрасывается | Только explicit `plan.conclusion` | plan + `write.ts` |
| Неполный finish reason принимается как success | Host callback возвращает Error вместо normalized response | App model adapter |
| Provider cause теряется | Tagged boundary error сохраняет `cause` | `write.ts`/adapter |
| Sibling calls продолжаются после failure | Operation controller abort-ит siblings | `write.ts` |
| Cancellation не доходит до model | Signal передаётся в каждый request | `write.ts`/adapter |
| Сумма parallel durations выдаётся за elapsed | Package не возвращает duration; host измеряет wall clock | App adapter |
| Ошибка technical log ломает оплаченный result | Logs best-effort, job-state writes critical | App adapter |
| Word count и cost раздувают result | Не входят в package result | App adapter |
| Языковая эвристика решает наличие conclusion | Явный structural plan contract | Public API |

## Что остаётся специально неопределённым

- конкретный topological algorithm и локальные helper names;
- размер и форма private functions внутри `write.ts`;
- структура test fixtures;
- точный механизм соединения двух abort signals, пока observable semantics соблюдены;
- performance optimizations без измеренной проблемы.

## Решения этапа

### A-01. Утвердить module map

Принять шесть файлов выше как исходную структуру и не добавлять слои без текущей необходимости.

### A-02. Утвердить graph semantics

Зафиксировать validation, waves, plan-order и dependency context как одну pure responsibility.

### A-03. Утвердить execution semantics

Зафиксировать sequential waves, bounded chunks, global index, failure short-circuit и sibling
abort.

### A-04. Утвердить Markdown ownership

Отделить generic normalization/assembly от language- и topic-specific правил приложения.

### A-05. Утвердить error mapping

Для каждого uncontrolled callback boundary определить returned/thrown/rejected/aborted outcome и
сохранение cause.

### A-06. Закрыть legacy defects design table

У каждой известной проблемы должны быть target behavior, owner и будущий test ID этапа 3.

## Exit gate

Этап завершён, когда:

- public API можно реализовать шестью указанными modules без app imports;
- каждый известный legacy defect имеет конкретное целевое решение;
- нет неопределённости в graph, ordering, conclusion, cancellation и error semantics;
- private implementation details не выданы за обязательную архитектуру;
- test designer может вывести observable cases без чтения будущего production-кода.
