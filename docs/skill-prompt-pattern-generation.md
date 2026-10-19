# Prompt: `dap-pattern-from-figma` Claude skill

Használat: másold be az alábbi blokkot egy Claude sessionbe (vagy `skill-creator` skillbe), az eredmény egy
`dap-pattern-from-figma` skill lesz.

---

````text
Készíts egy Claude skillt `dap-pattern-from-figma` néven (SKILL.md + references/ + scripts/).
A skill célja: egy Figma node URL-ből (design system file, pl. "Design system 1.5") gyorsan, hibamentesen
generáljon egy `dap-patterns` bundle-t (`patterns/<id>.json`), ami átmegy a CI-n elsőre.

## Trigger
"generálj patternt ebből a Figma linkből", "pattern a dap-patterns-be", figma.com/design URL + "pattern".
Munkakönyvtár: `dap_org/dap-patterns` (önálló git repo). Kommunikáció magyarul, kód/commit/branch angolul.

## A skill SKILL.md-je tartalmazza ezt a workflow-t, sorrendben

### 0. Kötelező olvasmány (mindig, párhuzamosan)
- `dap-patterns/README.md`, `CONTRIBUTING.md`, `schema/pattern.schema.json`, `schema/bundle.schema.json`
- `registry.config.json` (kategóriák: forms, feedback, navigation, content, page)
- 1 hasonló meglévő bundle a `patterns/` alól példának (pl. `file-upload-multi.json`: repeat, swap, visible:false)
- `data/figma-keys.json`: `components`, `icons`, `textStyles`; `data/tokens.json`

### 1. Figma olvasás — gyors út
- URL-ből: fileKey + node-id (`18337-17884` → `18337:17884`).
- `get_screenshot` (maxDimension 2048) + `get_metadata` → áttekintés. Ha a node ComponentSet (sok variáns:
  Resolution/Type/Inverted), NE készíts variánsonként patternt: döntsd el, melyik tengely = külön pattern
  (általában `Type`), melyik = `visible`/mode/width token. Ha nem egyértelmű, EGY kérdést tegyél fel.
- NE hívd a `get_design_context`-et: Code Connect kérdést dob és a `figma-design-to-code` skillt követeli,
  kódgenerálásra való, itt felesleges.
- Fa dump a desktop bridge-en (`figma_get_status` → ellenőrizd a fájlnevet/fileKey-t; a megnyitott fájl lehet
  lokális másolat, ugyanazokkal a node ID-kkal). `figma_execute` GOTCHA: `documentAccess: dynamic-page`,
  ezért `await figma.getNodeByIdAsync(id)` és `await inst.getMainComponentAsync()`; a szinkron `mainComponent`
  hibát dob. Használd ezt a dump-ot (tedd `scripts/dump-node.js`-be, paraméter: node id):

  ```js
  const n = await figma.getNodeByIdAsync(ID);
  const dump = async (x, d = 0) => {
    const o = { t: x.type, n: x.name };
    if (x.type === "INSTANCE") {
      const m = await x.getMainComponentAsync();
      o.c = m && (m.parent?.type === "COMPONENT_SET" ? m.parent.name : m.name);
      o.cp = Object.fromEntries(Object.entries(x.componentProperties || {}).map(([k, v]) => [k, v.value]));
    }
    if ("layoutMode" in x && x.layoutMode !== "NONE")
      o.l = [x.layoutMode, x.itemSpacing, x.paddingTop, x.paddingRight, x.paddingBottom, x.paddingLeft,
             x.primaryAxisAlignItems, x.counterAxisAlignItems].join(",");
    if (x.type === "TEXT") o.ch = x.characters.slice(0, 40);
    if ("children" in x && d < 5 && x.type !== "INSTANCE") o.k = await Promise.all(x.children.map(c => dump(c, d + 1)));
    return o;
  };
  return JSON.stringify(await dump(n));
  ```
  Bound variable ID-k feloldása (fill/gap/radius → token név): `figma.variables.getVariableByIdAsync`.

### 2. Leképezési szabályok Figma → pattern tree
- Csak 3 node típus: `FRAME` (auto-layout), `TEXT`, `INSTANCE`. Nincs nyers px/hex, minden token ref `{...}`.
- Token név: Figma variable path `/` → `.` (`spacing/400` → `{spacing.400}`); text style
  `Heading/Heading 1` → `{Heading.Heading 1}`. A px értéket a `data/tokens.json` alapján a legközelebbi
  spacing/radius/containers tokenre képezd (a tokens.json-ból számold, ne találgass); ha nincs pontos
  token → jelezd, ne írj nyers értéket.
- Fill/stroke/text color csak `color-semantic` token (pl. `{background.brand.base-inverted}`,
  `{text.neutral.on-inverted}`). Inverted surface → `*-inverted` tokenek.
- Layout: `layoutMode` → `direction`, `itemSpacing` → `gap`, padding → `padding` (egységes / `{x,y}` / 4 oldal),
  `primaryAxisAlignItems` → `primaryAlign`, `counterAxisAlignItems` → `counterAlign`. `Container (xLarge/Fluid)`
  wrapper frame-ek → `{containers.*}` / `width: FILL`.
- `INSTANCE.component` kulcsa PONTOSAN egy `figma-keys.json` `components` kulcs (pl. "Button (outline)",
  "Search field"). Ha az instance komponense nincs benne (pl. illusztráció, "Life event illustrations") →
  hagyd ki, és a végén jelezd "kimaradt: …" listában. NE találj ki komponenst.
- `variant`: a komponens variáns tengelyei (Size, State, Color…). `properties`: szöveg/boolean property,
  a `#id` suffix nélkül (`Label#151:28` → `Label`). Instance-swap ikon → `swap`
  (`"↪️ Icon Lead": "icon-search-line"`), az ikon neve az `icons` listában legyen.
- Nested szövegek: `textOverrides` (layer név → szöveg). Ismétlődő elemek: `repeat` (szám vagy entry lista).
- Opcionális részek (share/print sor, másodlagos CTA, hibaüzenet): `visible: false`, ne hagyd ki.
- Szövegek: placeholder másolat a Figmából (HU ahol az van); a valódi copy a screen schemából jön.
- `modes`: `color-theme` (Indigo) + `typography-theme` (desktop/mobile) a node felbontásából.
- Vektor/arc/dekoráció (pl. "Arc", illusztráció) nem pattern node → kihagyni + jelezni.

### 3. Metaadat (`item`)
`id` (kebab-case = fájlnév = pattern.id), `title` (HU), `description` (1–2 mondat, mikor használd),
`category` (a registry.config-ból), `tags` (HU+EN), `status: "draft"`, `version: "0.1.0"`, `updatedAt` = ma.
Fa-változásnál meglévő patternen a `version`-t emelni kell (semver) — `scripts/check-bump.mjs`.

### 4. Validálás — mindig, mielőtt kész
`npm run validate && npm run build` (a `dist/` ne kerüljön commitba, ha gitignore-os). Hibaüzenetből javíts
(ismeretlen token / komponens / swap célpont), max 3 kör. Soha ne szerkeszd kézzel `data/figma-keys.json`-t
vagy `registry.json`-t. Hiányzó token/komponens → issue javaslat, nem workaround nyers értékkel.

### 5. Git (a globális szabályok szerint)
Feature branch (`feat/pattern-<id>`), conventional commit `feat(patterns): add <id>`, PR, SOHA nem main-re.
Egy PR = egy pattern. Commit body-ba a nem triviális "miért" (pl. mely Figma variáns tengely lett külön pattern).

### 6. Kimenet a usernek (tömör, magyarul)
- melyik fájl készült, mi a Figma node → pattern megfeleltetés (1 sor/rész)
- KIMARADT lista (illusztráció, vektorok, hiányzó komponens/token) és miért
- validate eredménye
- nyitott kérdés, ha van (max 1–2)

## Skill felépítés
- `SKILL.md` (≤ 200 sor): workflow fent, tömören
- `references/mapping.md`: leképezési táblázat (layout, token, variant/property, swap, repeat)
- `references/gotchas.md`: dynamic-page async, get_design_context kerülése, lokális fájl vs. URL fileKey,
  `#id` suffix, `↪️` prefix property nevek
- `references/example-hero.md`: egy végigvitt példa: Hero section (node 18337:17884, ComponentSet:
  Resolution × Type[Landing page, Life event, Basic, Basic with Actions] × Inverted) → pattern `hero-section-page` (a Figma `Type` tengely értéke még „Life event”)
  (Share/Print "Button (subtle)" xSmall Inverted, cím + leírás TEXT, 3× "Button (outline)" Small Inverted
  `repeat`, illusztráció kimarad)
- `scripts/dump-node.js`: a fenti dump
- `scripts/new-bundle.mjs`: üres bundle váz az `item` mezőkkel (vagy a meglévő `npm run pattern:add` használata)

Működjön önállóan: ne kérdezz vissza, amit a repóból vagy a Figmából ki lehet olvasni.
Ellenőrizd a skillt a Hero section node-on (18337:17884): a kimenet menjen át `npm run validate`-en.
````

---

## Megjegyzések

- A prompt a `dap-patterns` repo tényleges szabályaira épül (schema, CI-gate, `figma-keys.json` kulcsok).
- A Hero `Life event illustrations` komponens **nincs** a `figma-keys.json` 72 komponense között → illusztráció
  pattern node nem lehet, amíg a DS library nem publikálja; ez a skill "kimaradt" listájába kerül.
