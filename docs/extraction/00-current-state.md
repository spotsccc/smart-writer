# Исходное состояние и результаты исследования

Этот документ фиксирует проверенные факты на 2026-07-10. Он нужен, чтобы решения переноса
опирались на фактический runtime graph и текущее поведение, а не на визуальный размер
директории.

## Контекст исходного репозитория

Исследование выполнено по checkout AI Travel Core в `~/code/ai-travel-core`. Исходное дерево,
из которого выделяется библиотека, находится в `~/code/ai-travel-core/src/libs/generation`.
Все относительные пути в этом документе разрешаются от `~/code/ai-travel-core`.

## Локальный scope

В `~/code/ai-travel-core/src/libs/generation/generate` находятся:

- `generate.ts` — 335 строк;
- `index.ts` — один явный re-export;
- `__spec__/generate.test.ts` — 292 строки.

Публичная поверхность:

- `runGenerateStep`;
- `assembleContent`;
- `GenerateStepResult`.

API реэкспортируется ещё раз из `src/libs/generation/index.ts:95`.

Единственный production consumer `runGenerateStep` внутри репозитория —
`src/libs/generation/pipeline/pipeline.ts:339-372`. `assembleContent` вне собственных
тестов не используется. Это хороший seam для strangler migration: blast radius вызова
маленький, хотя dependency closure большой.

## Фактический happy path

Для outline с N секциями текущий модуль:

1. Делит секции на independent и dependent.
2. Запускает все independent одним `Promise.all`.
3. Запускает dependent последовательно.
4. Для каждой секции отдельно читает active prompt из PostgreSQL.
5. Для каждой секции пишет prompt и model response в technical logs.
6. Вызывает Anthropic через скрытый global provider.
7. Нормализует H2 и считает слова.
8. Всегда ещё раз читает conclusion prompt и вызывает модель.
9. Собирает Markdown и складывает usage/durations.

В обычном случае это означает:

- N + 1 model calls;
- N + 1 чтений active prompt version;
- 2(N + 1) technical-log insert-ов при наличии `jobId`;
- примерно 2N + 4 progress-log insert-ов;
- потенциально разные версии одного prompt в рамках одной статьи.

## Измеренный dependency closure

Диагностическая команда:

~~~text
npx esbuild src/libs/generation/generate/index.ts \
  --bundle \
  --platform=node \
  --format=esm \
  --tsconfig=tsconfig.json \
  --packages=external
~~~

Результат:

- 68 локальных input modules, включая entrypoint;
- около 6,6 тысяч строк достижимого локального TypeScript;
- 58 957 байт несжатого диагностического JS output;
- 11 внешних specifier-ов:
  - `@ai-sdk/anthropic`;
  - `@ai-sdk/openai`;
  - `ai`;
  - `crypto`;
  - `drizzle-orm`;
  - `drizzle-orm/node-postgres`;
  - `drizzle-orm/pg-core`;
  - `drizzle-zod`;
  - `env-var`;
  - `pg`;
  - `zod`.

Это не оценка финального tarball size. Это диагностическое доказательство того, сколько
архитектуры достижимо из маленького entrypoint до создания package boundary.

Самые крупные случайно достижимые файлы — весь fact-check, validation, web fact-check,
prompt builders всех этапов, job lifecycle, article schemas, DB schemas и assistant DB.

## Почему graph разрастается

### Широкий infrastructure barrel

`generate.ts:4-10` импортирует пять символов из `../infrastructure`. Его `index.ts`
одновременно реэкспортирует:

- pricing;
- job lifecycle;
- job logs;
- technical logs;
- step runner;
- весь SEO utilities layer.

В package core реально нужен только маленький usage reducer. `countWords` используется здесь
ради display-логов и dead `GeneratedSection.wordCount`; после consumer audit оба можно убрать
из package contract. Progress/technical logging принадлежит host adapter.

### Широкий prompts barrel

`generate.ts:18-22` импортирует builders через `../prompts`, который реэкспортирует CRUD,
versioning, validation, errors, utils и builders всех pipeline steps.

Сами generate builders вызывают `getPrompt`, а тот делает PostgreSQL query через
`getActivePromptVersion`. Поэтому prompt construction сейчас не является чистой функцией.

### Широкий fact-check barrel

`prompts/builders/generate.ts` берёт три чистые функции из `../../fact-check`. Barrel
одновременно реэкспортирует web verification и article validation. Так в graph попадают
OpenAI provider, article schemas и другие части, не нужные section generation.

### Общий types file

`generation/types.ts` содержит DTO всех pipeline steps и импортирует articles, categories,
DB SEO types и validate. Даже type-only graph показывает, что generation package DTO пока не
отделены от приложения.

Найдены type/declaration cycles:

- `generation/types.ts -> validate/index.ts -> validate/validate.ts -> generation/types.ts`;
- `validate/validate.ts -> fact-check/index.ts -> fact-check/validation.ts -> validate/validate.ts`.

Runtime cycle в диагностическом graph не найден, но такие declaration cycles усложнят
самостоятельную сборку типов.

## Таблица прямых зависимостей

| Текущая зависимость | Почему мешает пакету | Целевое решение |
| --- | --- | --- |
| Drizzle `Template` | Экспортирует DB entity и schema dependencies | Host маппит его в generic package `ArticlePlan` |
| `NotFoundError` приложения | Тянет app error hierarchy ради почти невозможного invariant | Проверять graph заранее, вернуть tagged package error |
| `generateAIText` | Читает ENV и создаёт Anthropic provider | Injected provider-agnostic `generateText` |
| `RECOMMENDED_MODELS` | Model policy меняется независимо от domain core | Оставить model ID и provider в host |
| `logInfo` | DB side effect и `jobId` внутри core | Логировать в app adapter/pipeline |
| technical logs | DB schema и непоследовательная failure policy | Adapter видит request/response и логирует best-effort |
| DB-backed prompt builders | N + 1 query и version drift | Host загружает snapshot один раз и замыкает app-owned `buildPrompt` |
| общий `ResearchResult` | Тянет весь pipeline type graph | Не передавать package; замкнуть verified ledger внутри `buildPrompt` |
| общий `OutlineResult` | Содержит app-specific поля | Host маппит structural subset в package `ArticlePlan` |
| `aggregateUsage` из cost barrel | Тянет pricing/model types | Маленькая package pure function |
| `countWords` из SEO barrel | Нужен только для логов/dead field | Убрать из package path, оставить app validation владельцем |
| H2 contract barrel | Смешивает generic normalization и language policy | Пакету оставить generic Markdown subset, языковые эвристики — host |

## Найденные дефекты поведения

### 1. Несколько «первых» секций

`runGenerateStep` передаёт пустой `previousSections` всем independent sections
(`generate.ts:223-237`). Builder трактует пустой массив как «Это первая секция статьи»
(`prompts/builders/generate.ts:31-36`).

Tracked prompt требует разместить primary keyphrase в первом абзаце именно при этом сигнале
(`new_prompts/generate_section.md:40-45`). Следовательно, все independent sections могут
дублировать primary как первая секция.

Правильный признак — global outline index 0, а не отсутствие dependencies.

### 2. Оплаченное, но выброшенное заключение

Заключение генерируется безусловно (`generate.ts:277-287`). `assembleContent` затем не
вставляет его, если outline уже содержит «Заключение», «Выводы», «Итоги», `Conclusion` или
`Summary` (`generate.ts:328-332`).

Usage и duration лишнего call учитываются, `result.conclusion` содержит текст, которого нет в
`fullContent`. Поле `PipelineContext.conclusion` после присваивания нигде не читается.

### 3. Неполная защита graph

Upstream validation проверяет duplicate IDs и missing dependency IDs, но не self-dependency и
cycles. `orderSectionsByDependencies` при cycle молча добавляет остаток как есть
(`outline/outline.ts:178-180`).

Сам `runGenerateStep` публичен и не требует, чтобы upstream validation вообще был вызван.
При cycle или прямом вызове он генерирует секции без полного dependency context.

### 4. Неограниченный параллелизм

Все independent sections запускаются одним `Promise.all`. По schema
`validations.maxSections` допускает до 100, default outline limit — 10. Нет явного
concurrency limit, а при первой ошибке уже запущенные платные calls продолжаются.

### 5. Cancellation не доходит до модели

Pipeline проверяет cancellation только перед всем generate step. `GenerationOptions` не
содержит `AbortSignal`, и уже запущенная wave не может быть остановлена.

Внешний catch pipeline считает отменой только `error instanceof JobCancelledError`. Поэтому
при extraction новый package abort нельзя оборачивать generic app error: такой job ошибочно
получит статус `failed`.

### 6. Неверная duration semantic

`totalDurationMs` складывает durations всех calls, включая параллельные. Это cumulative model
time, а не wall-clock elapsed time. Pipeline показывает его пользователю и добавляет как
duration всего шага.

Метрика также не включает prompt loading, logging и orchestration.

### 7. Prompt version drift внутри статьи

Каждый builder отдельно читает текущую active version. Если администратор активирует новую
версию во время генерации, разные sections одной статьи получат разные prompt versions.

### 8. Непоследовательная observability policy

`logInfo` пробрасывает DB error и способен оборвать generation после успешного model call,
включая progress log уже после завершения `runGenerateStep`. Technical logs, наоборот,
проглатывают DB error и пишут `console.error`.

Нужно явно разделить:

- job state transitions — critical;
- progress и technical details — best-effort;
- package core — вообще не знает о persistence логов.

### 9. Нет типизированного error contract

Сигнатура обещает только `Promise<GenerateStepResult>`, но наружу могут вылететь DB errors,
prompt errors, `NotFoundError` и plain `Error`.

`ai/client.ts:49-58` создаёт новый `Error` без `cause`, теряя исходную цепочку.

### 10. Не проверяется finish reason

Текущий AI adapter принимает `result.text`, но не проверяет `finishReason` и warnings.
Ответ, остановленный по token limit или content filter, может попасть в статью как готовая
секция.

AI SDK документирует отдельные причины `stop`, `length`, `content-filter`,
`tool-calls`, `error`, `other`. Для text-only generation только явно допустимая причина
должна считаться успехом.

### 11. Retry и timeout скрыты

AI SDK `generateText` по умолчанию делает до двух retries. Timeout не задан. Если pipeline или
queue повторит весь use case, число платных calls перемножается. Retry policy должен иметь
одного владельца — host AI adapter — и быть задан явно.

### 12. Word metrics расходятся

Финальный log внутри generate считает только section words. Pipeline считает whitespace chunks
всего Markdown вместе с headings. Единого определения метрики нет.

### 13. Повторная фильтрация verified facts

Документированный контракт говорит, что `ResearchResult.facts` уже содержит только verified
ledger. Generate prompt повторно вызывает `filterFactsForGeneration`. Это дублирует upstream
policy и размывает ownership. App-owned `buildPrompt` должен доверять verified ledger и выбирать
факты по `researchFactIds`; package fact DTO вообще не получает.

### 14. Календарная политика зашита в код

`prompts/builders/helpers/prices.ts` несколько раз содержит literal `2025-2026`. Эта app-owned
prompt policy будет устаревать независимо от package release cadence. Generate-specific
guidelines лучше формулировать относительно даты verified research/evidence, без зашитого
календарного окна.

### 15. Неизвестные fact IDs молча исчезают

Outline validation проверяет наличие массива `researchFactIds`, но не проверяет, что каждый ID
существует в verified ledger. `getFactsForSection` просто фильтрует известные facts, поэтому
опечатка/галлюцинация ID превращается в section без обязательного fact context.

App adapter должен проверить этот межобъектный invariant один раз до `writeArticle` и model calls
и вернуть typed app input error с section/fact IDs. Package не может проверять invariant, потому
что verified ledger намеренно отсутствует в его public contract.

## Критичный drift prompt source

Tracked sources и code contract уже расходятся:

- `new_prompts/generate_section.md:21` ждёт `{{researchFacts}}`;
- builder передаёт `verifiedFacts`;
- `getPrompt` обнаруживает оставшийся placeholder и бросает `PromptSubstitutionError`;
- module test не читает tracked file, а создаёт отдельный DB prompt с
  `{{verifiedFacts}}`, поэтому defect скрыт.

Ещё один drift:

- `new_prompts/outline.md:75,96` требует поле `researchFacts`;
- Zod schema ожидает `researchFactIds`;
- `docs/ai-knowledge/2026-07-05-fact-check-pipeline-hard-contract.md` говорит, что старое поле
  удалено.

Production DB может содержать исправленную версию, поэтому из repository state нельзя делать
вывод, что production прямо сейчас падает. Но tracked source больше не воспроизводит production.

Актуализация 2026-07-13: `scripts/seed-prompts.ts` снова присутствует, а command
`db:seed:prompts` существует. Это снимает утверждение об отсутствующем файле, но clean test DB
import всех tracked `PROMPT_KEYS` ещё должен быть проверен на integration branch этапа 5.

До замены implementation нужно выбрать канонический prompt source, синхронизировать его с builder
и доказать воспроизводимый seed/import workflow.

## Состояние тестов

Команда
`npm run test:unit -- src/libs/generation/generate/__spec__/generate.test.ts` проходит:
27 тестов за 4 ms.

Но suite:

- тестирует `countWords`, который принадлежит infrastructure;
- тестирует `assembleContent`;
- ни разу не вызывает `runGenerateStep`.

Pipeline module test полностью мокает `runGenerateStep`. Поэтому сейчас не защищены:

- scheduling и dependency context;
- порядок результата после parallel completion;
- prompt loading;
- usage aggregation orchestration;
- provider failure;
- cancellation;
- concurrency;
- conclusion call policy;
- finish reason;
- полный app adapter flow.

## Состояние package/release инфраструктуры

Корневой package:

- имеет `private: true`;
- не имеет `workspaces`, `exports`, `types` и `files`;
- использует custom Artifactory registry из `.npmrc`;
- включает `legacy-peer-deps=true`;
- собирает server output в CommonJS;
- имеет очень широкий root TypeScript include;
- root Vitest ищет только `src/**/*.test.ts`.

`npm pack --dry-run --json` корня показал 1138 файлов, около 19,2 MB compressed и 23,3 MB
unpacked. В список попадает tracked `.env.test`, editor/agent config, docs, migrations, tests и
public assets. Новый package обязан использовать `files` allowlist; копировать root manifest
как шаблон нельзя.

## Risk matrix

| Риск | Вероятность | Ущерб | Основная мера |
| --- | --- | --- | --- |
| Перенести DB/provider вместе с core | Высокая | Высокий | Сначала DTO и injected callback |
| Зафиксировать уже дрейфующий prompt contract | Высокая | Высокий | Исправить tracked prompts до baseline |
| Изменить output незаметно при refactor | Высокая | Высокий | Characterization + bug regression tests |
| Неполная секция из-за token limit | Средняя | Высокий | Проверять finish reason |
| Rate limit из-за `Promise.all` | Средняя | Высокий | Явный max parallel + cancellation |
| Сломать server CJS build package | Высокая | Высокий | Dual ESM/CJS exports и smoke tests обеих веток |
| Разные prompt versions в одной статье | Средняя | Средний | Загрузить prompts один раз |
| Потерять cause при переходе error model | Средняя | Высокий | Tagged errors и cause chain |
| Опубликовать лишние/секретные файлы | Средняя | Высокий | `files` allowlist и pack inspection |
| Source-tree build работает, packed artifact нет | Средняя | Высокий | Clean-consumer tarball test |
| Смешать extraction с AI SDK upgrade | Средняя | Высокий | Отдельный проект/релиз для SDK major |
| Двойная live generation для parity | Средняя | Средний | Scripted fake и deterministic contract tests |
| Unknown `researchFactIds` теряются | Средняя | Высокий | Проверить IDs до первого model call |

## Актуальные внешние ограничения

- Node рекомендует `exports` для новых packages; он фиксирует public entrypoints и закрывает
  deep imports: [Node.js Packages](https://nodejs.org/api/packages.html).
- TypeScript рекомендует публиковать generated declarations вместе с package и явно указывать
  `types`: [Publishing declaration files](https://www.typescriptlang.org/docs/handbook/declaration-files/publishing.html).
- Для library package module resolution нужно проверять в Node-aware режиме, а не только с
  app-specific `bundler` resolution:
  [TypeScript modules reference](https://www.typescriptlang.org/docs/handbook/modules/reference).
- `npm pack --dry-run` показывает фактический publish payload:
  [npm pack](https://docs.npmjs.com/cli/pack/).
- AI SDK поддерживает `AbortSignal`, timeout и явный `maxRetries`; default retries равен 2:
  [generateText reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text).
- AI SDK предоставляет deterministic mock models для adapter tests:
  [AI SDK testing](https://ai-sdk.dev/docs/ai-sdk-core/testing).
- AI SDK telemetry остаётся experimental и по умолчанию при включении записывает inputs/outputs:
  [AI SDK telemetry](https://ai-sdk.dev/docs/ai-sdk-core/telemetry).
- Текущий app использует AI SDK 6 family. AI SDK 7 — отдельный major и ESM-only; его upgrade не
  следует совмещать с extraction:
  [AI SDK 6 migration](https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0),
  [AI SDK 7 manifest](https://raw.githubusercontent.com/vercel/ai/ai%407.0.20/packages/ai/package.json).
- Minimum runtime пакета зафиксирован как Node.js `>=22`; package smoke matrix включает Node 22
  и актуальный поддерживаемый LTS:
  [Node.js releases](https://nodejs.org/en/about/previous-releases).

## Исследовательский итог

Физический move — поздний и почти механический шаг. Основная работа находится перед ним:

1. Восстановить воспроизводимый prompt contract.
2. Защитить orchestration поведением тестов.
3. Отделить package DTO от app types.
4. Вынести DB/provider/logging за один host adapter.
5. Исправить реальные scheduler/conclusion/cancellation defects.
6. Только затем создать standalone package в `~/code/smart-writer`, механически перенести core
   и переключить единственный production consumer через packed, а затем registry artifact.
