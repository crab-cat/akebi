# akebi

A standalone, local-first learning plugin for Obsidian. Practice Markdown flashcards, multiple-choice questions, and constrained phrase-building exercises on desktop and mobile. No other plugin, account, or remote service is required.

## Learn from terms to relationships

- Four-choice and reveal/swipe cards with card-local distractors, explanations and optional tips.
- Phrase assembly with a **fixed beginning and ending** and at most **15 candidate phrases**, not an overflowing pool of individual particles.
- In Japanese, keep nouns and their particles together (e.g. `細胞膜と`), while separating action nouns from affirmative/negative predicates (e.g. `融合` + `する` / `しない`).
- Bounded study batches (Reps), persistent deck/mastery filters, oldest-reviewed-first rotation and immediate timeout grading.
- Adaptive learning evidence (Ease) and time-dependent review recommendations. Familiarity and estimated current recall are separate.
- Optional lexical curriculum/stage memberships are filters over the same card IDs, not duplicate decks.

The initial UI is in Japanese. The Markdown storage, code, authoring schema and this README are open. The plugin does not bundle a dictionary, an Anki deck, private course material, or third-party mascot assets.

## Install

Requires Obsidian **1.7.7 or later**. The release has `main.js`, `manifest.json`, and `styles.css`.

Until this plugin is listed in the Community directory, place those three release files in `<your-vault>/.obsidian/plugins/akebi/`, restart Obsidian, then enable **akebi** in Settings → Community plugins. Do not overwrite your existing `data.json` or `mastery.json`.

Open the sprout ribbon button or run **akebi: 学習を始める** from the command palette. The command ID is `akebi:open-study`. `obsidian://akebi` also opens the study screen. The same independent UI runs on desktop and mobile.

## Markdown cards

Add `#flashcards/<deck>` or `#akebi/<deck>` to a note and write `question :: answer`. Optional one-line metadata follows the card or its legacy SR comment:

```markdown
#flashcards/Example

photosynthesis :: 光合成
%%AKEBI {"dummies":["呼吸","発酵","消化"],"explanation":"光のエネルギーを利用する過程。","choiceAnswer":"光合成"}%%
```

`%%RMUX {...}%%` is also accepted, for compatibility with the predecessor UX. Metadata is displayed as plain text, not executed as HTML. Legacy `<!--SR:...-->` comments are not rewritten. Their next-due date is read when there is no Akebi history; after an Akebi answer, Akebi's independent scheduler owns its review recommendation. This is not a bidirectional scheduler sync.

See [phrase authoring](docs/phrase-authoring.md) for the `sentence` v2 schema. Invalid sentence metadata is withheld from study rather than producing an impossible or falsely graded exercise. Use **akebi: 問題形式を検査する** to check it.

## Progress and migration

Progress lives in this plugin's `mastery.json`; settings live in `data.json`. Neither is included in the public repository or release.

The settings tab has an **explicit import** for the earlier `repetition-mobile-ux` plugin's local history. It keeps a backup of the original ledger, preserves answer counts/Ease, and prefers newer Akebi entries when there is overlap. The predecessor plugin is not needed after migration and is not modified by the import. Keep only one study interface active during the switch and back up your vault first.

Existing path/question IDs remain readable. New cards may opt into stable IDs with `"akebi":{"id":"a-unique-stable-id"}` in metadata. Their former path-based records are remapped through durable aliases; note renames also preserve path-based history. Simultaneous offline study on multiple devices is not a transactional synchronization system: let the vault finish syncing between devices.

A timeout records a failed answer **before** showing feedback. Closing the screen at that point does not erase the failure, and Next does not grade it a second time. File writes are serialized; visible save errors can be retried when navigating. An operating-system termination during an unfinished write cannot be guaranteed safe.

## Review model

This release retains a response-time-weighted evidence model and a power-law forgetting curve inspired by the published FSRS curve. **It is not a trained FSRS implementation and does not claim calibrated recall probabilities.** Stability updates and the review target are provisional, adjustable design parameters. Elapsed time alone does not invent an incorrect answer or reduce historical correct counts. The independent study interface no longer hooks or modifies Spaced Repetition's UI.

Reference for the forgetting-curve shape: [FSRS algorithm](https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm). No runtime package or code from the original Spaced Repetition plugin is bundled here.

## Privacy and security

- No telemetry, tracking, ads, accounts, payments, cloud inference or network requests.
- Reads Markdown in the current vault, and writes only its own local learning state plus explicitly requested card metadata edits.
- The optional migration reads the old plugin's state **inside the same vault** and writes a backup inside Akebi's plugin directory. No files outside the vault are accessed by the runtime plugin.
- Optional audio references must resolve to vault-local audio files; remote URLs and path traversal are refused.
- The release does not self-update, install other plugins or alter permission settings.

## Development

```sh
npm ci
npm test
npm run build
```

`src/main.js` contains plugin lifecycle, migration, and storage; `src/study.js` contains the learning UI and pure grading functions. `styles.css` is scoped to the Akebi modal. Tests are intentionally limited to one critical regression file: reconstruction/negation, actual DOM interactions and timeout grading, migration/data safety, and an optional private fixture supplied through an environment variable. No private fixtures are checked in.

## License

MIT, copyright 2026 crab-cat. Built-in icons are supplied by Obsidian's `setIcon` API. Dictionaries and personal study notes remain separate from the code release, with their own licenses.

## 0.8.1: chunks, images and named tag hierarchy

New `sentence` schema v3 allows **unordered phrases within explicitly authored semantic chunks**. Correct membership/multiplicity in each chunk is required; wrong chunk assignment and affirmative/negative distractors still fail. Existing v2 cards remain exact-order unless deliberately authored as chunks. See [phrase authoring](docs/phrase-authoring.md).

The answer frame is fixed-height and internally scrollable (default 320px, adjustable). Tap two placed phrases to swap them, double-tap the same phrase to return it, or drag between chunk zones and the candidate bank. The bank itself is not recreated when choosing a phrase and its position does not change as text wraps.

Decks are now a single hierarchy of stable tags, for example:

```text
#flashcards/university/biology/terms
#flashcards/university/biology/sentences
#flashcards/university/linear-algebra
#flashcards/english/cefr-j/a1
```

**Settings → タグ階層の表示名** lists the study-tag hierarchy and lets you name each node independently, such as `university` → 大学 and `university/biology` → 生物. This changes labels only, not tags, card IDs or learning history. Curriculum memberships become equivalent virtual branches. Folder navigation and cross-subject “all” study have been removed; the mastery-status “all” filter still applies inside a selected leaf. Japanese legacy tags remain readable and common categories have compatibility mappings.

Archive, backup, quarantine and trash folders (including numbered archive folders) are excluded from scanning. These copies must not become fresh questions. A second guard deduplicates repeated IDs and identical question/answer content within each Rep. Original archived notes and history are not deleted.

To attach a figure, open study settings and **この問題の画像**, then select a local image for the question or explanation. PNG, JPEG, GIF, WebP and AVIF are supported. Up to four references are stored in card metadata:

```json
{"images":[{"path":"attachments/figure.png","alt":"Figure caption","showOn":"answer"}]}
```

Reusable Obsidian links are the preferred per-card image field, alongside distractors and explanations:

~~~markdown
#akebi/university/biology/terms

細胞膜を構成する主な分子は？ :: リン脂質
%%AKEBI {"dummies":["セルロース","核酸","デンプン"],"explanation":"リン脂質が二重層を形成する。","images":[{"link":"![[attachments/細胞膜.png]]","showOn":"question","alt":"細胞膜の模式図"}]}%%
~~~

The same Vault image may be referenced by any number of cards without copying it. Both plain Vault paths from older Akebi notes and Obsidian [[...]] / ![[...]] syntax are accepted. A question-phase image stays visible when revealing the answer; set showOn to "answer" to hide it until feedback. The image itself can be clicked to open the source file in Obsidian.

Study settings → **この問題の画像リンク** provides both a Vault file picker and a field for pasting an Obsidian image link. Removing the attachment removes only the card reference, never the image file. Existing per-card metadata, learner history, original Q/A and Spaced Repetition schedule markers are preserved. On an image rename or move *while Akebi is loaded*, references in active card metadata are updated using Obsidian's rename event; if Akebi was not running or an unqualified filename is ambiguous, check the link manually. Inline metadata comments are not guaranteed to participate in Obsidian's own automatic link-renaming facility.

PDF++ rectangle embeds are also supported when the source PDF is inside the Vault. A copied link may look like ![[biology.pdf#page=4&rect=120,70,830,470&width=450]]. Store it in an images entry with showOn set to answer or question. In study settings, paste the copied PDF++ rectangle or click the clipboard button. Obsidian/PDF++ renders the crop from the original PDF without making a PNG copy, and the source button jumps to the source location. Preview height is reserved so the choice/phrase bank does not move while the PDF loads.

Renaming the PDF while Akebi is running updates card metadata links without losing page/rect coordinates. When ambiguous bare filenames collide, links are not guessed automatically. This is optional: Akebi flashcards work without PDF++.

Only vault-local raster images and PDF rectangle references are resolved. Absolute paths, traversal, remote URLs and data URLs in authored metadata are rejected. The image frame reserves its size before loading so it cannot move the candidate bank during play. Selecting or unlinking an image uses an editor-aware metadata update; the original Q/A and SR comments remain unchanged.
