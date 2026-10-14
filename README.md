# dap-patterns

Reusable **patterns** for the DÁP design system (everything above atom level), stored as JSON trees that are built
**only from DS atoms and tokens**. The catalogue is published on GitHub Pages and read by the DÁP Figma plugin
(insert a pattern into a Figma file as plain, freely editable frames whose atoms stay linked DS instances).

- Catalogue (machine readable): <https://dap-ds.github.io/dap-patterns/registry.json>
- Figma plugin: separate repository, `dap-ds/dap-patterns-figma-plugin`
- This repository contains **only patterns and what is needed to validate and publish them**.

## How it works

```
patterns/<id>.json        one file per pattern: { pattern: <tree>, item: <metadata> }   <- the source of truth
registry.config.json      catalogue name, categories, paths of the two data files
data/figma-keys.json      GENERATED publish keys of the public Figma DS library (variables, styles, components, icons)
data/tokens.json          copy of the DS tokens (W3C syntax, Figma collection/mode sets)
schema/*.schema.json      JSON Schemas (bundle, pattern tree, generated registry)
scripts/                  build/validate, version gate, add-pattern, figma-keys tooling
.github/workflows/        ci (validate on every PR) and pages (publish dist/ from main)
```

`registry.json` is **generated** from the bundles (`npm run build` -> `dist/`), it is never edited by hand. That is why
two pull requests never conflict: each one touches only its own `patterns/<id>.json`.

### A pattern tree

Only three node types: auto-layout `FRAME`, `TEXT`, `INSTANCE` (a DS component). Every visual value is a token
reference such as `{spacing.400}` or `{Heading.Heading 4}`; there are no raw px or hex values. Optional parts use
`visible: false`, icon choices use `swap`, lists use `repeat`. See `schema/pattern.schema.json`.

## Adding or changing a pattern

1. **From Figma (recommended).** Select the frame, open the DÁP Patterns plugin, *Export*, then *Propose on GitHub*.
   The plugin copies the bundle and opens GitHub's "new file" page for `patterns/<id>.json`. Paste, commit: GitHub
   forks the repo for you if you are not a member and opens a pull request.
2. **From a checkout.** Save the exported bundle and run `npm run pattern:add -- bundle.json`, review the diff,
   commit on a branch and open a pull request.

Rules enforced by CI (the pull request cannot merge otherwise):

- the bundle matches `schema/bundle.schema.json`; file name = `item.id` = `pattern.id`;
- every token reference exists in `data/tokens.json` **and** has a Figma key of the right kind (a `fill` must be a
  color token, a `gap` a size token, ...);
- every instance is a DS component from `data/figma-keys.json`, every `swap` target exists there;
- if the **tree changed**, `item.version` must be higher than on `main` (semver). Metadata-only edits need no bump.
  Frames already inserted in Figma carry the version they came from, so designers see "new version available".

## Local development

```bash
npm ci
npm run validate        # schema + semantic checks
npm run build           # generates dist/
npm run serve           # http://localhost:8787/registry.json, to try a change in the plugin before publishing
```

## Refreshing the generated data

- `data/tokens.json`: `npm run sync:tokens` (copies from a checkout of `dap-ds/dap-ds`), then `npm run validate`.
- `data/figma-keys.json`: **never edit by hand.** Keys are per Figma file, so extract them from the *published* DS
  library file with `scripts/extract-figma-keys.figma.js` (Figma plugin API, read-only), then
  `npm run keys:save -- <output.json>` (checks checksums) and `npm run keys:verify`. A pattern that swaps to an
  icon that has no key fails validation; add the icon name to `iconNames` in the extractor and re-extract the
  `icons` group (`only: ["icons"]`, saved with `--merge`).

## What is public here

Pattern trees, token names and values, and the publish keys of the (public) DÁP Design System 1.5 Figma library.
Nothing in this repository is secret; do not add credentials or personal data.

## License

[MIT](LICENSE). The pattern trees, schemas and scripts in this repository can be reused freely; the Figma library
and design tokens they reference are those of the public DÁP Design System.
