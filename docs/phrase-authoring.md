# Constrained phrase assembly

Write the canonical statement first. Choose a fixed `prefix` and `suffix`; the learner fills only the middle. All strings must concatenate exactly to the original Markdown answer. Do not use generic semantic similarity to silently accept contradictory or negated statements.

```json
{
  "sentence": {
    "schemaVersion": 2,
    "prefix": "タンパク質は",
    "tokens": ["粗面小胞体で", "合成", "され、", "ゴルジ体を", "経て"],
    "suffix": "分泌される。",
    "distractors": ["核小体で", "分解", "されず、"],
    "alternatives": [],
    "concepts": ["合成", "輸送"]
  }
}
```

Place the object in a `%%AKEBI {...}%%` or `%%RMUX {...}%%` line immediately after the `question :: canonical answer` line (or after its legacy SR comment).

## Authoring constraints

Keep technical compounds intact. Attach case/topic particles to the phrase they belong to, such as `ゴルジ体で`, `細胞膜と`, or `タンパク質を`. Isolate action stems where useful: `合成` with `され、`/`されず、`, `調節` with `する`/`しない`. Avoid isolated particles or punctuation as distractors.

Aim for roughly 8–10 correct pieces and 3–5 misleading pieces; the **entire bank is capped at 15**. Not every sentence must fill the cap. Fixed boundaries reduce ambiguity, but should not supply the relationship being tested. Distractors should test an actor, location, order, or negation, not reading endurance.

Every physical occurrence is a separate tile. Repeated phrases require enough copies. Explicit alternatives must be constructible from the same multiset of tiles. The exact canonical concatenation is validated before the exercise becomes eligible. Incorrect metadata is never auto-repaired into a different factual statement.

Schema v1 is read for backward compatibility and compacted without changing the concatenated text. New authored material should always use v2; the v1 fallback cannot invent high-quality negative alternatives.

## Minimal checks

1. `prefix + tokens.join("") + suffix === canonicalAnswer` after only Unicode/whitespace normalization.
2. The candidate pool contains the full multiset for every accepted middle sequence.
3. Candidate count is at most 15; no forbidden single-particle fragments.
4. Test actual clicks on a narrow viewport, not just array equality. The candidate bank must not be clipped, capped with hidden overflow, or destroyed and rebuilt on every tap.
5. A wrong predicate and a timeout each record exactly one failure. Navigating away from the feedback must not drop or duplicate it.

Morphological analyzers and corpora can suggest phrase boundaries or collocations. They do not decide scientific truth, negation scope, or which alternatives are valid. No corpus or analyzer is required at runtime.

## Schema v3: semantic chunks instead of one global word order

Version 0.8.1 adds `chunks` while keeping the fixed prefix and suffix. Each chunk has an ID, label, canonical tokens and `mode: "bag"` (unordered multiset) or `"ordered"` (exact token order). Concatenating the canonical chunks must still reconstruct the original answer exactly.

```json
{
  "sentence": {
    "schemaVersion": 3,
    "prefix": "タンパク質は",
    "chunks": [
      {"id":"production","label":"合成の場","mode":"bag","tokens":["粗面小胞体で","合成","され、"]},
      {"id":"transport","label":"輸送経路","mode":"bag","tokens":["ゴルジ体を","経て"]}
    ],
    "suffix": "分泌される。",
    "distractors": ["核小体で","分解","されず、"]
  }
}
```

Within `production`, different word order passes if the three required phrases are present with the right multiplicity. Moving `ゴルジ体を` into `production`, selecting `されず、`, or duplicating a missing token does not pass. This is deterministic matching against **authored relations**, not unrestricted Japanese semantic understanding.

Use two or three chunks, normally one predicate/role per chunk. Do not put separate agents and negated predicates in a single unordered group when that could reverse the truth conditions. Chunk order itself is fixed; use an ordered chunk where causal/temporal ordering is the knowledge being tested. The global pool remains at most 15 phrases. Explicit chunk-local alternatives must be constructible from that same pool.

The editor displays each relation in a fixed-height answer frame, with independent drop zones. The learner can choose a zone, drag a phrase, or swap two selected phrases. Grade only the full chunk assignments, never a sorted bag of the entire answer.


## Reusing images across relationship questions

Figures belong to individual cards as normal metadata, not to a copied image asset or a particular folder. Use images with an Obsidian Vault link (for example ![[figures/secretory-path.png]]) and showOn "question" or "answer". Two cards can reference the same image; removing one link does not remove the source file.

Prefer a **question** image when the relationship is hard to visualize from prose alone; use an **answer** image for feedback that would otherwise reveal the result. Selecting a displayed image opens the source file in Obsidian. Do not put unrelated images on every card merely to fill space.


### PDF++ rectangle references

To attach lecture diagrams, store an Obsidian PDF++ rectangle link in the card-local images array. For example: ![[lecture.pdf#page=6&rect=110,80,830,470&width=450]], with showOn set to answer. This links to the original PDF and does not duplicate it as a PNG.

Select and copy the rectangle in PDF++, then paste it into the Akebi image-link editor or tap the PDF++ clipboard button. Click the source button to open the exact PDF page/rectangle. Reserve question-phase images for diagrams that do not disclose the solution; keep answer-revealing figures behind feedback.
