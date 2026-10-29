# MAR target inventory and minimum delta

Before any MAR installation or learner QA, run the read-only
`supabase/tests/mar-target-contract-inventory.sql` query set against the target
database. It reports relations/columns/RLS, every expected function signature
with an explicit installed/missing result and body, routine/table grants,
policies, trigger definitions/bodies, and managed migration rows for
`100009–100015`, `20261021130000`, `20261021141147`, `20261029170000`, and
`20261029173000`.

The minimum delta is the set of missing rows/contracts only. Do not replay an
accepted manual packet or rerun an already-installed migration. The target
audit must also confirm that the live function bodies match the reviewed source
before any write operation. Missing functions are returned as rows rather than
causing `has_function_privilege` to abort the inventory.

This inventory does not claim production state, full Auth-service/RLS proof,
or the 7/8/4 target packet readback. Those remain explicit prerequisites for a
Cole-approved MAR rollout. The disposable replay regression proves only the
immutable retry contract using synthetic data.
