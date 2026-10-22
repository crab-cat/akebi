# akebi 0.8.4 — PDF++ rectangle display

- Migrated from deprecated MarkdownRenderer.renderMarkdown to MarkdownRenderer.render(app,...), with MarkdownRenderChild lifecycle management inside the study modal.
- PDF++ rectangle previews now use native PDF embeds with cleanup on navigation/close and an indicator for answer-only figures.
- PDF++ rect coordinates originate at the bottom-left of each PDF page. A previously generated personal course-catalogue with top-left coordinates was corrected separately without changing learning records or PDFs.
- Ordinary Vault image links, 4-choice grading, chunk-level review, and stored Ease are unaffected.
- Physical iPhone PDF++ rendering still requires real-device confirmation. Core tests exercise the documented renderer contract and cleanup.
