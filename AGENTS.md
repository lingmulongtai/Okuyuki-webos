# Development contract
- Follow docs/SPEC.md. Alpha scope is the first version, not v1.0.
- Preserve small, coherent Conventional Commits. Review staged changes before committing.
- Do not commit photos, secrets, local configuration, caches, generated test media, or build artifacts.
- Run `npm run check`, `npm run tv:lint`, `npm run tv:test`, `npm run tv:build` and `npm run test:browser` before pushing.
- Physical LG TV acceptance is separate from CI and browser checks.
- The phone-side protocol lives in Okuyuki-android; keep shared JSON fixtures identical in both repositories.
