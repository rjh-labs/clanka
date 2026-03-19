---
"clanka": patch
---

Fix script preprocessing for tool-call template arguments by locating the template end from the call boundary instead of the first `)`-adjacent backtick. This prevents partial escaping when markdown inline code inside `taskComplete` or `applyPatch` contains patterns like ``code`),`.
