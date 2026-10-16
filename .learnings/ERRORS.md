# Errors

## [ERR-20261016-001] missing-typecheck-script

**Logged**: 2026-10-16T05:19:30Z
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
The repository has no `typecheck` npm script; validation must use the declared build/lint scripts.

### Error
```text
npm error Missing script: "typecheck"
```

### Context
- Attempted `npm run typecheck` after focused Vitest tests.
- `package.json` declares `build`, `lint`, and `test:run`, but not `typecheck`.

### Suggested Fix
Use `npm run build` and `npm run lint` for this repository unless a dedicated TypeScript script is added.

### Metadata
- Reproducible: yes
- Related Files: package.json

---
