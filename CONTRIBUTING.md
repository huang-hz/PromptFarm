# Contributing

Thanks for helping improve PromptFlash.

## Development Setup

No package installation is required for the current codebase.

1. Clone the repository.
2. Open `chrome://extensions/` or `edge://extensions/`.
3. Enable developer mode.
4. Load the repository folder as an unpacked extension.

## Code Style

- Keep the no-build, plain JavaScript architecture unless there is a clear reason to change it.
- Existing modules use IIFE files and the `PH.*` namespace.
- Prefer small, focused changes.
- Do not commit exported prompt backups, API keys, `.env` files, browser profile data, or generated test logs.
- Evaluation scripts under `tools/eval-*.mjs` must read keys from environment variables such as `PF_EVAL_API_KEY`, `DEEPSEEK_API_KEY`, or `VVEAI_API_KEY`.
- Keep UI copy concise and consistent with the existing Chinese interface.

## Testing Before a Pull Request

Please manually test the affected area. For broader changes, cover:

- Extension loads as unpacked extension
- Search works for Chinese, English, pinyin, and initials
- Prompt create/edit/delete/restore flows
- Variable modal, copy, and insert flows
- Import/export when data format changes
- AI settings and optimization flow if touched

## Pull Requests

In the PR description, include:

- What changed
- Why it changed
- Manual test results
- Any migration or compatibility notes

## Issues

When reporting a bug, include:

- Browser and version
- Extension version or commit
- Steps to reproduce
- Expected result
- Actual result
- Console errors if available
