# Contributing

- One pull request per pattern (or per related change). The pull request template is the checklist.
- Commit messages: conventional commits, scope `patterns`, e.g. `feat(patterns): add file-upload-multi`.
- Never edit `data/figma-keys.json` by hand and never add `registry.json` (it is generated).
- A changed tree needs a higher `item.version`; the `ci` check tells you if you forgot.
- Questions about a token or component that is missing: open an issue instead of working around it with a raw value.
