---
"clanka": patch
---

Fix script preprocessing for broken patch templates by handling standalone `patch` assignments and normalizing over-escaped quoted words inside patch bodies before escaping template delimiters.
