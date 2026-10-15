# akebi 0.8.1

- **Chunk-aware grading:** schema v3 evaluates the required phrase multiset separately within each authored semantic chunk. Reordering within an unordered chunk is accepted; changing the actor, role, negation or chunk assignment is not. Schema v1/v2 exact-order compatibility remains.
- **Stable layout:** a fixed-height, internally scrollable answer area (default 320px, adjustable in study settings) keeps the candidate bank from shifting as an answer wraps. Candidate buttons remain in the DOM.
- **Touch and mouse:** pointer-based drag and drop between chunks or back to the bank; two-tap phrase swapping; tap the same phrase twice to return it. No dragging gesture grades an answer.
- **Rep uniqueness:** archive, backup, quarantine and trash paths are excluded; repeated IDs and identical question/answer content are also deduplicated. The defensive Rep set uses the same review identity. Repeating a completed deck advances the visible Rep number instead of reusing Rep 1.
- **One tag tree:** English internal tag paths, editable display names on every level, and progress donuts on branches. No storage-folder navigation or cross-subject “all” deck. The mastery-status “all” filter remains within a chosen leaf.
- **Local images:** attach a vault-local raster image to a question or its explanation in study settings. Metadata updates preserve the original question, answer, stable ID and native SR comment. No remote image fetches.

Critical regression checks remain in one test file. The phrase UI was exercised with actual mouse clicks at 375px and 1280px widths, including reversed-within-chunk answers, drag/drop and tap swapping. Mobile touch events were exercised in a browser. A physical iPhone has not been remotely inspected.

This code release includes no user history, course materials, dictionaries or private fixtures. Community-directory submission status is unchanged by publishing this release.

Frontmatter study tags are supported alongside inline tags. Deduplicated copies retain the newest learning record through aliases, without adding duplicate answer counts. Mathematical punctuation remains significant when comparing card content.
