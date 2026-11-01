# Contributing

This fork is based on [denysdovhan/purifier-card](https://github.com/denysdovhan/purifier-card). Keep the original MIT attribution.

## Development

Use Node.js 24 and npm 11 or newer (`.nvmrc` specifies Node 24).

```sh
npm ci
npx playwright install chromium
npm test
npm start
```

`npm start` serves the compiled module at `http://localhost:5000/xiaomi-purifier-card.js` and rebuilds when source changes. The browser accessing HA must be able to reach that address. An HTTPS HA page cannot load an HTTP resource; use a suitable HTTPS development server or copy the built file to HA instead.

- `npm run lint`: source lint and translation checks.
- `npm run typecheck`: strict TypeScript checking.
- `npm run test:unit`: model regression tests.
- `npm run build`: bundle to `dist/xiaomi-purifier-card.js`.
- `npm run test:browser`: Chromium tests against the local simulated-HA fixture.
- `npm test`: all checks in order.

Use Conventional Commits, for example `fix: update independent sensors`. Include validation results and a screenshot for visible UI changes. Follow `AGENTS.md` for repository conventions.

## Translations

Retain existing locale keys and the English fallback. Add new English text first. New translations should be supplied or reviewed by a native speaker, following the upstream contribution policy. Import new locale files in `src/localize.ts`, and update the documented language list. Automated key checks do not establish linguistic accuracy.

## Shutdown blueprint checks

Python 3.14 and the two test-only packages in `tests/requirements.txt` execute the actual YAML/Jinja branches in a simulated HA state machine:

```sh
python3 -m venv .venv-blueprint
. .venv-blueprint/bin/activate
python -m pip install -r tests/requirements.txt
npm run test:blueprint
```

These fifteen scenarios supplement `npm test`; CI runs them separately and the release workflow requires both suites. They do not replace an installation test in HA.

The public card type is `breeze-purifier-card`. Keep the legacy `xiaomi-purifier-card` and editor aliases working. The compiled asset intentionally retains `xiaomi-purifier-card.js` so HACS resource URLs keep working.

## Releases

Update `docs/RELEASE_NOTES.md`, commit the change, and push a version tag such as `v0.1.0`. The release workflow installs the locked dependencies, sets the package version from the tag, runs all checks, and creates a release with the finished JavaScript attached. The release is published only after the asset exists. HACS does not need an npm package.

Actual-device verification must be recorded separately from simulated-state tests.
