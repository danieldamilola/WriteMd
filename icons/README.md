# Icons

`ai/nrk_ai-solid-expressive.svg` is the source for the `sparkle` entry in
`src/renderer/src/components/icons.ts`, which the settings sidebar and AI
surfaces use.

Kept in the repo so the artwork has one home and the icon module stays a
generated-looking table rather than an opaque blob of path data with no
provenance. The rest of the set is Line Awesome by Icons8
(<https://github.com/icons8/line-awesome>), fetched at build-authoring time and
inlined into `icons.ts`; those are not duplicated here.

## Why not icons8.com downloads

Icons8's own download endpoints are unusable for this project without a paid
account:

- `img.icons8.com` answers every `.svg` request with
  `{"success":false,"error":"paid format requested","code":"PAID_FORMAT"}`.
- Their PNG endpoint works, but a raster cannot inherit `currentColor`, and these
  icons have to theme across seven light and dark palettes.
- The free tier requires an attribution link to icons8.com and, per the
  Universal Multimedia Licensing Agreement, forbids derivative copies. Recolour
  and resize are derivative, so the free tier does not cover the recolouring
  the themes need.

Line Awesome is Icons8's own icon set and is released under the MIT / Good Boy
License, whose permitted use is download, change, fork. That is the one Icons8
set that allows what theming requires.

## Chosen glyph

`nrk_ai-solid-expressive.svg` was picked over the other four candidates by
measuring each one's ink bounding box as a fraction of its viewBox and
comparing against the Line Awesome set, whose median span is 0.804:

| candidate                    | span  | weight  | verdict                              |
| ---------------------------- | ----- | ------- | ------------------------------------ |
| `mingcute_ai-line`           | 0.746 | outline | undersized, and outline clashes      |
| `mingcute_message-3-ai-line` | 0.833 | outline | outline clashes                      |
| `mingcute_message-3-ai-fill` | 0.917 | solid   | 14% oversized                        |
| `nrk_ai-expressive`          | 0.833 | outline | outline clashes                      |
| `nrk_ai-solid-expressive`    | 0.833 | solid   | **1.036x median, symmetric padding** |

The set is Line Awesome _solid_, so a filled glyph is the only weight-compatible
option. `nrk_ai-solid-expressive` lands closest to the set's optical size and
keeps the even padding the Line Awesome glyphs have.
