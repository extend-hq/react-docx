#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Measure visual difference between viewer screenshots and ground-truth PNGs."
    )
    parser.add_argument("pairs_manifest", help="JSON file containing image comparison pairs.")
    parser.add_argument("output_json", help="Path to write comparison metrics JSON.")
    parser.add_argument("--width", type=int, default=396, help="Normalized comparison width.")
    parser.add_argument("--height", type=int, default=560, help="Normalized comparison height.")
    parser.add_argument(
        "--tolerance",
        type=int,
        default=18,
        help="Per-channel absolute-difference tolerance used for mismatch ratio."
    )
    return parser.parse_args()


def open_normalized_image(path: Path, width: int, height: int) -> np.ndarray:
    image = Image.open(path).convert("RGBA")
    canvas = Image.new("RGBA", image.size, (255, 255, 255, 255))
    canvas.alpha_composite(image)
    normalized = canvas.convert("RGB").resize((width, height), Image.Resampling.LANCZOS)
    return np.asarray(normalized, dtype=np.int16)


def main() -> int:
    args = parse_args()
    pairs = json.loads(Path(args.pairs_manifest).read_text("utf8"))
    results: list[dict[str, object]] = []

    for pair in pairs:
      viewer_path = Path(pair["viewerPath"])
      ground_truth_path = Path(pair["groundTruthPath"])
      viewer = open_normalized_image(viewer_path, args.width, args.height)
      ground_truth = open_normalized_image(ground_truth_path, args.width, args.height)

      diff = np.abs(viewer - ground_truth)
      mean_abs = float(diff.mean() / 255.0)
      rmse = float(math.sqrt(np.mean(np.square(diff, dtype=np.float64))) / 255.0)
      mismatch_ratio = float(np.mean(np.max(diff, axis=2) > args.tolerance))

      results.append(
          {
              **pair,
              "meanAbsoluteDiff": round(mean_abs, 6),
              "rootMeanSquareDiff": round(rmse, 6),
              "mismatchRatio": round(mismatch_ratio, 6),
          }
      )

    Path(args.output_json).write_text(
        json.dumps(
            {
                "comparisonWidth": args.width,
                "comparisonHeight": args.height,
                "tolerance": args.tolerance,
                "results": results,
            },
            indent=2,
        )
        + "\n",
        encoding="utf8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
