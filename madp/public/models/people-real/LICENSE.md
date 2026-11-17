# Realistic people — credits and licence

Every person in MADP Factory comes from one source, so the whole cast shares one style, one skeleton and one
animation set.

## Source

- **Microsoft Rocketbox Avatar Library** — https://github.com/microsoft/Microsoft-Rocketbox
  (commit `0943055db6ec570bcef9f2c8b41c9e5467c808f9`). Avatars and the animation set (`Assets/Animations`).
- Licence: **MIT** (the repository's `LICENSE.md`, since 12/2020):

  > Copyright (c) 2020 Microsoft
  >
  > Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
  > documentation files (the "Software"), to deal in the Software without restriction, including without limitation
  > the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
  > to permit persons to whom the Software is furnished to do so, subject to the following conditions:
  >
  > The above copyright notice and this permission notice shall be included in all copies or substantial portions of
  > the Software.
  >
  > THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
  > THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  > AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
  > CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
  > IN THE SOFTWARE.

## The cast

| File | Person | Rocketbox avatar |
| --- | --- | --- |
| `phillip.close.glb`, `phillip.far.glb` | Phillip, business agent | `Professions/Business_Male_02` |
| `rajiv.close.glb`, `rajiv.far.glb` | Rajiv, product manager | `Adults/Male_Adult_17` (outfit recoloured, see below) |
| `planner.far.glb` | Planner | `Professions/Business_Female_01` |
| `developer.far.glb` | Developer | `Adults/Male_Adult_08` |
| `reviewer.far.glb` | Reviewer | `Professions/Business_Female_04` |
| `tester.far.glb` | Tester | `Adults/Female_Adult_15` |
| `secops.far.glb` | SecOps | `Adults/Male_Adult_12` |
| `docs.far.glb` | Docs | `Adults/Female_Adult_14` |
| `release.far.glb` | Release gate | `Professions/Business_Male_03` |
| `anims-m.glb`, `anims-f.glb` | shared clips | `m_/f_idle_neutral_01` and `_02`, `gestic_talk_neutral_01`, `gestic_talk_relaxed_01`, `gestic_listen_neutral_01`, `gestic_listen_accept_01` (nod), `wave_01`, `sit_chair_idle_neutral_01`; the walk `m_walk_neutral` / `f_walk_neutral_02` (in place) |

## Changes

Made by `scripts/characters/build.mjs` (reproducible from `scripts/characters/cast.json`):

- FBX → glTF with FBX2glTF (godotengine release v0.13.1); skeleton kept, 4 bone influences.
- Textures from the original TGA files: colour, normal, roughness (from the specular map); downscaled (close-ups 1K,
  others 512) and re-encoded as WebP. Hair/eyelash cards alpha-masked.
- Close-ups keep 9 of the facial blend shapes (blinks, jaw, smile, visemes aa/oh/ee/pp), renamed; other files none.
- Geometry quantized (KHR_mesh_quantization); unused data pruned. No Draco/meshopt/KTX2 (no WebAssembly needed).
- Clips: face and helper bones dropped, only the root keeps translation, the walk is turned into a walk in place (the
  forward travel taken out is stored as the clip's ground speed in the file's asset extras, so the app plays the walk at
  the rate of the real speed), keyframes resampled (fingers and toes with a looser tolerance), rotations stored as
  normalized 16-bit.
- Rajiv: Male_Adult_17 as designed (his own face, goatee, cap, skin, build and head textures); only the outfit changes,
  to the cast palette: the hoodie recoloured to navy and the jeans to dark charcoal denim. Recolouring keeps each
  garment's own folds and weave from the original texture.
