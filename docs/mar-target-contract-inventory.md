# MAR target inventory and minimum delta

Before any MAR installation or learner QA, run the read-only
`supabase/tests/mar-target-contract-inventory.sql` query set against the target
database. It reports relations, exact function signatures/execution modes,
the assignment snapshot trigger, authenticated RPC grants, and the managed
migration rows for `100009–100015`, `20261021130000`, `20261021141147`,
`20261029170000`, and `20261029173000`.

The minimum delta is the set of missing rows/contracts only. Do not replay an
accepted manual packet or rerun an already-installed migration. The target
audit must also confirm that the live functions match the reviewed signatures
before any write operation.

This inventory does not claim production state, full Auth-service/RLS proof,
or the 7/8/4 target packet readback. Those remain explicit prerequisites for a
Cole-approved MAR rollout. The disposable replay regression proves only the
immutable retry contract using synthetic data.
