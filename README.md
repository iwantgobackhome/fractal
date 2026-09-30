<p align="center"><strong>English</strong> · <a href="README.ko.md">한국어</a> · <a href="README.ja.md">日本語</a> · <a href="README.zh-CN.md">简体中文</a></p>

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/logo-dark.svg"><img src="docs/assets/readme/logo.svg" width="280" alt="Fractal logo"></picture></p>

<h1 align="center">Read deeper. Discover further.</h1>

<p align="center">A research reader, library, and discovery desk powered by your Codex or Claude subscription.</p>

<p align="center">
  <img alt="Apache 2.0 license" src="https://img.shields.io/badge/license-Apache--2.0-3b625b">
  <img alt="Windows, macOS, and Android" src="https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Android-3b625b">
  <img alt="Node.js 22.12 or newer" src="https://img.shields.io/badge/Node.js-%E2%89%A522.12-3b625b">
  <img alt="Electron and React" src="https://img.shields.io/badge/desktop-Electron%20%2B%20React-3b625b">
  <img alt="Kotlin and Compose" src="https://img.shields.io/badge/Android-Kotlin%20%2B%20Compose-3b625b">
  <img alt="Codex and Claude AI providers" src="https://img.shields.io/badge/AI-Codex%20%7C%20Claude-3b625b">
</p>

<p align="center"><a href="#quick-start">Quick start</a> · <a href="#features">Features</a> · <a href="docs/">Docs</a></p>

![Fractal home feed in English, dark theme](docs/assets/readme/home-en-dark.png)

**From the paper in front of you to the next one worth reading.** Put the original PDF beside a faithful translation. Ask questions and follow answers back to cited pages. Track papers and news in your fields, then save what matters. Fractal uses the Codex or Claude CLI sign-in tied to your existing subscription; you do not need to supply an API key.

## Features

### Read with the source in sight

| Original and translation                                                                                                                             | Ask the paper                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| ![Original PDF beside translated pages](docs/assets/readme/reader-split-translation.png)                                                             | ![Question answered with page citations](docs/assets/readme/reader-ask.png)                                    |
| Keep the PDF and translation side by side, with linked scrolling. Change the translation language without losing completed work in another language. | Ask about the paper and inspect page citations. Select a figure, table, or equation for a focused explanation. |

Highlight passages, attach notes, and draw with pen or highlighter ink. Export a translated PDF, including a side-by-side layout, from the desktop app. The library also exports BibTeX, CSL-JSON, and paper notes as Markdown.

| Explain a detail                                                                            | Find the next paper                                                                                  |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| ![Explanation of an equation in the reader](docs/assets/readme/reader-explain-equation.png) | ![Related papers beside the reader](docs/assets/readme/reader-related-en-dark.png)                   |
| Open an explanation where you are reading.                                                  | Browse references, citations, and related work; availability depends on external scholarly services. |

### Keep a useful library

Open an arXiv ID, DOI, public paper URL, or local PDF. Search saved papers, group them into collections, add tags, and keep highlights, notes, ink, and conversations with each paper. Fractal imports verified data from an older PaperRead directory on first launch without changing the original.

### Follow your field

![Search the full arXiv category list and add your own interests](docs/assets/readme/interests-search.png)

The home feed brings together arXiv papers, Hugging Face Daily Papers, field news, and recommendations informed by your library. Follow the full arXiv category taxonomy, authors, and your own search fields. Within a field, follow curated or personal topics and see topic-specific news.

| Field and topic news                                         | Article reading                                                                                                                                      |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| ![Followed topics in Fractal](docs/assets/readme/topics.png) | Open supported public articles in a plain-text reading view and quickly translate titles or passages. Publisher restrictions can prevent extraction. |

### Use your AI accounts

![Codex and Claude setup screen](docs/assets/readme/welcome-ai-setup.png)

Fractal connects through the official Codex and Claude CLIs. Sign in from the app or use an existing terminal login; add separate managed accounts and switch the active account for each provider. The setup screen can install supported CLIs and start sign-in; manual commands are shown where automatic installation is unavailable. Choose a default model and feature-specific overrides. Five-hour and weekly usage bars show provider-reported limits when available, and say so when they are not.

### Continue on Android

![Fractal reader on an Android tablet](docs/assets/readme/android-tablet-reader.png)

Pair the Kotlin/Compose companion with a desktop hub by scanning a QR code. Read cached PDFs and sync the library and annotations, including pen strokes, over a trusted LAN or Tailscale. The desktop hub remains the source for AI and discovery features.

### Read in your language

The interface supports Korean and English. Translation and answer preferences support Korean, English, Japanese, Simplified and Traditional Chinese, German, French, Spanish, and other BCP 47 language tags. Translation results are saved per target language.

## How it works

```mermaid
flowchart LR
    UI[React reader and home] <--> Hub[Node hub and local SQLite library]
    Desktop[Electron desktop] --> UI
    Android[Android companion] <-->|Pairing and sync| Hub
    Hub -->|Chosen AI requests| CLI[Codex or Claude CLI]
    Hub -->|Discovery and metadata| Sources[arXiv · Hugging Face · Semantic Scholar · OpenAlex · news feeds]
```

The desktop app runs the hub and UI together. You can also run the hub and open its loopback address in a browser. Android connects to that hub after pairing.

## Quick start

**Requirements:** Node.js 22.12 or newer and npm. For AI features, install and sign in to the Codex or Claude CLI, or use Fractal's supported setup flow. Building Android also requires JDK 17 and the Android SDK.

From the repository root:

```sh
npm ci
npm run desktop
```

`npm run desktop` builds and opens the Electron app on Windows or macOS. To build the **Windows NSIS installer** on Windows, run `npm run desktop:dist`; output goes to `dist/installer/`. A macOS DMG target is configured, but this command builds the Windows installer only.

For the hub and browser UI without the desktop shell:

```sh
npm run build
npm run hub
```

Open `http://127.0.0.1:7327/`. Set `PAPERREAD_PORT` to change the hub port. The Electron app uses an available port of its own.

For Android, open `apps/android` in Android Studio or build from its directory:

```sh
./gradlew :app:assembleDebug
```

On Windows, use `gradlew.bat :app:assembleDebug`. Install `apps/android/app/build/outputs/apk/debug/app-debug.apk`, then enable LAN or Tailscale in the desktop app's device connection settings and scan its pairing QR code. A phone or tablet must be able to reach the hub address; the Android emulator reaches the host as `10.0.2.2`.

**Local data:** Windows uses `%LOCALAPPDATA%\Fractal`; macOS and other Unix systems use `${XDG_DATA_HOME:-~/.local/share}/fractal`. `FRACTAL_DATA` overrides the data directory. Saved papers, PDFs, account settings, and pairing records live there.

## Privacy and safety

- Paper text is sent to the **selected** Codex or Claude CLI when you request translation, an answer, an explanation, or another AI task. Fractal asks the CLIs to run without tools and refuses Codex configurations it cannot isolate safely. It does not read CLI credential files; the CLIs handle sign-in and requests.
- Discovery fetches public paper metadata and news from external feeds and scholarly services. Opening an article fetches its publisher page. Quick news translation sends the requested text to an **unofficial Google Translate web endpoint**; it may stop working. An explicit AI fallback can instead use the selected provider.
- Remote devices use a pairing token. Ordinary LAN connections use **HTTP**, so use a trusted network or Tailscale. Tailscale encrypts traffic; the hub itself does not provide TLS. You can use `tailscale serve` for optional HTTPS and configure that URL after pairing.

See the [HTTP API and transport notes](docs/API.md) for the precise request guards and token behavior.

## Built with

| Layer           | Technology                                |
| --------------- | ----------------------------------------- |
| Desktop         | Electron, React, TypeScript, Vite, PDF.js |
| Hub and storage | Node.js, TypeScript, SQLite, FTS5         |
| Android         | Kotlin, Jetpack Compose, Room, CameraX    |
| AI              | Codex CLI, Claude CLI                     |

```text
apps/
  desktop/       Electron window, tray, and embedded hub
  android/       Kotlin reader, pairing, cache, and ink
packages/
  shared/        API contracts, schemas, and design tokens
  hub/           Local HTTP API, storage, discovery, and AI routing
  ui/            React home, library, and PDF reader
```

## Troubleshooting

<details>
<summary>AI shows “not connected”</summary>

Check the app's AI settings. Install the chosen CLI and finish its browser sign-in, or verify `codex login status` / `claude auth status` in a terminal. You can retry sign-in from the account panel. An available subscription and model are required for AI requests.

</details>

<details>
<summary>Codex reports a “safe runtime” problem</summary>

Fractal stops generation if it cannot verify its isolated, tool-free Codex session. Check custom instructions in your Codex `config.toml` and any enabled MCP server configuration, then retry. See [the AI API notes](docs/API.md) for the current safeguards.

</details>

<details>
<summary>The hub port is already in use</summary>

Stop the other hub or set a different `PAPERREAD_PORT` before running `npm run hub`. The Electron app chooses an available port automatically.

</details>

<details>
<summary>Claude usage limits are unavailable</summary>

Fractal reads the limits exposed by the CLI. Its interactive usage screen or terminal support may be unavailable; the app displays “unavailable” instead of guessing. AI requests can still work.

</details>

<details>
<summary>Related papers say Semantic Scholar is busy</summary>

The service may rate-limit requests. Fractal tries OpenAlex as a fallback and returns a retryable error if neither can provide results. Try again later; cached results remain available offline.

</details>

## Contributing and license

Issues and focused pull requests are welcome. Start with the [architecture](docs/ARCHITECTURE.md) and [API](docs/API.md), and run `npm test` and `npm run typecheck` before submitting code changes.

Fractal is licensed under [Apache-2.0](LICENSE). It grew from [PaperRead](https://github.com/nkjunbc/PaperRead); its MIT notice and other attributions are in [third-party notices](THIRD_PARTY_NOTICES.md).
