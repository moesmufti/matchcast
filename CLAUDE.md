# matchcast

See README.md for architecture. Key rules:

- `src/domain/prediction.ts` must stay pure and deterministic — no Date.now, no Math.random, no I/O.
- The UI renders only from `MatchUpdate` snapshots via `LiveMatchProvider.subscribe`; keep match state out of components.
- API keys/secrets are worker-side only (`wrangler secret put`), never in `src/`.
- Run `npm test`, `npm run typecheck`, `npm run build` before committing.
