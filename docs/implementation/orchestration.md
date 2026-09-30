# Fractal implementation coordination

Run: `run_7b1cfd9aece2`. All implementation workers: `gpt-6.1-sol`, reasoning `high`.

## Scope and decisions

Implement user requests 1–13. Request 14 (mapping annotations between translated and original text) is excluded.
Use a modern workspace design for desktop and Android. Present representative interactive designs before broad UI implementation.
Distinguish recently read papers from explicitly saved papers. Support nested folders, multiple folder membership and tags.
Persist general questions and figure/equation explanations. Closing a panel must retain history.
Pen draws by default; an explicit selection tool enables pen text selection. Fingers navigate.
Include news and topic discovery on Android, journal/conference/preprint metadata, resilient related-paper lookup, positioned sticky notes, and tablet translation split view.
Preserve existing paper, PDF, annotation and conversation data through explicit migrations. Do not infer historical reading times.

## Ownership and sequence

1. A: Design system and interactive PC/tablet prototypes, phone layout, common icon design. Own design reports/prototypes first. No production UI changes before review.
2. B: Shared/hub contracts, persistence, migrations and sync. First deliver recent/saved, nested folders and durable question/explanation history, with integration documentation and regression tests. Discovery/reliability follows separately.
3. E: Independent read-only baseline QA and reproduction, acceptance checklist. Own QA reports; never change production code.
4. C: Desktop UI and original-PDF selection, then history/sticky notes/discovery/settings, after approved design and contracts.
5. D: Android UI, ink/selection stability, history/notes, split translation, discovery and icons, after approved design and contracts.

At most three active workers. Workers use isolated Orca worktrees and do not merge their own branches. Coordinator checks diffs, executable evidence and launch receipts, routes corrections to owners, then integrates accepted changes.

## Verification gates

Review representative PC library/reader and tablet library/reader with compact phone layout. Check light/dark/sepia, Korean/English, empty/loading/error/offline states, keyboard focus and Android touch targets.
Exercise close/reopen/restart history persistence, old-data migration, explicit save versus recent, nested-folder changes without paper loss, offline synchronization, external-service 429/timeouts, text selection and annotation interaction.
Check desktop 1280×800/1440×900/1920×1080 and Android widths 360/800/1280, portrait/landscape. Require meaningful existing tests, typecheck/build, isolated browser/Electron checks and Android build/emulator evidence.
Report actual Galaxy Tab/S Pen verification as outstanding until tested on physical hardware; emulator checks cannot establish hardware behavior.

## Initial run status

- Repository clean before worker setup.
- Orca runtime ready; installation confirmed. Initial CLI failure was sandbox access restriction, corrected by approved executable invocation.
- A design: task `task_c3fe9aa15fe8`, dispatch `ctx_861d0f705e42`, worktree `C:/Users/Home/orca/workspaces/fractal/fractal-design`.
- B foundation: task `task_aa0dad1fb29c`, dispatch `ctx_59b21e98aac0`, worktree `C:/Users/Home/orca/workspaces/fractal/fractal-backend`.
- E baseline: task `task_8501694b184f`, dispatch `ctx_20d799b6acd9`, worktree `C:/Users/Home/orca/workspaces/fractal/fractal-qa`.
- All three launch receipts show requested and effective `codex / gpt-6.1-sol / high`, state `ready`, turn start observed. No repository setup hook configured.
