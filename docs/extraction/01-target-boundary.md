# Этап 1. Спроектировать архитектуру проекта и public API

## Цель этапа

До изменения production-кода договориться, что именно является package, что остаётся host
application и какой контракт считается стабильным. Иначе каждая следующая задача будет
принимать несовместимые локальные решения.

Выход этапа — короткий ADR/decision block с заполненными значениями вместо placeholder-ов,
согласованный public API первой версии и список поддерживаемых runtime/module formats.

## Зафиксированные решения

- Package name: `@spotsccc/smart-writer`.
- Source application: локальный checkout AI Travel Core в `~/code/ai-travel-core`.
- Source tree: `~/code/ai-travel-core/src/libs/generation`; начальный extraction seam —
  `~/code/ai-travel-core/src/libs/generation/generate`.
- Distribution: публичный npm package с `access: public`; `npm view` вернул `404` 2026-07-13,
  поэтому видимого занятого package нет.
- Package source of truth: отдельный публичный репозиторий `spotsccc/smart-writer` на личном
  GitHub; его локальный checkout — `~/code/smart-writer`.
- Scope: topic-agnostic orchestration статей; package не содержит travel-, SEO-, price- или
  language-specific правил.
- Extensibility: две функции `buildPrompt` и `generateText`; plugins, presets, provider
  interfaces и `context: unknown` не нужны.
- Error policy: ожидаемые ошибки возвращаются как values по соглашениям `errore`.
- Minimum runtime: Node.js `>=22`; manifest содержит `engines.node: ">=22"`.
- Module format: dual ESM/CJS с отдельными `.d.mts`/`.d.cts` declarations.
- License: MIT.
- Concurrency: публичный default равен `1`; AI Travel Core сможет явно передавать `3` после
  проверки provider quota, rollback value — `1`.
- Release: отдельный repository -> packed artifact -> npm prerelease/`next` -> exact app
  version -> stable `latest`.

Открытой остаётся только операционная настройка npm Trusted Publishing или другого publish
credential; runtime, module formats и лицензия зафиксированы.

## Рекомендуемое ownership

### Package владеет

- узкими structural DTO для плана и результата статьи;
- semantic validation section graph;
- topological waves и детерминированным output order;
- ограничением parallel section calls;
- вызовом переданного `buildPrompt` с generic target metadata и dependency sections;
- вызовом provider-neutral `generateText`;
- нормализацией section Markdown;
- генерацией conclusion только при его явном наличии в плане;
- сборкой финального Markdown;
- агрегацией provider-neutral token usage;
- package-specific tagged errors;
- propagation cancellation signal.

### Host application владеет

- topic-specific prompt construction;
- travel tone, SEO/category/internal links, price policy, custom components и языковые правила;
- verified fact ledger, его filtering и prompt formatting;
- PostgreSQL prompt CRUD/versioning;
- выбором active prompt versions и их загрузкой;
- DB `Template` и mapping в generic article plan;
- category merge и formatting до generation boundary;
- AI SDK, LanguageModel, Anthropic/OpenAI packages;
- provider/model/API key/ENV;
- retries, timeout и provider warnings;
- преобразованием AI SDK usage/finish reason в package response;
- progress/technical logs;
- job state и cancellation polling;
- wall-clock duration и стоимость;
- compatibility с throwing pipeline;
- edit, validate, save и queue.

## Public API первой версии

До начала реализации названия ещё можно уточнить отдельным решением. После exit gate этого этапа
контракт меняется только осознанно вместе с тестовой матрицей, а не как побочный эффект реализации.

~~~ts
export interface ArticleSectionPlan {
  readonly id: string;
  readonly title: string;
  readonly instructions: readonly string[];
  readonly targetWords: number | null;
  readonly dependsOn: readonly string[];
}

export interface ArticleConclusionPlan {
  readonly title: string;
  readonly instructions: readonly string[];
}

export interface ArticlePlan {
  readonly title: string;
  readonly sections: readonly ArticleSectionPlan[];
  readonly conclusion: ArticleConclusionPlan | null;
}

export interface GeneratedSection {
  readonly id: string;
  readonly title: string;
  readonly content: string;
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

export type PromptRequest =
  | {
      kind: 'section';
      topic: string;
      plan: ArticlePlan;
      section: ArticleSectionPlan;
      dependencies: readonly GeneratedSection[];
      index: number;
      total: number;
      isFirst: boolean;
    }
  | {
      kind: 'conclusion';
      topic: string;
      plan: ArticlePlan;
      sections: readonly GeneratedSection[];
    };

export type BuildPrompt = (request: PromptRequest) => string | Error;

export interface WriteArticleInput {
  readonly topic: string;
  readonly plan: ArticlePlan;
  readonly buildPrompt: BuildPrompt;
  readonly generateText: GenerateText;
  readonly concurrency: number | null;
  readonly signal: AbortSignal | null;
}

export type TextGenerationTarget =
  | {
      readonly kind: 'section';
      readonly id: string;
      readonly title: string;
      readonly index: number;
      readonly total: number;
      readonly targetWords: number | null;
    }
  | {
      readonly kind: 'conclusion';
      readonly title: string;
    };

export interface TextGenerationRequest {
  readonly prompt: string;
  readonly target: TextGenerationTarget;
  readonly signal: AbortSignal;
}

export interface TextGenerationResponse {
  readonly content: string;
  readonly usage: TokenUsage;
}

export type GenerateText = (
  request: TextGenerationRequest
) => Promise<TextGenerationResponse | Error>;

export interface GeneratedArticle {
  readonly sections: readonly GeneratedSection[];
  readonly content: string;
  readonly usage: TokenUsage;
}

export type SmartWriterError =
  | InvalidArticlePlanError
  | PromptBuildError
  | ContentGenerationError
  | WritingAbortedError;

export async function writeArticle(
  input: WriteArticleInput
): Promise<GeneratedArticle | SmartWriterError>;
~~~

`concurrency: null` означает документированный default `1`. Package всегда передаёт callback
действующий operation `AbortSignal`, даже если внешний signal равен `null`. Model ID, provider
options, temperature, token limits, `maxRetries`, timeout и telemetry замыкаются внутри
`generateText`. Package не принимает AI SDK types.

`TextGenerationResponse` означает уже нормализованный **complete** provider result. Host adapter
обязан преобразовать `length`, content filter, provider error и другие incomplete finish reasons
в `Error`; raw finish reason не входит в package API. Package дополнительно отклоняет пустой или
whitespace-only `content` как `ContentGenerationError`.

Structured target metadata даёт host adapter всё необходимое для progress/technical logs.
Отдельный generic `onEvent` в первой версии не нужен.

## Узкие DTO

Публичные типы описывают только структуру статьи, callback requests и provider-neutral result.
`ArticlePlan` не знает о DB template, research schema, SEO brief, price policy, категориях,
внутренних ссылках или конкретном языке.

Topic-specific данные не передаются как untyped property bag. Caller замыкает их внутри
`buildPrompt`, а package передаёт callback только типизированный `PromptRequest`. Так API
остаётся общим без runtime shape checks и plugin framework.

## Error contract

Package использует `errore`: ожидаемые failures возвращаются как `Error | T`, а happy path
остаётся на нулевом уровне вложенности.

Минимальный набор tagged errors:

- `InvalidArticlePlanError` — invalid input до callback: duplicate/missing/self/cycle dependency,
  пустой section ID либо некорректная concurrency; поле `reason` и связанные IDs различают
  причины без отдельного класса на каждый случай;
- `PromptBuildError` — `buildPrompt` failure с target metadata и `cause`;
- `ContentGenerationError` — `generateText` failure с target metadata и `cause`;
- `WritingAbortedError` — extends `errore.AbortError`.

Не нужны отдельные классы для каждой provider ошибки. Provider error остаётся в `cause`, а
host может найти его через cause chain.

Legacy app wrapper временно делает:

~~~ts
class GenerateStepError extends AppError {
  constructor(cause: Error) {
    super('Не удалось сгенерировать статью');
    this.cause = cause;
  }
}

const result = await writeArticle(input);
if (errore.isAbortError(result)) throw new JobCancelledError(jobId, result);
if (result instanceof Error) throw new GenerateStepError(result);
return toLegacyResult(result);
~~~

Конкретный app error нужно разместить рядом с adapter и согласовать с текущей hierarchy; смысл
примера — сохранить cause и не переписывать весь pipeline одновременно. Текущий
`JobCancelledError` следует расширить optional `cause`: abort package нельзя превращать в
generic failure, иначе внешний `pipeline` выполнит ветку `failed` вместо сохранения
`cancelled`.

## Scheduling contract

- IDs уникальны.
- План содержит хотя бы одну section; title плана, section и conclusion не пусты.
- Dependency ID обязан существовать.
- Один dependency ID не повторяется внутри одной section.
- Self-dependency запрещена.
- Cycle возвращает typed error до первого model call.
- Topological wave сохраняет outline-order внутри wave.
- Waves выполняются последовательно.
- Внутри wave одновременно выполняется не больше `concurrency` model calls.
- `concurrency: null` использует default `1`; любое заданное значение — целое число `>= 1`.
- Dependency context содержит только объявленные dependencies в стабильном outline-order.
- Finish order model calls не меняет result order.
- Только section с global plan index 0 получает `isFirst=true` в `PromptRequest`.
- При первой ошибке новые chunks не запускаются; in-flight calls получают abort signal.
- При гонке исходная первая failure остаётся result; sibling abort не заменяет её.

Это один нетривиальный pure module, а не scheduler framework.

## Prompt contract

- Package вызывает `buildPrompt` ровно один раз для каждой реально генерируемой target.
- `PromptRequest` содержит generic topic, plan, target metadata и готовые dependency sections.
- Topic-specific context, prompt templates, research, SEO и language rules замкнуты caller-ом
  внутри `buildPrompt`.
- Package не интерпретирует placeholder-ы и не содержит template engine.
- Ошибка callback оборачивается в `PromptBuildError` с `cause` и target metadata.
- `dependencies` и `isFirst` — разные понятия.
- Если host хранит prompts в БД, он загружает нужные versions один раз до `writeArticle` и
  замыкает единый snapshot внутри callback.
- В tarball нет travel prompt assets или другого topic-specific контента.

Перед запуском платных model calls package строит все prompts текущего chunk. Prompt failure
поэтому не оставляет уже запущенные model calls в том же chunk.

## Model boundary

Package не принимает AI SDK `LanguageModel` и не экспортирует AI SDK types. Он принимает
маленький `generateText` callback. Это решение даёт важные свойства:

- package не имеет peer dependency на быстро меняющийся AI SDK;
- AI SDK 6 -> 7 migration не меняет package API;
- package не знает о global providers и credentials;
- package tests используют простой scripted fake;
- app adapter отдельно тестирует реальный AI SDK с `MockLanguageModelV3`;
- provider-specific warnings/usage остаются рядом с provider.

Генерация prompt отделена вторым callback `buildPrompt`. Он не является plugin interface:
обычное замыкание позволяет caller-у использовать любые типизированные данные без их включения
в public API package.

## Observability policy

Отдельный observer/event abstraction не нужен.

- Pipeline логирует начало и конец generate step.
- Injected `generateText` получает prompt и target metadata, поэтому логирует section start,
  prompt, response, usage и completion.
- Technical/progress logging best-effort и не превращает успешный оплаченный model call в failed
  article. Это относится и к per-call логам, и к progress log после успешного
  `writeArticle`; только job-state writes остаются critical.
- Job status updates остаются critical и выполняются pipeline.
- Package не принимает `jobId`.
- Experimental AI SDK telemetry не включается скрыто; host включает её явно и отдельно решает,
  можно ли записывать prompt/response.

## Result contract

Package возвращает:

- ordered sections;
- готовый Markdown content;
- normalized token usage.

При failure package не возвращает partial article или partial usage. Per-call accounting при
неуспешной статье доступен host-у внутри `generateText` и его logging boundary.

Package не возвращает:

- отдельный `conclusion`, потому что downstream его не использует;
- wall-clock duration, потому что host измеряет полный use case;
- model cost, потому что pricing и model ID принадлежат host;
- DB/log metadata.

На compatibility period wrapper может добавить старые `fullContent` и
`totalDurationMs`, но это не public API package.

## Package format

Зафиксированная первая версия:

- отдельный публичный GitHub repository `spotsccc/smart-writer`;
- публичный scoped npm package `@spotsccc/smart-writer` с `access: public`;
- registry `https://registry.npmjs.org/`;
- minimum runtime Node.js `>=22`;
- лицензия MIT;
- explicit root export без public deep imports;
- dual ESM/CJS runtime output из-за текущего CJS server bundle;
- отдельные declarations для import/require;
- named exports;
- `files` allowlist;
- `sideEffects: false` только после import smoke;
- единственная runtime dependency — совместимая версия `errore`;
- package build через уже знакомый проекту `pkgroll`;
- `0.x` prerelease/`next` до registry smoke;
- точная package version в app до стабилизации.

Node рекомендует `exports` как современную public boundary:
[Node.js package entry points](https://nodejs.org/api/packages.html#package-entry-points).
`pkgroll` строит entries из package `exports` и поддерживает ESM/CJS/declarations:
[pkgroll](https://github.com/privatenumber/pkgroll).

## Маленькие задачи этапа

### D-01. Выбрать package name

- Решение: `@spotsccc/smart-writer`.
- Проверка: `npm view @spotsccc/smart-writer --registry=https://registry.npmjs.org/` вернул
  `404` 2026-07-13; перед первым publish проверить повторно и подтвердить доступ к scope.
- Статус: принято, registry permission ещё не проверен.

### D-02. Выбрать registry и access

- Решение: public npm registry, `publishConfig.access: public`, owner — `spotsccc`.
- Проверка: настроить npm Trusted Publishing для GitHub Actions либо отдельный scoped token.
- Готово, когда: publish identity имеет доступ только к `@spotsccc/smart-writer`, а release owner
  может снять dist-tag или выпустить исправленную version.

### D-03. Проверить production Node

- Решение: minimum runtime package — Node.js 22, `engines.node: ">=22"`.
- Проверка: package smoke выполняется на Node 22 и актуальном поддерживаемом LTS; production
  runtime AI Travel Core входит в диапазон.
- Готово, когда: manifest и CI matrix явно фиксируют Node 22 как нижнюю границу.

### D-04. Проверить module consumers

- Решение: package обязательно предоставляет dual ESM/CJS runtime exports и соответствующие
  `.d.mts`/`.d.cts` declarations.
- Проверка: packed-package stub проходит чистые `import` и `require` consumers; server build
  AI Travel Core использует CJS branch без `ERR_REQUIRE_ESM`.
- Готово, когда: обе runtime/type branches доказаны smoke tests.

### D-05. Зафиксировать prompt ownership

- Решение: package вызывает `buildPrompt`, а все prompt contents и topic-specific данные
  принадлежат caller-у.
- Проверка: public API не содержит `PromptKey`, DB/version entities, research/SEO/price DTO или
  untyped context bag.
- Готово, когда: travel prompts и их CRUD остаются в AI Travel Core.

### D-06. Зафиксировать provider ownership

- Решение: AI SDK, provider/model/API key остаются caller-у.
- Проверка: public API не импортирует `ai` или `@ai-sdk/provider`.
- Готово, когда: model boundary — один callback.

### D-07. Зафиксировать error policy

- Решение: четыре error categories, errors-as-values внутри package и legacy throw только в
  app adapter.
- Проверка: пример caller обязан проверить `instanceof Error`.
- Готово, когда: нет смешения throw/value внутри package-owned stack.

### D-08. Зафиксировать scheduling semantics

- Решение: waves, plan-order, bounded concurrency и cancellation rules из scheduling contract.
- Проверка: для chain, diamond и cycle ожидаемый порядок можно записать без обращения к code.
- Готово, когда: test matrix этапа 3 однозначна.

### D-09. Выбрать initial concurrency

- Решение: package default `1`; AI Travel Core начинает с explicit `3` только после проверки
  provider quota и rate-limit incidents.
- Проверка: `null` и `1` дают последовательные calls, `3` никогда не создаёт четвёртый in-flight
  call; dependencies по-прежнему задают waves.
- Готово, когда: default и app override покрыты behavioral tests, rollback value равен `1`.

### D-10. Зафиксировать retry owner

- Решение: caller-owned `generateText` единолично владеет `maxRetries` и timeout.
- Проверка: package orchestration не содержит повтор model call после provider error.
- Готово, когда: максимальное число платных attempts на section вычислимо.

### D-11. Зафиксировать release strategy

- Решение: отдельный GitHub repository -> packed tarball -> npm prerelease/`next` -> exact app
  version -> stable `latest`.
- Проверка: rollback выполняется изменением version/lockfile.
- Готово, когда: runtime feature flag и double generation не требуются.

### D-12. Утвердить non-goals

- Решение: исключить AI SDK major upgrade, весь application generation pipeline, plugin/preset
  registry, provider wrappers и встроенные travel/SEO/price prompt rules.
- Проверка: задачи следующих этапов не содержат этих работ.
- Готово, когда: package поддерживает любую тематику через `buildPrompt`, не превращаясь в
  extension framework.

### D-13. Зафиксировать лицензию

- Решение: package публикуется под лицензией MIT.
- Проверка: root manifest `~/code/smart-writer/package.json` содержит `license: "MIT"`, а
  `LICENSE` входит в allowlisted tarball.
- Готово, когда: manifest, README и packed artifact называют одну лицензию.

## Exit gate

Этап завершён, когда D-01 — D-13 имеют конкретные решения, public API не зависит от
приложения, а scheduling/error/prompt contracts достаточно точны для написания failing tests.
