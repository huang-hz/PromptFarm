# Security Policy

## Supported Versions

Security fixes target the latest version on the default branch unless release branches are created later.

## Reporting a Vulnerability

Please do not open a public issue for sensitive vulnerabilities.

Report privately through GitHub Security Advisories if enabled for the repository. If that is not available, contact the maintainer privately and include:

- Affected version or commit
- Steps to reproduce
- Impact
- Any suggested fix or mitigation

## Sensitive Data

Do not include real API keys, browser profile data, exported prompt backups with private content, or screenshots containing secrets in public issues or pull requests.

## Extension-Specific Notes

PromptFlash stores user data and optional AI API keys in `chrome.storage.local`. Treat access to an installed browser profile as access to this extension's local data.
