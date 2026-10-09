"""Prepare/edit inputs and composite generated mouths onto the supplied portrait.

Offline only: Pillow, NumPy, OpenCV. API edits are run separately with image_gen.py.
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
CROP = (250, 0, 490, 240)
SIZE = 1024
MOUTH = (338, 111, 405, 162)
STATES = {
    "closed": "Lips gently fully CLOSED at rest, touching along a natural horizontal seam. No teeth or dark mouth cavity visible. Not pursed, not smiling.",
    "small": "A small natural neutral speech opening, relaxed lips, just a narrow dark gap. NOT an O shape. About one third of a normal speaking jaw opening.",
    "open": "A moderately open neutral speaking mouth with relaxed corners and a little upper teeth visible. Natural conversation, not yelling, not smiling.",
    "a-small": "Quiet AH vowel as in father: vertically open relaxed lips, small aperture, jaw lowered slightly. Corners relaxed, not round or pursed.",
    "a-open": "Clearly articulated AH vowel as in father: noticeably taller open mouth, jaw lowered, relaxed corners, upper teeth just visible. Natural speaking, not shouting.",
    "e-small": "Quiet EH vowel as in bed: lightly spread mouth corners and a shallow horizontal opening. Slight visible upper teeth, no smile.",
    "e-open": "Clearly articulated EH vowel as in bed: mouth wider than tall with moderately lowered jaw, upper teeth visible, horizontal oval aperture. No smile or exaggerated expression.",
    "i-small": "Quiet EE vowel as in see: lips lightly stretched sideways, a very narrow horizontal slit with upper teeth just visible. The mouth is not round.",
    "i-open": "Clearly articulated EE vowel as in see: lip corners stretched sideways, broad horizontal aperture but a shallow jaw opening, upper and lower teeth close together. Speaking, not smiling or grinning.",
    "o-small": "Quiet OH vowel as in go: lips softly rounded forward, small oval aperture, corners pulled inward. Subtle pout, not a smile, no prominent teeth.",
    "o-open": "Clearly articulated OH vowel as in go: round vertical oval aperture, lips rounded forward with tucked-in corners, moderately open jaw. Not wide sideways, no prominent teeth.",
    "u-small": "Quiet OO vowel as in blue: lips slightly protruded and tightly rounded into a tiny central aperture, narrow mouth width. Not whistling exaggeratedly.",
    "u-open": "Clearly articulated OO vowel as in blue: pursed protruding lips, small rounded opening noticeably narrower than OH, modest jaw opening. Mouth corners inward, no teeth visible.",
}


def prepare(source):
    scratch = ROOT / "tmp/imagegen"
    scratch.mkdir(parents=True, exist_ok=True)
    image = Image.open(source).convert("RGB")
    if image.size != (750, 450):
        raise ValueError("Expected the supplied 750x450 podium portrait")
    face = image.crop(CROP).resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    face.save(scratch / "face.png")
    mask = Image.new("RGBA", face.size, (255, 255, 255, 255))
    draw = ImageDraw.Draw(mask)
    # Source mouth is near (371, 134). Keep the eyes, nose and microphone outside the edit.
    scale = SIZE / 240
    draw.ellipse(tuple(round(value * scale) for value in (93, 118, 150, 157)), fill=(0, 0, 0, 0))
    mask.save(scratch / "mouth-mask.png")
    for name, instruction in STATES.items():
        prompt = (
            "Use case: identity-preserve. Asset type: one photographic mouth pose for an explicitly labeled AI conversation avatar.\n"
            "Edit target: the provided square face crop. Preserve the exact person, face identity, camera angle, scale, nose, eyes, eyebrows, hair, skin texture, lighting and neck.\n"
            f"Change ONLY the lips and immediately adjacent mouth skin to this pose: {instruction}\n"
            "Keep the original lip center in the same position. Keep the chin outline and nose fixed. Do not move the head, change the gaze or enhance/sharpen the image.\n"
            "The transparent part of the mask is the only editable region. Keep the rest unchanged. Output exactly one square image with the same framing.\n"
            "No text, labels, panels, borders, new objects or added watermarks. Match the softness and colors of the supplied photo."
        )
        (scratch / f"{name}.txt").write_text(prompt + "\n")
    print(f"Prepared face crop, mask and {len(STATES)} prompts in {scratch}")


def composite(source, names):
    cv2.setNumThreads(1)
    base = np.array(Image.open(source).convert("RGB"))
    reference = np.array(Image.open(ROOT / "tmp/imagegen/face.png").convert("RGB"))
    output = ROOT / "src/assets/photo-podium"
    output.mkdir(parents=True, exist_ok=True)
    scale = SIZE / 240
    # Align on the upper face, well outside the edited lips.
    x, y, width, height = (round(value * scale) for value in (65, 38, 100, 77))
    template = cv2.cvtColor(reference[y:y + height, x:x + width], cv2.COLOR_RGB2GRAY)
    mask = np.zeros((450, 750), dtype=np.float32)
    cv2.ellipse(mask, (371, 136), (29, 21), 0, 0, 360, 1, -1)
    mask = cv2.GaussianBlur(mask, (9, 9), 2)[..., None]
    for name in names:
        generated = np.array(Image.open(ROOT / f"output/imagegen/podium/{name}.png").convert("RGB").resize((SIZE, SIZE)))
        gray = cv2.cvtColor(generated[y:y + height, x:x + width], cv2.COLOR_RGB2GRAY)
        score, warp = cv2.findTransformECC(template, gray, np.eye(2, 3, dtype=np.float32), cv2.MOTION_EUCLIDEAN,
                                          (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 100, 1e-6))
        if score < .9:
            raise ValueError(f"{name}: face alignment failed ({score:.3f})")
        origin = np.array([x, y], dtype=np.float32)
        warp[:, 2] += origin - warp[:, :2] @ origin
        aligned = cv2.warpAffine(generated, warp, (SIZE, SIZE), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP)
        patch = np.array(Image.fromarray(aligned).resize((240, 240), Image.Resampling.LANCZOS))
        edited = base.copy()
        edited[0:240, 250:490] = patch
        result = np.rint(base * (1 - mask) + edited * mask).astype(np.uint8)
        portrait = Image.fromarray(result)
        if name != "closed":
            portrait = portrait.crop(MOUTH)
        portrait.save(output / f"{name}.webp", lossless=True)
        print(f"{name}: alignment={score:.4f}, bytes={(output / f'{name}.webp').stat().st_size}")
    metadata = {"width": 750, "height": 450, "mouth": [338, 111, 67, 51], "poses": list(STATES), "patches": True}
    (output / "geometry.json").write_text(json.dumps(metadata, indent=2) + "\n")
    available = [name for name in STATES if (output / f"{name}.webp").exists()]
    sheet = Image.new("RGB", (4 * 240, ((len(available) + 3) // 4) * 245), "#f5f5f5")
    draw = ImageDraw.Draw(sheet)
    for index, name in enumerate(available):
        portrait = Image.open(output / "closed.webp").convert("RGB")
        if name != "closed":
            portrait.paste(Image.open(output / f"{name}.webp"), MOUTH[:2])
        face = portrait.crop((317, 75, 425, 171)).resize((216, 192))
        x, y = (index % 4) * 240, (index // 4) * 245
        sheet.paste(face, (x + 12, y + 28))
        draw.text((x + 12, y + 8), name, fill="black")
    preview = ROOT / "output/imagegen/podium/contact-sheet.png"
    sheet.save(preview)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["prepare", "composite"])
    parser.add_argument("--source", type=Path, default=ROOT / "avatar-source.jpg.png")
    parser.add_argument("--states", nargs="+", choices=list(STATES), default=list(STATES))
    args = parser.parse_args()
    if args.action == "prepare":
        prepare(args.source)
    else:
        composite(args.source, args.states)
