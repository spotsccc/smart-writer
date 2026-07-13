import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'smart-writer-package-'));

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: options.env ?? process.env,
    maxBuffer: 10 * 1024 * 1024,
    timeout: options.timeout ?? 120_000,
  });

  if (result.error) {
    throw new Error(`Failed to run ${command}`, { cause: result.error });
  }

  if (result.status !== 0) {
    throw new Error(
      [
        `${command} ${args.join(' ')} exited with status ${result.status}`,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  if (options.expectNoOutput && (result.stdout !== '' || result.stderr !== '')) {
    throw new Error(
      `${command} produced output during a side-effect-free smoke test`,
    );
  }

  return result.stdout.trim();
}

function parseJsonObject(source, description) {
  const value = JSON.parse(source);

  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`${description} is not a JSON object`);
  }

  return value;
}

function createConsumer(name, type, tarball) {
  const directory = join(temporaryDirectory, name);
  mkdirSync(directory);
  writeFileSync(
    join(directory, 'package.json'),
    `${JSON.stringify({ name, private: true, type }, null, 2)}\n`,
  );
  run(
    npm,
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--no-save',
      '--package-lock=false',
      tarball,
    ],
    directory,
  );
  return directory;
}

try {
  const packOutput = run(
    npm,
    [
      'pack',
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      temporaryDirectory,
    ],
    root,
  );
  const packResult = JSON.parse(packOutput);

  if (
    !Array.isArray(packResult) ||
    packResult.length !== 1 ||
    typeof packResult[0]?.filename !== 'string' ||
    !Array.isArray(packResult[0].files) ||
    !packResult[0].files.every((file) => typeof file?.path === 'string')
  ) {
    throw new Error('npm pack returned an unexpected result');
  }

  const packed = packResult[0];
  const tarball = join(temporaryDirectory, packed.filename);

  const esmConsumer = createConsumer('esm-consumer', 'module', tarball);
  writeFileSync(
    join(esmConsumer, 'smoke.mjs'),
    [
      "import assert from 'node:assert/strict';",
      "import { scaffoldMarker } from '@spotsccc/smart-writer';",
      "assert.equal(scaffoldMarker, '@spotsccc/smart-writer');",
    ].join('\n'),
  );
  run(process.execPath, ['smoke.mjs'], esmConsumer, {
    env: {},
    expectNoOutput: true,
    timeout: 10_000,
  });
  console.log('PK-01 ESM runtime consumer: ok');
  const installedPackageRoot = join(
    esmConsumer,
    'node_modules',
    '@spotsccc',
    'smart-writer',
  );

  const cjsConsumer = createConsumer('cjs-consumer', 'commonjs', tarball);
  writeFileSync(
    join(cjsConsumer, 'smoke.cjs'),
    [
      "const assert = require('node:assert/strict');",
      "const { scaffoldMarker } = require('@spotsccc/smart-writer');",
      "assert.equal(scaffoldMarker, '@spotsccc/smart-writer');",
    ].join('\n'),
  );
  run(process.execPath, ['smoke.cjs'], cjsConsumer, {
    env: {},
    expectNoOutput: true,
    timeout: 10_000,
  });
  console.log('PK-02 CJS runtime consumer: ok');

  const typesConsumer = createConsumer('types-consumer', 'module', tarball);
  writeFileSync(
    join(typesConsumer, 'nodenext.mts'),
    [
      "import { scaffoldMarker } from '@spotsccc/smart-writer';",
      "const marker: '@spotsccc/smart-writer' = scaffoldMarker;",
      'void marker;',
    ].join('\n'),
  );
  writeFileSync(
    join(typesConsumer, 'nodenext.cts'),
    [
      "import smartWriter = require('@spotsccc/smart-writer');",
      "const marker: '@spotsccc/smart-writer' = smartWriter.scaffoldMarker;",
      'void marker;',
    ].join('\n'),
  );
  writeFileSync(
    join(typesConsumer, 'bundler.ts'),
    [
      "import { scaffoldMarker } from '@spotsccc/smart-writer';",
      "const marker: '@spotsccc/smart-writer' = scaffoldMarker;",
      'void marker;',
    ].join('\n'),
  );
  writeFileSync(
    join(typesConsumer, 'tsconfig.nodenext-esm.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2023',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          types: [],
        },
        files: ['./nodenext.mts'],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(typesConsumer, 'tsconfig.nodenext-cjs.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2023',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          types: [],
        },
        files: ['./nodenext.cts'],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(typesConsumer, 'tsconfig.bundler.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2023',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          types: [],
        },
        files: ['./bundler.ts'],
      },
      null,
      2,
    )}\n`,
  );

  const typescript = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  const nodeNextEsmFiles = run(
    process.execPath,
    [typescript, '--project', 'tsconfig.nodenext-esm.json', '--listFiles'],
    typesConsumer,
  );
  const nodeNextCjsFiles = run(
    process.execPath,
    [typescript, '--project', 'tsconfig.nodenext-cjs.json', '--listFiles'],
    typesConsumer,
  );
  const bundlerFiles = run(
    process.execPath,
    [typescript, '--project', 'tsconfig.bundler.json', '--listFiles'],
    typesConsumer,
  );
  const installedDist = join(
    typesConsumer,
    'node_modules',
    '@spotsccc',
    'smart-writer',
    'dist',
  );
  assert.ok(nodeNextEsmFiles.includes(join(installedDist, 'index.d.mts')));
  assert.ok(!nodeNextEsmFiles.includes(join(installedDist, 'index.d.cts')));
  assert.ok(nodeNextCjsFiles.includes(join(installedDist, 'index.d.cts')));
  assert.ok(!nodeNextCjsFiles.includes(join(installedDist, 'index.d.mts')));
  assert.ok(bundlerFiles.includes(join(installedDist, 'index.d.mts')));
  assert.ok(!bundlerFiles.includes(join(installedDist, 'index.d.cts')));
  console.log('PK-03 TypeScript consumers: ok');

  console.log('PK-04 import purity: ok');

  const installedManifest = parseJsonObject(
    readFileSync(join(installedPackageRoot, 'package.json'), 'utf8'),
    'installed package.json',
  );
  const packedFiles = packed.files.map((file) => file.path).sort();
  assert.deepEqual(packedFiles, [
    'LICENSE',
    'README.md',
    'dist/index.cjs',
    'dist/index.d.cts',
    'dist/index.d.mts',
    'dist/index.mjs',
    'package.json',
  ]);
  const forbiddenContent = [
    /ai-travel-core|@ai-sdk\/|drizzle(?:-orm|-zod)|env-var/iu,
    /(?:from\s+|import\s*(?:\(\s*)?|require\s*\(\s*)['"](?:ai|next(?:\/[^'"]*)?)['"]/u,
    /(?:\/Users\/|\/home\/|[A-Za-z]:\\|src[\\/]libs[\\/]generation)/u,
  ];
  for (const file of packedFiles.filter((path) => path.startsWith('dist/'))) {
    const content = readFileSync(join(installedPackageRoot, file), 'utf8');
    for (const pattern of forbiddenContent) {
      assert.doesNotMatch(content, pattern);
    }
  }
  const forbiddenDependency = /^(?:ai|next|env-var|@ai-sdk\/.+|drizzle(?:-.+)?)$/u;
  for (const field of [
    'dependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    const dependencies = installedManifest[field];
    if (dependencies === undefined) continue;
    if (
      dependencies === null ||
      Array.isArray(dependencies) ||
      typeof dependencies !== 'object'
    ) {
      throw new Error(`${field} is not a JSON object`);
    }
    for (const dependency of Object.keys(dependencies)) {
      assert.doesNotMatch(dependency, forbiddenDependency);
    }
  }
  console.log('PK-05 tarball allowlist: ok');

  assert.equal(installedManifest.name, '@spotsccc/smart-writer');
  assert.equal(installedManifest.version, '0.1.0-next.0');
  assert.equal(installedManifest.license, 'MIT');
  assert.equal(installedManifest.sideEffects, false);
  assert.deepEqual(installedManifest.files, ['dist']);
  assert.deepEqual(installedManifest.engines, { node: '>=22' });
  assert.deepEqual(installedManifest.publishConfig, {
    access: 'public',
    registry: 'https://registry.npmjs.org/',
  });
  assert.deepEqual(installedManifest.exports, {
    '.': {
      import: {
        types: './dist/index.d.mts',
        default: './dist/index.mjs',
      },
      require: {
        types: './dist/index.d.cts',
        default: './dist/index.cjs',
      },
    },
  });
  assert.equal(installedManifest.scripts?.preinstall, undefined);
  assert.equal(installedManifest.scripts?.install, undefined);
  assert.equal(installedManifest.scripts?.postinstall, undefined);
  console.log('PK-06 package metadata: ok');
} finally {
  rmSync(temporaryDirectory, { force: true, recursive: true });
}
