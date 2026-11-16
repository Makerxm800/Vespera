/**
 * ESM loader hook: treat .jsx files as JavaScript.
 *
 * The renderer ships api.jsx (plain JS, no JSX syntax) and the Tauri server
 * serves it as text/javascript. Node's default loader rejects .jsx, so this
 * hook maps it to module format for the test suite.
 */
export async function load(url, context, nextLoad) {
  if (url.endsWith('.jsx')) {
    const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL(url), 'utf8'));
    return { format: 'module', source, shortCircuit: true };
  }
  return nextLoad(url, context);
}
