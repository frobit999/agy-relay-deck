# Changelog

## 2.5.1

- Prevent a newly cloned branch from briefly showing the two-step placeholder count after transplant verification.
- Floor displayed branch steps at the verified clone baseline while the Antigravity summary database catches up.
- Invalidate the target size cache after transplant and prioritize active-room Brain measurements.
- Use the parent branch size as a temporary display fallback for a verified clone with stale summary metadata.

## 2.5.0

- Retire an individual stopped branch from the active room into a dedicated macOS Trash archive.
- Keep a per-branch restore manifest and expose recovery until the Trash is emptied.
- Exclude retired branches from room handoff, merge, process launch, and the six-window active limit.
- Block retirement of a running branch, the final active branch, or a branch with active descendants.
- Keep retirement and recovery explicit, per-window, and confirmation-gated in the current-room card.

## 2.4.1

- Name cloned branches by their source family: A→A1/A2 and B→B1/B2.
- Keep descendants in the same family while still recording the immediate parent branch.

## 2.4.0

- Clone any stopped window into a new independent branch inside the same room, up to six branches.
- Preserve exact conversation rows, brain data, account binding, and the source branch unchanged.
- Keep the new branch closed after verification so it does not consume memory until explicitly opened.
- Track branch lineage and count future changes from the clone point rather than the original room split.
- Keep cloned branches out of the complete-trunk selector so later semantic merges do not duplicate inherited history.
- Allow unrelated sibling windows to keep running when the source branch and account state are safe.

## 2.3.1

- Add an independent Open button to every branch in the current room.
- Show per-branch running state from the exact `--conversation` process argument.
- Change the room action dynamically between Open all, Open remaining, and All running.
- Refuse to launch a duplicate process for a branch that is already active.

## 2.3.0

- Replace the presentation-style dashboard with a quiet, task-first local utility interface.
- Put the newest usable room in a dedicated current-work card with persistent window status and actions.
- Collapse previous generations, recovery points, and failed attempts into a compact room archive.
- Move account quota and launch permissions into a narrow contextual sidebar.
- Hide room creation, single-conversation relay, and semantic branch merge behind explicit disclosures.
- Remove decorative gradients, oversized slogans, particle/noise effects, and control-deck terminology.

## 2.2.0

- Add transactional whole-room account handoff: A→A′, B→B′, C→C′ without merging or summarizing branches.
- Keep the original room untouched until every target conversation passes database, row-count, and binding verification.
- Restore the previous account and target placeholders automatically when a room handoff fails.
- Open the new room automatically, require explicit user verification, and retain the old room as a recoverable safety point.
- Allow verified old-account copies to be moved to macOS Trash and restored before Trash is emptied.
- Move semantic branch convergence behind an advanced disclosure so routine quota changes use exact per-window handoff.

## 2.1.0

- Remove the mandatory final model-generated consolidation turn after all merge shards succeed.
- Treat the ordered per-shard memory checkpoints as the canonical merged memory and move directly to user verification.
- Prevent a final cascade-start timeout from rolling back already-successful shard ingestion.
- Record conflicts inside each shard checkpoint so the user can inspect them in the verification turn.

## 2.0.3

- Treat `timeout waiting for cascade to start running` and related context/startup deadline errors as retryable.
- Raise merge shard attempts from four to six for very large resumed conversations.
- Use longer startup backoff intervals (5s, 10s, 15s, 30s, 30s) before declaring a shard failed.

## 2.0.2

- Retry transient merge API failures (`retryable:true`, EOF, connection resets, 429, and common 5xx responses) up to four times with exponential backoff.
- Keep retries scoped to the current shard instead of rolling back the entire merge after the first network interruption.
- Increase merge shard size from roughly 220 KB to 700 KB to reduce repeated CLI startup and long-history replay overhead.
- Remove the conflicting `--disable-slash-commands` flag from plan-mode merge turns.

## 2.0.1

- Scope cleanup safety checks to the exact old branch conversation IDs instead of blocking on every running `agy` process.
- Allow a newer generation's A/B/C windows to keep running while the previous generation is moved to Trash or restored.
- Scope canonical verification to the new mother conversation only.

## 2.0.0

- Add generation-aware conversation roles and prevent active branches or old mothers from being split again.
- Hide ineligible branches from the new-room picker and label verified canonical mothers by generation.
- Recommend the branch with the largest delta as the full merge trunk.
- Refuse no-op merges when every branch is still at `+0`.
- Require explicit post-merge verification before cleanup becomes available.
- Move verified A/B/C branch databases, brains, annotations, and backups to a room-specific macOS Trash folder.
- Save a recovery manifest and allow one-click restoration until the Trash is emptied.
- Keep the previous mother conversation as the rollback anchor while removing the bulky parallel copies.

## 1.1.2

- Add a persistent local preference for launching conversations with `--dangerously-skip-permissions`.
- Apply the preference consistently to single handoffs, every parallel room window, and merged canonical conversations.
- Keep the dangerous mode disabled by default for new installations and show an explicit warning beside the toggle.

## 1.1.1

- Show each conversation's local storage size beside its step count.
- Count the SQLite database (including WAL/SHM), brain directory, transcripts, artifacts, and annotation.
- Cache recursive brain measurements for one minute to keep dashboard refreshes responsive.

## 1.1.0

- Add parallel memory rooms with 2–6 independently writable conversation windows.
- Track a shared split point and extract only each sibling window's new transcript events.
- Add account-switching convergence into a new canonical conversation.
- Split large merge dossiers into bounded shards and absorb them sequentially in plan+sandbox mode.
- Keep the selected primary branch byte-for-byte through the existing transplant path.
- Preserve every source branch and automatically roll back a failed convergence target.
- Use APFS copy-on-write clones for large brain directories when available.

## 1.0.0

- Initial local quota dashboard and single-conversation account handoff flow.
