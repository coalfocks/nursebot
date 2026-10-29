# Compatibility proposal for pre-existing unpinned attempts

An assignment without a real `case_key_version` has no defensible immutable
MAR provenance. `scenario_baseline_version` is not a MAR case key, and the
current source cannot prove which authored packet was historically shown.

The shipped learner behavior therefore remains fail-closed: it explains that
the attempt has no immutable MAR snapshot and does not silently repin,
replay, reset, or substitute current authoring data.

The separately reviewable compatibility option is an admin-only read-only
historical view that shows:

- the assignment's recorded identifiers and timestamps;
- whether an immutable MAR packet or assignment snapshot exists;
- the exact packet/case-version provenance when one can be cryptographically
  or operation-log matched; and
- an explicit “not historically recoverable” state when that match cannot be
  established.

No student-facing MAR should be enabled for an unpinned attempt unless a
separate reviewed operation establishes that provenance without changing the
assignment row or its existing history. If no packet can be established, the
least disruptive supported option is the current assignment page plus
admin-only provenance status; the attempt remains unchanged.
