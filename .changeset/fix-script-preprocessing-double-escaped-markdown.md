---
"clanka": patch
---

Fix script preprocessing for non-patch template literals that contain doubly escaped markdown markers (for example, \\`code\\`). These are now normalized to single escaped markers before preprocessing so task summaries remain stable and valid.
