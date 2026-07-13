# `@spotsccc/smart-writer`

Provider-neutral orchestration for generating structured articles.

The package is in initial prerelease development. Its public `writeArticle` API will accept an
article plan plus caller-owned prompt and text-generation callbacks; database access, AI providers,
credentials, prompts, logging, and topic-specific rules remain outside the package.

## Requirements

- Node.js 22 or newer.

## Development

```sh
npm ci
npm run typecheck
npm test
npm run pack:check
```

The architecture and extraction plan live in
[`docs/extraction`](https://github.com/spotsccc/smart-writer/tree/main/docs/extraction).

## License

MIT
