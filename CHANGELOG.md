# Changelog

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
