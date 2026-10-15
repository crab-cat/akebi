# akebi 0.8.2 — reusable Vault image links

- Every question may store up to four **Obsidian Vault image links** in its card-local metadata, beside dummies, explanation and tips. Both ![[attachments/image.png]] and [[image.png|alt]] are accepted; old path fields still load.
- The link is resolved relative to the source note through Obsidian's metadata cache. The same local image can appear in many problems without copying. Click the displayed preview to open the original Vault image.
- Attach through the study settings either by choosing an existing image or pasting its Obsidian link. Choose whether it appears on the question/feedback or only after grading.
- If an image is renamed while akebi is running, references inside card metadata are rewritten with the new path, preserving the question, choices, explanations, fixed ID and original SR comments. Ambiguous bare basenames are not rewritten blindly.
- URL, path traversal and unsupported or non-local image types remain rejected. No web fetches or user images are bundled in the public release.
- The core regression suite now covers shared links, navigation to source, add/remove metadata preservation, and safe renames.

There is no change to review scheduling or existing personal learning history.
