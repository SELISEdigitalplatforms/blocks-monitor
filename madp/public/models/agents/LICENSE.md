# Journey guides — sources and credits

Both guides are general library characters: stock Microsoft Rocketbox avatars, used as designed (no face, likeness or
photo of any particular person was added or tuned), with natural hair and the white SELISE polo.

| File | Guide | Source avatar |
| --- | --- | --- |
| `guide-m01.close.glb` | MADP Assistant | Microsoft Rocketbox `Assets/Avatars/Adults/Male_Adult_01` |
| `guide-b06.close.glb` | Product Manager | Microsoft Rocketbox `Assets/Avatars/Professions/Business_Male_06` |

- Source: Microsoft Rocketbox Avatar Library, https://github.com/microsoft/Microsoft-Rocketbox, commit
  `0943055db6ec570bcef9f2c8b41c9e5467c808f9`.
- Licence: MIT, (c) 2020 Microsoft (full text in `../people-real/CREDITS.md`).
- Neither avatar is used by the office cast (`../people-real`), so no guide shares a face with a cast member.

## How they were made

- Converted exactly like the cast's close-ups (the `scripts/characters/build.mjs` recipe, close tier only): FBX2glTF
  (godotengine v0.13.1), 4 bone influences; colour, normal and roughness (from specular) textures as WebP — 1K colour and
  normal, 512 roughness, hair cards 512 alpha-masked; the 9 facial blend shapes (blinks, jaw, smile, visemes aa/oh/ee/pp);
  geometry quantized (KHR_mesh_quantization), no Draco/meshopt/KTX2. About 7.4k and 7.0k triangles, 0.75 MB and 0.64 MB
  — the same budget as the guides they replace (6.7k / 6.8k triangles, 0.77 / 0.80 MB).
- Animated with the cast's shared clips (`../people-real/anims-m.glb`).
- Dressed at load time (`src/components/characters/agents/outfit.ts`, once per file): the white polo and SELISE chest
  logo (`dressPolo`, `logoAnchor`), the face (`dressHead`: warm off-white sclera, the iris kept as painted, cornea and
  pupil measured per eyeball). Per base (`registry.ts`): the Assistant's base wears a short-sleeved polo (its own polo
  collar and placket; its bare forearms kept) and shorts, which become long trouser legs (`trouserLegs`); the Product
  Manager's base wears a white business shirt (its own lying collar; long sleeves slimmed to bare forearms,
  `slimForearms`).
- `selise-logo.png` / `.svg`: the SELISE wordmark and globe from the SELISE brand SVG (the "<blocks/>" line removed).

## Retired

The previous guides (`guide-m10.close.glb` = `Adults/Male_Adult_10`, `guide-m14.close.glb` = `Adults/Male_Adult_14`)
are no longer used or shipped; they were moved out of this folder to `~/.cache/madp-characters/retired-guides/`.
