# Этап 5. Заменить реализацию в AI Travel Core

## Цель этапа

В отдельной ветке AI Travel Core подключить проверенный artifact, создать app-owned adapter и
переключить единственный production consumer. Старый local core удаляется только после app gates.

До начала зафиксировать:

- base commit AI Travel Core;
- package source commit;
- `.tgz` checksum и file-list report из I-10;
- branch name и rollback commit.

## Почему отдельная ветка достаточна

Новая package implementation уже завершена и тестируется независимо. Integration branch содержит
только application responsibilities: mapping, prompt/model adapters, compatibility и wiring. Это
делает diff обозримым и позволяет отменить замену обычным revert/version rollback.

## Порядок интеграции

### G-01. Создать integration branch

Ответвиться от зафиксированного app base commit. Не смешивать ветку с AI SDK major upgrade,
unrelated generation refactoring или новыми product features.

### G-02. Добавить app-side contract baseline

До переключения consumer реализовать необходимые AT-01 tests для tracked prompts и уточнить
фактически нужный legacy result shape. Тестировать observable application contract, а не private
call order старого `generate.ts`.

### G-03. Установить exact artifact

Установить сохранённый `.tgz` как exact dependency и lockfile entry. Проверить, что resolution не
использует workspace/symlink или `~/code/smart-writer/src`.

### G-04. Создать DTO mapper

Преобразовать app template/outline в `ArticlePlan`. Travel-, SEO-, research-, price- и DB fields
не проходят package boundary. App-only cross-object invariants проверяются до `writeArticle`.

Проверка: AT-03.

### G-05. Создать prompt snapshot и `buildPrompt`

Загрузить active section/conclusion prompts один раз перед package call и замкнуть snapshot,
verified ledger, price/category rules и real renderer внутри callback.

Проверка: AT-01, AT-02 и AT-04.

### G-06. Создать `generateText` adapter

Замкнуть AI SDK model, provider options, token limits, explicit retry/timeout и telemetry policy.
Передать package signal в model call. Нормализовать text/usage; incomplete finish reasons вернуть
как Error с cause/target diagnostics.

Проверка: AT-05.

### G-07. Подключить logging и cancellation

Per-call prompt/response/progress logs остаются в host callback и работают best-effort. Job-state
writes остаются critical. Package abort маппится в `JobCancelledError`, не в generic failure.

Проверка: AT-06 и AT-07.

### G-08. Реализовать compatibility boundary

Временный `runGenerateStep` wrapper:

- измеряет elapsed wall-clock;
- вызывает `writeArticle`;
- преобразует package result в минимально нужный legacy shape;
- считает app-owned cost/metrics;
- сохраняет cause при error mapping.

Проверка: AT-08.

### G-09. Переключить единственный consumer

Pipeline начинает вызывать adapter/package path. Старый и новый model calls не запускаются
параллельно; runtime comparison flag не добавляется.

Проверка: AT-09 и существующие pipeline tests.

### G-10. Прогнать app gates

Минимально:

~~~text
npm run test:unit -- <prompt и adapter tests>
npm run test:module
npm run build:server
npm run next:build
npm run lint
~~~

Дополнительно проверить dependency tree, CJS resolution, cancellation и отсутствие background
model calls. Проверка AT-10 должна использовать installed artifact.

### G-11. Удалить local core

После зелёных app gates удалить package-owned orchestration, graph/Markdown copies и лишние
re-exports из AI Travel Core. Оставить adapter, app prompt tests и compatibility exports, которые
имеют реальных consumers.

### G-12. Опубликовать prerelease

Опубликовать тот же проверенный package source как новую immutable prerelease с dist-tag `next`,
повторить registry ESM/CJS/type consumers и заменить tarball dependency на exact registry version.
Изменение package code требует нового artifact и полного повторения gates.

Если adapter невозможно реализовать без нарушения ownership или unsafe type cast, integration не
продолжается локальным обходом. Public/internal contract возвращается на этапы 1–3, исправляется
новой package version и повторно проходит I-10.

### G-13. Canary и stable rollout

До canary зафиксировать baseline latency, usage, cancellation и error taxonomy. Проверить real
jobs без двойной генерации, prompt consistency и provider rate limits. После observation window
назначить stable version/tag и оставить exact version в app lockfile.

### G-14. Cleanup

После stable rollout удалить только доказанно неиспользуемые compatibility result fields,
`assembleContent` re-export, dead word/conclusion representations и временные boundary checks.
Обновить app architecture docs.

## Rollback

До publish — revert integration commits и lockfile к зафиксированному base. После publish —
версии не перезаписывать; вернуть предыдущую exact dependency, собрать и развернуть приложение.
Package runtime flag и двойная live generation не нужны.

## Exit gate

Этап завершён, когда:

- production consumer импортирует exact registry version package;
- app содержит только composition/compatibility adapter, а не editable core copy;
- AT-01 — AT-10 и app builds зелёные;
- cancellation, finish reasons, logs, prompt snapshot и metrics подтверждены на canary;
- stable rollout завершён и rollback target однозначен;
- legacy cleanup не удаляет app-owned prompt/model/job responsibilities.
