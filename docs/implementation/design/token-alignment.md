# Minimal shared palette alignment

The original ownership boundary excluded product sources and tokens until prototype review. After reviewing all five representative views and accepting scholarly iteration 02, the coordinator explicitly extended this task's ownership to exactly:

- `packages/shared/tokens/tokens.json`
- `packages/shared/tokens/generated/FractalTokens.kt`
- `packages/ui/src/design/tokens.css`

The two platform files were regenerated with the existing `npm run tokens`. The generator and all React/Compose components remain unchanged. Backend contracts and coordination/task files are outside this worker's edits.

The earlier tokens already used a scholarly serif/UI stack, restrained red, 4/8-based spacing and suitable type sizes. Those font, size, spacing, radius and motion groups are therefore unchanged. Names and per-theme schemas remain backward compatible; highlight, danger, success and scrim colors are unchanged.

| Semantic role | Light | Dark | Sepia |
| --- | --- | --- | --- |
| Paper/shell | `#F9F7F2` | `#1F201E` | `#EEE5D3` |
| Surface/reading sheet | `#FFFDF8` | `#2B2B24` | `#FFF4DA` |
| Sunken/page gutter | `#EEEAE2` | `#191B17` | `#E6DDC8` |
| Ink | `#282724` | `#EDEAE0` | `#383127` |
| Ink soft | Existing `#4A4843` | `#D3CEC1` | Existing `#56493A` |
| Muted metadata | `#6B665E` | `#B9B5A9` | `#6F624D` |
| Fine rule | `#D8D2C8` | `#44473B` | `#CEC1A7` |
| Accent | `#93433B` | `#E9A194` | `#8A4937` |
| Accent wash | `#F1E7E0` | `#3C2E27` | `#EADAC4` |
| Keyboard focus | `#356776` | `#8CC8D8` | `#346A76` |

These values bring production semantics near the accepted warm-paper prototype and improve secondary-text contrast. Focus is distinct from the reading/action accent. Sepia muted text was darkened from the initial prototype's `#756852` after its 4.35:1 paper contrast failed the 4.5:1 check. The final value passes on both paper and surface.

The prototype distinguishes some review-only surface roles more finely (`background`, `surface`, `raised`, `paper`). Production intentionally retains its existing `paper`, `surface`, `sunken` schema. See `visual-values.json` for screen measurements and the explicit mappings; do not add speculative token names to reproduce every CSS variable.

Verification:

```powershell
npm run tokens
node docs/implementation/design/prototype/verify-tokens.mjs
```

The verification checks deterministic generated CSS/Kotlin parity, unchanged scalar/font groups, compatible token names, and 33 contrast pairs. Ink/inkSoft/muted/accent text against paper and surface require 4.5:1; focus against those surfaces requires 3:1; accentInk on accent requires 4.5:1. Results are in [renders/token-checks.json](renders/token-checks.json). This verifies the specified pairs, not every possible widget or image background. Faint is nonessential decoration only, never the color for necessary metadata.
