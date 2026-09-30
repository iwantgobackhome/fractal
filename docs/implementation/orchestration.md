# Fractal implementation coordination

Run: `run_7b1cfd9aece2`. All implementation workers: `gpt-6.1-sol`, reasoning `high`.

## Scope and decisions

Implement user requests 1–13. Request 14 (mapping annotations between translated and original text) is excluded.
Use the original scholarly newspaper/journal identity for desktop and Android, enriched with meaningful information density and polished interactions. The user clarified this after rejecting the first modern dashboard prototype. Present representative interactive designs before broad UI implementation.
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

## Baseline accepted and interaction stage started

- E baseline succeeded; inspected report and owned-file diff. Accepted source commit `e83ed460781405dd4853d179db055c08e3d33c22`, integrated as `5278c39`.
- Baseline evidence: 124 JavaScript tests, 11 Android tests, workspace build/typecheck, desktop asset build and isolated Edge smoke pass. No connected adb device; native Electron shell and physical stylus not verified.
- E terminal release receipt retains it as `user_takeover`, with no process action. Runtime-owned protection is respected.
- D interaction prerequisite: task `task_2ac8d14edf1e`, dispatch `ctx_af54d3b0f34b`, worktree `C:/Users/Home/orca/workspaces/fractal/fractal-android`; requested/effective `codex / gpt-6.1-sol / high`, ready and turn start observed.
- A design and B foundation remain active. D fixes existing reader/ink stability before broad UI implementation; prototype review still gates broad redesign.

## Design feedback

- First prototype rendered in isolated Edge at representative desktop/tablet/phone sizes; no script errors or body horizontal overflow observed.
- User rejected its visual feeling. Direction is not approved and broad product UI implementation is held. A received revision guidance; feedback question pending asynchronously.
- Coordinator visual diagnosis and prototype scope correction are recorded in `review/first-prototype.md`.
- Backend and existing Android interaction corrections continue under existing authorization.
- User clarified: prefer the original research/newspaper/paper feeling; the original issue was excessive emptiness. A received the updated direction for scholarly iteration2 with refined typography, rules, richer research metadata and useful history/progress density. No additional style question is needed.
