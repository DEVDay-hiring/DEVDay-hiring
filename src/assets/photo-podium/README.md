# Podium Photo Avatar

Source: the user's supplied 750x450 podium photograph (`avatar-source.jpg.png`, kept local).
The source photograph's usage and redistribution rights must be checked separately.
This is an edited AI role-play avatar, not authentic footage or an endorsement. Keep the app's AI simulation disclosure visible.

## Assets

- `closed.webp`: full 750x450 background and closed-mouth portrait.
- `small.webp`, `open.webp`: two neutral speech mouth patches.
- `{a,e,i,o,u}-{small,open}.webp`: ten vowel mouth patches.
- `geometry.json`: patch rectangle and source dimensions.

Each patch is a lossless 67x51 WebP, positioned at (338, 111). The browser keeps the closed-mouth portrait fixed and only composites this patch rectangle. It never crossfades the entire photograph.

## Editing And Prompts

Images were edited using the imagegen skill's **fallback CLI / OpenAI Image API**, model `gpt-image-2`, quality `medium`, output `1024x1024` PNG. The user explicitly approved use of the existing local API key. No image API calls occur at app runtime or during a deployment build.

The reproducible prompt template and all 13 pose instructions are in [prepare-photo-visemes.py](../../../scripts/prepare-photo-visemes.py), `STATES` and `prepare()`.

The template asks for a single photographic mouth pose, changing only the lips and immediately adjacent skin. It locks identity, head position, nose, eyes, hair, lighting, softness and framing, with no added text or objects. Each vowel is specified by actual pronunciation: AH as in father, EH as in bed, EE as in see, OH as in go, OO as in blue. Small and open poses are requested separately.

The offline script crops the face, prepares a mouth-only edit mask, aligns each generated result to the unchanged upper face, and feather-composites only the mouth onto the original photograph. Full resolution API outputs and the contact sheet stay under ignored `output/imagegen/podium/`; only these final WebP assets ship to the browser.

```sh
# Requires Pillow, NumPy, OpenCV, and the local source image.
python scripts/prepare-photo-visemes.py prepare
# Run the approved imagegen CLI edit once per generated prompt, with face.png and mouth-mask.png.
# Then create the final background, patches and contact sheet:
python scripts/prepare-photo-visemes.py composite
```

To replace the source photograph, update crop/mouth coordinates in the preparation script and regenerate all poses together. Do not mix mouth patches from different identities, viewpoints or lighting.
