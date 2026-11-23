# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them privately through
GitHub: *Security → Report a vulnerability* on the repository
(https://github.com/hakim-AI-hub-88/Powernux/security/advisories/new).

You will get an answer within a few days. Thank you for helping keep Powernux users safe.

## How Powernux protects users

- **Signed tools**: every tool archive is signed with an Ed25519 key that never leaves the
  maintainer's machine / CI secrets. Powernux refuses any tool whose signature or SHA-256 does not match.
- **Strict validation** of tool identifiers and executables (no path traversal, no absolute paths).
- **Content Security Policy** on every window: only the application's own code can run.
- **API keys** are stored in the GNOME Keyring.
- **Dependency audits** (`cargo audit`, `npm audit`) and Dependabot alerts run on the repository.
