# W2 follow-up fixes

## Changes and before/after evidence

| Area | Before | After |
| --- | --- | --- |
| Equation source matching | On arXiv 1706.03762, page 4 Eq. (1) Attention carried the FFN LaTeX from Eq. (2); page 5 Eq. (2) carried the unnumbered MultiHead expression. The right-margin `(1)` was not captured. | Right-margin equation tags are joined to detected rows. Source numbering skips starred environments and counts numbered align rows. Matching uses normalized math-symbol similarity, prefers equal equation numbers, assigns each source fragment at most once, and requires a minimum score. Page 4 Eq. (1), page 5 Eq. (2), and page 7 Eq. (3) now carry their correct source formulas. |
| Reference enrichment | Reference [11] in 1706.03762, He et al., *Deep Residual Learning for Image Recognition*, had been enriched as the unrelated 2020 paper *Person Search: New Paradigm of Person Re-Identification*. | Semantic Scholar and OpenAlex candidates are checked against exact DOI/arXiv IDs, or title token Jaccard ≥0.85, year difference ≤1 when available, and an overlapping author family name when available. Rejected candidates fall through to another result or provider, then `null`. Cache keys now include `reference-match-v2`, so earlier unvalidated values are ignored. In the live check, [11] resolved to the correct work, OpenAlex 2016. |
| AI response language | Explanation and glossary prompts did not require Korean; paper and library answers did not specify the question's language. | Explain and glossary prompts require concise Korean, English technical terms in parentheses on first use, LaTeX formulas, and page citations. Explanations ask for what the item is, each applicable symbol, and why it matters in the paper. Paper and library question prompts require the question's language. |

The structure extraction version is now `pdfjs-structure-v2`, and parsed arXiv source cache keys include `latex-numbers-v2`, forcing existing papers to receive the corrected matching. No SQLite migration was needed.

## Manual equation check

Ran `npx tsx packages/hub/test/manual-fixes.ts` using locally downloaded PDF and source archives for arXiv 1706.03762 and 2006.11239. The script reports each detected row carrying a printed `(n)` label, its matched source number and label, and its PDF-to-source math similarity. The archives are not committed. “Correct” means the attached source number and formula correspond to the printed PDF equation; “unmatched” means the confidence threshold prevented an attachment.

| Paper | PDF page and printed equation | Source match | Verdict |
| --- | --- | --- | --- |
| 1706.03762 | p.4 (1), Attention | #1, similarity 0.69 | Correct |
| 1706.03762 | p.5 (2), FFN | #2, similarity 0.97 | Correct |
| 1706.03762 | p.7 (3), learning rate | #3, similarity 0.64 | Correct |
| 1706.03762 | p.6 (1), complexity-table row misdetected as an equation | None, best similarity 0.27 | Unmatched; no incorrect LaTeX attached |
| 2006.11239 | p.2 (1), reverse process | #1, similarity 0.57 | Correct |
| 2006.11239 | p.2 (2), forward process | #2, `eq:forwardprocess`, 0.53 | Correct |
| 2006.11239 | p.2 (3) | None, best 0.11 | Unmatched |
| 2006.11239 | p.2 (4), forward marginal | #4, `eq:q_marginal_arbitrary_t`, 0.47 | Correct |
| 2006.11239 | p.3 (5), variational bound | #5, `eq:vb`, 0.39 | Correct |
| 2006.11239 | p.3 (6), posterior | #6, `eq:q_posterior_mean_var`, 0.47 | Correct |
| 2006.11239 | p.3 (7) | None, best 0.09 | Unmatched |
| 2006.11239 | p.3 (8), variational term | #8, `eq:vb_term_orig`, 0.53 | Correct |
| 2006.11239 | p.3 (10), main detected row | None, best 0.41 | Unmatched |
| 2006.11239 | p.3 (10), partial duplicate row | None, best 0.01 | Unmatched |
| 2006.11239 | p.4 (11), mean parameterization | #11, `eq:mu_func_approx_langevin`, 0.56 | Correct |
| 2006.11239 | p.4 (12), noise prediction loss | #12, `eq:vb_term_langevin_eps`, 0.50 | Correct |
| 2006.11239 | p.4 (13), decoder | #13, `eq:discrete_decoder`, 0.36 | Correct |
| 2006.11239 | p.5 (14) | None, best 0.49 | Unmatched |
| 2006.11239 | p.7 (15) | None, best 0.51 | Unmatched |
| 2006.11239 | p.7 (16) | None, best 0.48 | Unmatched |
| 2006.11239 | p.14 (22) | None, best 0.50 | Unmatched |
| 2006.11239 | p.14 (26) | None, best 0.49 | Unmatched |

The 2006.11239 PDF has fragmented symbol extraction for several rows; 9 of 18 detected numbered rows matched, and none received a wrong source formula. Two rows represent the same printed Eq. (10). Scores in the table are raw math similarity; the number agreement contributes separately to the attachment score. Some unmatched rows have a high raw *best* score against a different numbered formula, so attaching on similarity alone would reintroduce wrong matches.

## Manual reference check

The same script queried five references from arXiv 1706.03762. Live provider results can vary; these are the results of the final run.

| Reference | Expected work | Accepted enrichment |
| --- | --- | --- |
| [1] | Ba et al., *Layer Normalization* | OpenAlex, *Layer Normalization* (2016) |
| [6] | Chollet, *Xception: Deep Learning with Depthwise Separable Convolutions* | OpenAlex, same title (2017; within one year of the cited 2016) |
| [10] | Graves, *Generating Sequences with Recurrent Neural Networks* | `null`; no candidate passed validation |
| [11] | He et al., *Deep Residual Learning for Image Recognition* | OpenAlex, same title (2016) |
| [23] | Luong et al., *Multi-task Sequence to Sequence Learning* | `null`; no candidate passed validation |

## Verification

```text
npm ci                 PASS (375 packages added)
npm run build          PASS (shared, UI, hub)
npm test               PASS (shared 1/1, hub 56/56, UI 14/14)
npm run typecheck      PASS (shared, hub, UI)
hub smoke              service.ready at http://127.0.0.1:10414
GET /api/papers        HTTP 200, {"data":{"papers":[]}}
GET /                  HTTP 200, text/html; charset=utf-8
```

The hub used a temporary data directory and was stopped after both requests. New tests cover reversed equation order with an intervening unnumbered source environment; accepted and rejected Semantic Scholar/OpenAlex candidates; old enrichment cache invalidation; and Korean explanation/glossary plus question-language prompt instructions.

## Decisions and known gaps

- A missing or low-confidence equation source match stays without `latex`; this prevents attaching a plausible but wrong numbered formula. The PDF detector can still mistake a table row for an equation, as seen on page 6 of 1706.03762.
- The enrichment cache version is encoded in the key, with no database migration. Existing rows remain in SQLite but are not read by the new path.
- The citation and response-language rules are prompt instructions to the selected AI provider. They are covered by prompt tests; generated wording still depends on the provider.
- The unmatched 2006.11239 equations need better PDF symbol extraction or source parsing to gain coverage. No other worktree or external integration step is required.
