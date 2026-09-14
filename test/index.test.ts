import { afterEach, describe, expect, it, vi } from 'vitest';
import { hello } from '../src/index.js';

describe('hello', () => {
  afterEach(() => vi.restoreAllMocks());

  it('prints Hello, world! by default', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    hello();
    expect(log).toHaveBeenCalledWith('Hello, world!');
  });

  it('prints the given name', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    hello('Chao');
    expect(log).toHaveBeenCalledWith('Hello, Chao!');
  });
});
