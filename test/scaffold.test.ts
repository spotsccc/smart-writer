import { describe, expect, it } from 'vitest';

import { scaffoldMarker } from '../src/index.js';

describe('package scaffold', () => {
  it('exposes the temporary root entrypoint', () => {
    expect(scaffoldMarker).toBe('@spotsccc/smart-writer');
  });
});
