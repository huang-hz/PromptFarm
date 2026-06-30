# Release Checklist

Use this before publishing a GitHub release or uploading a zip package.

## Repository Hygiene

- [ ] `git status` only contains intentional changes.
- [ ] No API keys, tokens, exported backups, browser profiles, `.env` files, or private screenshots.
- [ ] `README.md` matches the current UI and permissions.
- [ ] `PRIVACY.md`, `SECURITY.md`, `LICENSE`, and `THIRD_PARTY_NOTICES.md` are present.
- [ ] Third-party notices are accurate.
- [ ] No ad hoc evaluation scripts or hard-coded API keys are present.

## Manual Extension Test

- [ ] Load unpacked extension in Chrome.
- [ ] Load unpacked extension in Edge, if supported for the release.
- [ ] First install initializes seed data.
- [ ] Search works with Chinese, English, pinyin full spelling, and pinyin initials.
- [ ] Create, edit, duplicate, favorite, and delete prompt.
- [ ] Restore and permanently delete from trash.
- [ ] Variable modal fills and previews correctly.
- [ ] Copy to clipboard works.
- [ ] Insert into a normal web page input works.
- [ ] Insert failure on restricted pages falls back gracefully.
- [ ] Import/export merge and replace work.
- [ ] Category and tag rename/delete/sort work.
- [ ] AI optimization shows configuration prompt when not configured.
- [ ] AI optimization works with a test provider/model when configured.

## Package

- [ ] Increment `manifest.json` version.
- [ ] Create a clean zip that excludes `.git`, `.github`, docs not needed in the extension package if desired, test scripts, logs, and backups.
- [ ] Create a GitHub release tag matching the manifest version.
- [ ] Attach the zip and include release notes.
