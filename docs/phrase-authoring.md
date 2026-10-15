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
