# Privacy Policy

PromptFlash is designed as a local-first browser extension. This document explains what data is stored, when network requests happen, and why browser permissions are requested.

## Data Stored Locally

PromptFlash stores the following data in `chrome.storage.local`:

- Prompts and prompt metadata
- Categories and tag ordering
- Favorites, usage count, and last-used timestamps
- Deleted prompts in the local trash
- Display settings and theme preference
- User-managed provider/model catalog
- AI optimization configuration, including API key if the user enters one

This data is stored by the browser extension on the user's device. The project does not provide a backend service.

## Network Requests

PromptFlash does not send prompt data to a remote service by default.

Network requests happen only when the user uses AI optimization features:

- Fetching model lists from the configured AI provider
- Sending prompt content to the configured AI provider for question generation or optimization

The destination is controlled by the user through the AI settings:

- OpenAI-compatible endpoint
- Anthropic-compatible endpoint
- A custom Base URL entered by the user

PromptFlash does not proxy requests through a project-owned server.

## API Keys

If the user enters an API key, it is stored in `chrome.storage.local`.

Avoid using shared machines for sensitive keys. Remove the key from settings before exporting or sharing browser profiles.

## Web Page Access

PromptFlash can insert generated text into the active tab after a user action. To do that, it dynamically injects `content/inject.js` into the active page and looks for the focused editable element.

PromptFlash does not continuously monitor page content. It only attempts insertion when the user clicks an insert action.

## Permissions

| Permission | Reason |
| --- | --- |
| `storage` | Store local prompts, settings, trash, model catalog, and AI configuration |
| `sidePanel` | Show the extension side panel |
| `activeTab` | Access the current tab after user action |
| `scripting` | Inject the insertion helper into the active page |
| `contextMenus` | Search selected text from the right-click menu |
| `alarms` | Keep the MV3 service worker alive during long AI requests |
| `<all_urls>` | Allow requests to user-configured AI endpoints and support insertion on ordinary web pages |

## Data Export

The export feature creates a JSON backup containing prompts, categories, settings, search indexes, and content hashes. Review exported files before sharing them.

## Contact

If you find a privacy or security issue, please follow the process in [SECURITY.md](SECURITY.md).
