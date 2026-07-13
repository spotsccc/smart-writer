# Этап 3. Спроектировать тесты

## Цель этапа

До production-реализации связать каждый public/internal contract и каждый известный риск с
наблюдаемым тестом. На этом этапе проектируется matrix и fixtures; исполняемые package tests
добавляются вместе с соответствующими вертикальными срезами этапа 4. App adapter tests
реализуются только в integration branch этапа 5.

## Test boundary

Правило: mock uncontrollability, not dependencies.

- Graph, orchestration, Markdown и usage — настоящая package implementation.
- `buildPrompt` — простой deterministic callback или scripted failure; package не владеет его
  содержимым.
- `generateText` — scripted fake внешней модели с управляемыми deferred responses и signals.
- Реальные timers и сеть не используются.
- Packaging tests устанавливают настоящий `.tgz` в clean temporary consumers.
- На этапе 5 app prompt store использует test PostgreSQL и настоящие prompt builders; заменяется
  только external model boundary и deliberate logging faults.

Тесты проверяют result, порядок, callback requests, signals и errors. Они не проверяют private
helper choreography, конкретный graph algorithm или количество внутренних collections.

## Набор package fixtures

Достаточно маленького набора reusable data:

- plan с одной секцией;
- несколько independent sections;
- chain `A -> B -> C`;
- diamond `A -> B/C -> D`;
- plan с explicit conclusion;
- scripted text fake, умеющий вернуть response, Error, rejection или ждать abort;
- deferred primitive для управления completion order без реального времени.

Не нужен generic mock framework или builder DSL. Обычных object literals и нескольких локальных
test helpers достаточно.

## Matrix package behavior tests

### PT-01. Public happy path

Одна секция даёт exact ordered section, Markdown и normalized usage. Проверяется public
`writeArticle`, а не private functions.

### PT-02. Empty/invalid plan policy

Пустой plan, пустые structural titles и invalid concurrency дают `InvalidArticlePlanError` до
первого callback.

### PT-03. Graph validation

Отдельные cases: duplicate ID, empty ID, duplicate dependency edge, missing dependency,
self-dependency и cycle. Result — `InvalidArticlePlanError` с reason и связанными IDs; callbacks
не вызваны.

### PT-04. Chain

Для `A -> B -> C` prompt B видит A, prompt C видит только объявленную dependency B. Waves
выполняются последовательно.

### PT-05. Diamond

D получает B и C в plan-order независимо от completion order. A заканчивается до старта B/C,
D начинается после обоих.

### PT-06. Independent output order

Scripted model завершает independent calls в обратном порядке, но `sections` и Markdown остаются
в plan-order.

### PT-07. Global first section

Только section с plan index `0` получает `isFirst: true`; отсутствие dependencies на это не
влияет.

### PT-08. Bounded concurrency

Deferred fake считает active calls. Maximum не превышает `concurrency`; `null` использует default
`1`; dependencies по-прежнему ограничивают waves.

### PT-09. Dependency context

Callback получает только declared generated sections, без unrelated results, в стабильном
plan-order.

### PT-10. Explicit conclusion

Conclusion callback вызывается только при `plan.conclusion !== null`, после всех sections.
Без conclusion нет model call, Markdown block и usage.

### PT-11. Markdown normalization

Exact assertions фиксируют LF, trim внешних пустых строк, H1/H2, удаление повторного собственного
H2, понижение внутренних H2, `\n\n` между blocks и отсутствие trailing newline. Language
heuristics не тестируются в package.

### PT-12. Usage aggregation

Каждый response имеет отличимые token counts. Result равен сумме фактически успешных calls,
включая explicit conclusion и без несуществующего conclusion.

### PT-13. Prompt failure

Returned Error и throw из `buildPrompt` дают `PromptBuildError` с target/cause; model callback не
вызывается для target.

### PT-14. Model failure

Returned Error, rejected promise и empty/whitespace content из `generateText` дают
`ContentGenerationError` с target/cause; partial article/usage не возвращаются как success.

### PT-15. External abort

Abort до старта не вызывает callbacks. Abort во время wave доходит до in-flight fake, запрещает
новые chunks и возвращает `WritingAbortedError` без background work.

### PT-16. Abort siblings after failure

Один call возвращает failure, ожидающие siblings видят abort, следующая chunk/wave не стартует,
первичный cause не теряется.

### PT-17. Callback request metadata

Section target получает id/title/index/total/targetWords; conclusion получает свой target.
Package не добавляет model/provider settings.

### PT-18. Immutability

Input plan и callback-owned arrays не мутируются. Проверяется observable input после вызова, без
assertions на внутренние copy operations.

## Matrix package artifact tests

### PK-01. ESM runtime consumer

Clean Node 22 consumer устанавливает `.tgz` и импортирует named public exports.

### PK-02. CJS runtime consumer

Clean Node 22 consumer устанавливает тот же `.tgz` через `require` без `ERR_REQUIRE_ESM`.

### PK-03. TypeScript consumers

NodeNext и Bundler fixtures резолвят соответствующие `.d.mts`/`.d.cts` branches без
`skipLibCheck`.

### PK-04. Import purity

Import/require без ENV, DB и provider завершается без side effects и открытых handles.

### PK-05. Tarball allowlist

Artifact содержит только `dist`, `README.md` и `LICENSE`; source maps/declarations не содержат
`ai-travel-core`, app paths, Drizzle, Next, `env-var`, `ai` или `@ai-sdk/*`.

### PK-06. Package metadata

Manifest name, version, MIT, Node range, public registry и export targets совпадают с artifact.

## Matrix app integration tests для этапа 5

Эти tests проектируются сейчас, но создаются только в отдельной AI Travel Core branch.

### AT-01. Prompt assets contract

Tracked section/outline prompts, real substitution variables и schemas согласованы; failure
называет конкретный placeholder/field.

### AT-02. Prompt snapshot

Real test DB загружает active section/conclusion versions один раз до package call. Mid-run
activation не смешивает versions.

### AT-03. DTO mapping

App template/research/price data превращаются в узкий `ArticlePlan`; package не получает DB,
fact, SEO или price DTO.

### AT-04. Real prompt construction

App-owned `buildPrompt` использует настоящий prompt renderer, selected verified fact IDs и
section-specific price categories. Unknown fact ID даёт typed app input error до package/model.

### AT-05. AI SDK normalization

External model fake проходит через реальный host adapter. `stop` становится response;
`length`, content filter и provider error становятся Error с исходным cause.

### AT-06. Logging policy

Technical/progress logging failure после успешного model response не ломает article, но остаётся
видимым в fallback diagnostics. Job-state writes остаются critical.

### AT-07. Cancellation mapping

`WritingAbortedError` превращается в `JobCancelledError` с cause, pipeline не переводит job в
`failed` и model signal получает abort.

### AT-08. Compatibility result

Adapter возвращает необходимый legacy shape, host измеряет wall-clock duration и считает cost;
package result не расширяется app fields.

### AT-09. Pipeline seam

Реальный pipeline вызывает новый adapter через единственный `runGenerateStep` seam и передаёт
content следующему step.

### AT-10. Builds

Package artifact проходит server CJS build, Next build и app dependency resolution без соседнего
source checkout.

## Traceability

До реализации у каждой строки таблицы проблем этапа 2 должен быть хотя бы один PT/PK/AT test.
Каждый implementation slice этапа 4 перечисляет test IDs, которые сначала должны быть красными,
а затем зелёными.

## Exit gate

Этап завершён, когда:

- public behavior полностью выражено PT-матрицей;
- module-format и distribution risks выражены PK-матрицей;
- app compatibility risks выражены AT-матрицей, хотя app files ещё не меняются;
- внешняя модель — единственный обязательный fake на package behavior path;
- тесты не фиксируют private implementation;
- по каждому case понятны fixture, observable assertion и expected error category.
