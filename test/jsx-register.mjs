/**
 * Registers the .jsx ESM loader hook for the test suite.
 * Loaded via `node --import ./test/jsx-register.mjs --test`.
 */
import { register } from 'node:module';
register('./jsx-loader.mjs', import.meta.url);
