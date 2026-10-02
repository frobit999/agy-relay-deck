# Security policy

## What the dashboard protects

- The HTTP server binds to `127.0.0.1` only.
- Mutating requests require a random token generated at every launch and a matching local origin.
- Google refresh tokens, Antigravity Tools admin credentials, and API keys are never returned to the browser.
- The source conversation is opened read-only by the transplant tool.
- Every destination database is backed up before replacement.
- Database integrity, portable-table row counts, and preserved binding-table digests are checked after a transplant.
- A failed post-transplant verification triggers automatic rollback.
- Parallel branches are separate conversation databases; the dashboard never opens one conversation ID in multiple writers.
- Merge transcripts are treated as untrusted historical data, processed in plan+sandbox mode, and never executed as instructions.

## Important limitations

This is a local utility, not a security boundary against other software already running as your macOS user. Such software can normally read the same Antigravity CLI and Antigravity Tools files.

Only use accounts you own or are explicitly authorized to operate. Review and follow the terms that apply to the services you use. This project does not bypass authentication, create accounts, or alter provider-side quotas.

## Reporting a vulnerability

Please open a GitHub security advisory instead of a public issue when a report contains an exploitable vulnerability or sensitive details. Do not include real tokens, account files, conversation databases, or private prompts in reports.
