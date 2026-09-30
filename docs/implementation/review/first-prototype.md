# First prototype review — rejected direction

User rejected this visual direction on 2026-10-01. It is not approved for product implementation. The user then clarified that the original scholarly newspaper/journal feeling is preferred, with excessive emptiness corrected. Backend and existing Android interaction correctness continue independently.

## Executed preview evidence

The coordinator rendered the five representative views in isolated headless Edge with external requests blocked. Desktop 1440×900, tablet 1280×800, phone 360×800 rendered with no page script errors and no body-level horizontal overflow. These checks establish prototype rendering only, not product functionality.

Orca navigation created a dedicated preview page, but snapshot/exec requests closed their RPC connection while Orca status and orchestration remained healthy. The coordinator kept live workers running and used a separate Edge session to inspect the same local prototype.

## Visual diagnosis

- Desktop library repeats saved/recent navigation in multiple places and shows the same papers in resume cards and the main grid, consuming considerable space.
- Nested folder names wrap into narrow fragments while large paper cards retain generous empty space; density is inconsistent.
- Green surfaces, rounded cards and generic workspace framing create a dashboard character rather than establishing a distinctive paper-reading experience.
- Tablet reader contains several persistent navigation/toolbar layers that need deliberate hierarchy and sizing review alongside the document.
- Original and translated paper typography need platform-appropriate reading detail; prototype paper text is illustrative and cannot establish real PDF fidelity.

## Scope correction sent to A

Positioned annotations currently promise translated-pane anchors. The accepted contract has original physical-page normalized coordinates without translated-pane identity. Restrict positioned annotations to the original and avoid promising translated anchors; request14 cross-language mapping remains excluded.

## Pending

Scholarly iteration2 review. The user answered the asynchronous question: retain the original research/newspaper/paper feel and fill the earlier excessive emptiness. A was instructed to preserve iteration1 as rejected and create a refined, denser scholarly design; implementation still requires representative review.
