# akebi 0.8.5 — forgetting-based estimated weak cards

- Display-only mastery now follows predicted retrievability: Perfect → Known at review target R ≤ 86%; Known/Perfect → Weak (inferred forgetting) at R ≤ 65% by default.
- Settings lets you adjust the estimated-weak threshold from 55% to 80% in 5-point steps.
- Inferred weak cards appear in the Weak filter and deck charts, with an explicit message differentiating prediction from observed failures.
- Due and Weak practice prioritize the lowest predicted recall first. Sorting caches one memory estimate per card, even on large vocabulary decks.
- Passive passage of time **never writes a new FAIL, overwrites historical Ease, shortens stability, or increments mistakes**. The stored level and review evidence are only updated on actual answers.
- Untouched/unseen cards, cards with absent or invalid timestamps and already weak cards remain unaltered.
- Two new focused regression tests cover the threshold, stale/incomplete records, stage filtering, chart counts, ordering, and preservation of the learning ledger.

The model remains an uncalibrated FSRS-shaped hybrid; 65% is a configurable heuristic, not a measured individual recall probability.
