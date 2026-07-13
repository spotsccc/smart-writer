# Этап 4. Реализовать package поэтапно

## Цель этапа

С нуля реализовать standalone `@spotsccc/smart-writer` в собственном repository. AI Travel Core
на этом этапе не меняется и не является build dependency. Работа идёт вертикальными срезами:
сначала выбранные tests этапа 3, затем минимальный production code, затем package gate.

Новая реализация может опираться на read-only исследование legacy behavior, но application code
не копируется вместе с зависимостями и не рефакторится на месте.

## Правило среза

Каждый срез:

1. Имеет один observable result.
2. Начинается с соответствующих PT/PK tests.
3. Добавляет минимальный production code для зелёного результата.
4. Не создаёт extension points для будущих срезов.
5. Завершается `typecheck`, выбранными tests и clean build.

## I-01. Standalone scaffold

Создать:

- `package.json` для `@spotsccc/smart-writer@0.1.0-next.0`;
- MIT `LICENSE` и package `README.md`;
- Node `>=22`, public npm metadata и `files` allowlist;
- strict Node-aware TypeScript config;
- pkgroll build с ESM/CJS и `.d.mts`/`.d.cts`;
- Vitest config и scripts `build`, `typecheck`, `test`, `pack:check`;
- собственный lockfile и CI matrix.

Проверка: PK-01 — PK-06 на временном stub export. Никаких install/postinstall scripts.

## I-02. Public types and errors

Реализовать утверждённые DTO/callback types и четыре tagged errors. Root index экспортирует только
public contract, без deep imports.

Проверка: type fixtures, error tags/properties/cause и отсутствие app/AI SDK types в declarations.

## I-03. Section graph

Реализовать semantic validation и deterministic waves в `section-graph.ts`.

Проверка: PT-02 — PT-05. На этом срезе callbacks и Markdown не нужны.

## I-04. Markdown

Реализовать generic section normalization и exact assembly в `markdown.ts`.

Проверка: PT-11. Не добавлять русские conclusion keywords или topic rules.

## I-05. Sequential article path

Реализовать `writeArticle` для default concurrency `1`: validation, section callbacks, dependency
context, ordering, optional conclusion, usage и final Markdown.

Проверка: PT-01, PT-04, PT-07, PT-09, PT-10, PT-12 и PT-17.

## I-06. Bounded parallel execution

Добавить wave chunks с explicit concurrency. Completion timing не влияет на result order.

Проверка: PT-05, PT-06 и PT-08. Не создавать общий worker-pool framework, если обычный chunk
loop выполняет contract.

## I-07. Error boundaries

Нормализовать returned/thrown/rejected callback failures в tagged errors с target/cause и
немедленным short-circuit.

Проверка: PT-13 и PT-14.

## I-08. Cancellation and sibling abort

Добавить external cancellation и operation-local sibling abort без background work.

Проверка: PT-15 и PT-16. Test fake управляет deferred calls без wall-clock ожиданий.

## I-09. Contract hardening

Закрыть request metadata, immutability и полный public API smoke.

Проверка: PT-17, PT-18, все package behavior tests, typecheck и lint.

## I-10. Packed artifact gate

Выполнить clean install/build/test, `npm pack`, `publint`, `@arethetypeswrong/cli --pack` и clean
ESM/CJS/NodeNext/Bundler consumers. Сохранить `.tgz`, checksum, source commit и file-list report.

Этот tarball — единственный вход этапа 5. Workspace link, relative import или установка соседнего
source tree запрещены.

## Quality gate после каждого среза

~~~text
npm run typecheck
npm test -- <tests среза>
npm run build
~~~

После I-10 дополнительно:

~~~text
npm test
npm pack --dry-run --json
publint .
attw --pack .
~~~

## Exit gate

Этап завершён, когда:

- весь утверждённый public behavior реализован и PT tests зелёные;
- artifact tests PK-01 — PK-06 зелёные против одного `.tgz` checksum;
- package source/declarations не содержат app-only dependencies;
- CI воспроизводит install, typecheck, tests, build и package analysis;
- готов immutable integration artifact;
- AI Travel Core ещё не изменён.
