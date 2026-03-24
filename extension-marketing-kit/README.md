# Marketing Assets Kit

This folder is a reusable base for generating extension store assets without rewriting the automation from scratch.

Included:

- `scripts/generate-extension-screenshots.mjs`
- `scripts/generate-extension-clips.mjs`
- `scripts/generate-extension-montage.py`
- `examples/package-scripts.example.json`

Use it to generate:

- Chrome Web Store screenshots
- raw promo clips
- stitched promo montage videos

## How to use

1. copy `marketing-assets` into a real extension repo
2. customize the config/constants in the scripts
3. replace mocked content with that extension's own scenarios
4. build the extension so its `dist/` exists
5. run the scripts

## Why it lives here

Because store media generation is reusable across extensions, but should not be tied to one live product repo.
