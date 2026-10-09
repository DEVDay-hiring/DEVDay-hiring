"""Extract the three photo mouth states from the supplied 25fps Trump clip.

Offline asset preparation only. Requires OpenCV and NumPy, not MuseTalk.
"""

import argparse
from pathlib import Path

import cv2
import numpy as np


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", type=Path, default=root.parent / "lip-sync-service/samples/input_video/avatar_25fps.mp4")
    parser.add_argument("--output", type=Path, default=root / "src/assets/photo-trump")
    options = parser.parse_args()
    cv2.setNumThreads(1)
    capture = cv2.VideoCapture(str(options.video))
    try:
        if not capture.isOpened() or abs(capture.get(cv2.CAP_PROP_FPS) - 25) > 0.01:
            raise ValueError("Expected the supplied 1920x1080, 25fps avatar clip")
        wanted = {164: "closed", 166: "small", 170: "open"}
        frames = {}
        capture.set(cv2.CAP_PROP_POS_FRAMES, min(wanted))
        for index in range(min(wanted), max(wanted) + 1):
            ok, frame = capture.read()
            if not ok or frame.shape[:2] != (1080, 1920):
                raise ValueError("Unexpected source frame dimensions or duration")
            if index in wanted:
                frames[wanted[index]] = frame
    finally:
        capture.release()

    base = frames["closed"]
    anchor = (810, 210, 280, 140)
    x, y, width, height = anchor
    template = cv2.cvtColor(base[y:y + height, x:x + width], cv2.COLOR_BGR2GRAY)
    mask = np.zeros(base.shape[:2], dtype=np.float32)
    cv2.ellipse(mask, (966, 394), (58, 34), 0, 0, 360, 1, -1)
    mask = cv2.GaussianBlur(mask, (25, 25), 6)[..., None]
    options.output.mkdir(parents=True, exist_ok=True)

    for state, frame in frames.items():
        result = base
        if state != "closed":
            image = cv2.cvtColor(frame[y:y + height, x:x + width], cv2.COLOR_BGR2GRAY)
            warp = np.eye(2, 3, dtype=np.float32)
            score, warp = cv2.findTransformECC(template, image, warp, cv2.MOTION_EUCLIDEAN,
                                             (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 100, 1e-6))
            if score < 0.9:
                raise ValueError("Mouth source could not be aligned reliably")
            origin = np.array([x, y], dtype=np.float32)
            warp[:, 2] += origin - warp[:, :2] @ origin
            aligned = cv2.warpAffine(frame, warp, (base.shape[1], base.shape[0]),
                                     flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP)
            # Keep the head, eyes, clothes and background identical in all three states.
            result = np.rint(base * (1 - mask) + aligned * mask).astype(np.uint8)
        portrait = result[60:720, 530:1410]
        target = options.output / f"{state}.webp"
        if not cv2.imwrite(str(target), portrait, [cv2.IMWRITE_WEBP_QUALITY, 101]):
            raise RuntimeError(f"Could not write {target}")
        print(f"{target.name}: {portrait.shape[1]}x{portrait.shape[0]}, {target.stat().st_size} bytes")


if __name__ == "__main__":
    main()
