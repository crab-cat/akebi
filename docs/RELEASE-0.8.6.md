# akebi 0.8.6 — study modal reopen fix

- Fix a blocked reopen after closing Akebi: clear the active-modal guard before unloading PDF++, media, timers, drag-and-drop, and other resources.
- Cleanup steps are individually isolated so a PDF viewer or audio teardown exception cannot strand the modal.
- Recover stale/disconnected windows and clean up after failed synchronous modal startup.
- Ignore card-loading completions or errors arriving after the study modal was closed.
- Guard the study timer against late ticks and uncaught exceptions.
- No changes to ease, study grading, stored answer history, lesson cards, PDF++ links or user settings.

Focused lifecycle regression scenarios cover normal repeated open/close, deliberately failed PDF teardown, failed startup, orphaned modal references and late asynchronous load rejection. The existing study tests are retained. Physical iPhone reload is still an end-user verification step.
