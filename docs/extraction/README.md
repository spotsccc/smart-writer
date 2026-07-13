# План создания `@spotsccc/smart-writer`

Дата актуализации: 2026-07-13.

Стратегия изменена: вместо рефакторинга production-кода на месте и последующего физического
переноса создаётся новая standalone-реализация в `~/code/smart-writer`. До интеграционного этапа
`~/code/ai-travel-core` используется только как read-only источник фактов о текущем поведении.
Замена в приложении выполняется последней, в отдельной ветке.

Такой порядок реален. Он позволяет продолжать работу без доступа на изменение AI Travel Core и
даёт package собственную архитектуру, тесты и release cycle. Главный риск — расхождение новой
реализации с нужным поведением приложения. Он закрывается точным public contract, заранее
спроектированной test matrix и adapter integration tests перед переключением production consumer.

## Репозитории

- Новый package и его source of truth: `~/code/smart-writer`.
- Исходное приложение: `~/code/ai-travel-core`.
- Исследуемый legacy seam: `~/code/ai-travel-core/src/libs/generation/generate`.
- Package name: `@spotsccc/smart-writer`.

## Пять этапов

| Этап | Документ | Результат |
| --- | --- | --- |
| 1 | [Архитектура проекта и public API](./01-target-boundary.md) | Зафиксированы ownership, внешний контракт, ошибки и package format |
| 2 | [Внутренняя архитектура](./02-internal-architecture.md) | Определены минимальные модули, внутренние контракты и решения известных дефектов |
| 3 | [Проектирование тестов](./03-test-design.md) | Каждый contract и риск связан с конкретным тестом и подходящей test boundary |
| 4 | [Поэтапная реализация](./04-implementation.md) | Standalone package реализован вертикальными срезами и проверен как `.tgz` |
| 5 | [Замена в AI Travel Core](./05-ai-travel-core-integration.md) | В отдельной ветке подключён adapter, переключён consumer и удалён local core |

[Исходное состояние](./00-current-state.md) остаётся исследовательским входом, а не отдельным
этапом реализации.

## Что означает «спроектировать до реализации»

До написания production-кода фиксируются:

- внешний контракт и ownership;
- observable behavior и инварианты;
- необходимые модули и направление зависимостей;
- категории ошибок и cancellation semantics;
- test cases и границы test doubles;
- последовательность вертикальных implementation slices.

Заранее не проектируются private helpers, class hierarchy, DI container, plugin system,
repository/provider abstractions и extension points для гипотетических consumers. Такие детали
решаются внутри конкретного implementation slice, если появляется доказанная необходимость.

## Направление зависимостей

~~~mermaid
flowchart LR
    APP["AI Travel Core"] --> ADAPTER["app-owned adapter"]
    DB["prompt DB + snapshot"] --> ADAPTER
    MODEL["AI SDK + provider"] --> ADAPTER
    LOGS["job lifecycle + logs"] --> ADAPTER
    ADAPTER --> API["@spotsccc/smart-writer public API"]
    API --> CORE["package-owned orchestration"]
    CORE --> PROMPT["injected buildPrompt"]
    CORE --> TEXT["injected generateText"]
~~~

Package никогда не импортирует AI Travel Core. Приложение знает только root public exports
установленного package и собственный adapter.

## Неизменяемые ограничения

- Node.js `>=22`.
- Dual ESM/CJS runtime и соответствующие `.d.mts`/`.d.cts` declarations.
- MIT и публичный npm package.
- Одна публичная orchestration function — `writeArticle`.
- Два host callback — `buildPrompt` и `generateText`.
- Errors-as-values внутри package; legacy throw только в app adapter.
- Никаких DB, ENV, AI SDK, provider, travel/SEO/price rules и prompt assets в package.
- Никакой двойной live-генерации для сравнения.
- До этапа 5 нет изменений в AI Travel Core.

## Межэтапные gates

1. Реализация не начинается, пока observable public contract этапа 1 и внутренние ownership
   решения этапа 2 не позволяют однозначно спроектировать тесты.
2. Каждый implementation slice этапа 4 начинается с теста из матрицы этапа 3 и заканчивается
   работающим package gate.
3. Интеграция начинается только с проверенным packed artifact; соседний source checkout или
   workspace link не считается интеграцией.
4. Переключение приложения выполняется одним consumer seam. Старый и новый model path не
   запускаются параллельно.
5. Любое изменение package после создания integration tarball создаёт новый artifact и требует
   повторения package и app gates.

Эти gates не запрещают обратную связь. Если integration branch обнаруживает реальную
несовместимость public contract, решение возвращается в документы этапов 1–3, реализуется новой
package version и снова проходит полный artifact gate. Несовместимость нельзя скрывать app-only
type cast, deep import или расширением package app-specific полями.

## Текущий статус

- Этапы 1–3 спроектированы.
- I-01 standalone scaffold реализован и проверен тестами PK-01 — PK-06.
- `origin` указывает на `spotsccc/smart-writer`.

## Следующий шаг

I-02: реализовать утверждённые public types и tagged errors. До этого нужно выпустить совместимую
dual ESM/CJS версию `errore`: опубликованный `errore@0.14.1` не предоставляет `require` export и
не может быть runtime dependency CJS-ветки package. Добавлять заведомо несовместимую dependency
или ослаблять PK-02 нельзя.
