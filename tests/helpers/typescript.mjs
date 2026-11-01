import { registerHooks } from 'node:module';

// Match Rollup's extensionless TypeScript imports in Node's source-level tests.
const sourceRoot = new URL('../../src/', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      context.parentURL?.startsWith(sourceRoot) &&
      /^\.\.?\//.test(specifier) &&
      !/\.[a-z]+$/i.test(specifier)
    )
      return nextResolve(
        new URL(specifier + '.ts', context.parentURL).href,
        context,
      );
    return nextResolve(specifier, context);
  },
});
