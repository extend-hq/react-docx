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
        "--ink-threshold",
        type=int,
        default=24,
        help="Threshold for considering a pixel non-white in structural comparisons."
    )
    parser.add_argument(
        "--vertical-bands",
        type=int,
        default=12,
        help="Number of horizontal slices used for vertical page-structure comparison."
    )
    parser.add_argument(
        "--horizontal-bands",
        type=int,
        default=8,
        help="Number of vertical slices used for horizontal page-structure comparison."
    )
    parser.add_argument(
        "--grid-columns",
        type=int,
        default=6,
        help="Grid columns used for coarse page occupancy comparison."
    )
    parser.add_argument(
        "--grid-rows",
        type=int,
        default=8,
        help="Grid rows used for coarse page occupancy comparison."
    )
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


def to_ink_mask(image: np.ndarray, ink_threshold: int) -> np.ndarray:
    return np.max(255 - image, axis=2) > ink_threshold


def normalize_edge_position(indexes: np.ndarray, fallback: float, divisor: int) -> float:
    if indexes.size == 0:
        return fallback
    return float(indexes[0] / divisor)


def normalize_trailing_edge_position(indexes: np.ndarray, fallback: float, divisor: int) -> float:
    if indexes.size == 0:
        return fallback
    return float(indexes[-1] / divisor)


def band_profile(mask: np.ndarray, count: int, axis: int) -> np.ndarray:
    bands = np.array_split(mask, count, axis=axis)
    return np.asarray([float(band.mean()) for band in bands], dtype=np.float64)


def grid_profile(mask: np.ndarray, columns: int, rows: int) -> np.ndarray:
    row_bands = np.array_split(mask, rows, axis=0)
    cells: list[float] = []
    for row_band in row_bands:
        for column_band in np.array_split(row_band, columns, axis=1):
            cells.append(float(column_band.mean()))
    return np.asarray(cells, dtype=np.float64)


def structure_metrics(
    viewer_mask: np.ndarray,
    ground_truth_mask: np.ndarray,
    vertical_bands: int,
    horizontal_bands: int,
    grid_columns: int,
    grid_rows: int,
) -> dict[str, float]:
    viewer_rows = np.where(viewer_mask.any(axis=1))[0]
    viewer_cols = np.where(viewer_mask.any(axis=0))[0]
    ground_truth_rows = np.where(ground_truth_mask.any(axis=1))[0]
    ground_truth_cols = np.where(ground_truth_mask.any(axis=0))[0]

    viewer_coverage = float(viewer_mask.mean())
    ground_truth_coverage = float(ground_truth_mask.mean())
    viewer_top = normalize_edge_position(viewer_rows, 1.0, viewer_mask.shape[0])
    viewer_bottom = normalize_trailing_edge_position(viewer_rows, 0.0, viewer_mask.shape[0])
    viewer_left = normalize_edge_position(viewer_cols, 1.0, viewer_mask.shape[1])
    viewer_right = normalize_trailing_edge_position(viewer_cols, 0.0, viewer_mask.shape[1])
    ground_truth_top = normalize_edge_position(ground_truth_rows, 1.0, ground_truth_mask.shape[0])
    ground_truth_bottom = normalize_trailing_edge_position(ground_truth_rows, 0.0, ground_truth_mask.shape[0])
    ground_truth_left = normalize_edge_position(ground_truth_cols, 1.0, ground_truth_mask.shape[1])
    ground_truth_right = normalize_trailing_edge_position(ground_truth_cols, 0.0, ground_truth_mask.shape[1])

    vertical_profile_diff = float(
        np.mean(
            np.abs(
                band_profile(viewer_mask, vertical_bands, axis=0)
                - band_profile(ground_truth_mask, vertical_bands, axis=0)
            )
        )
    )
    horizontal_profile_diff = float(
        np.mean(
            np.abs(
                band_profile(viewer_mask, horizontal_bands, axis=1)
                - band_profile(ground_truth_mask, horizontal_bands, axis=1)
            )
        )
    )
    grid_density_diff = float(
        np.mean(
            np.abs(
                grid_profile(viewer_mask, grid_columns, grid_rows)
                - grid_profile(ground_truth_mask, grid_columns, grid_rows)
            )
        )
    )
    average_coverage = (viewer_coverage + ground_truth_coverage) / 2.0
    edge_weight = min(1.0, average_coverage / 0.05)
    coverage_diff = abs(viewer_coverage - ground_truth_coverage)
    top_diff = abs(viewer_top - ground_truth_top)
    bottom_diff = abs(viewer_bottom - ground_truth_bottom)
    left_diff = abs(viewer_left - ground_truth_left)
    right_diff = abs(viewer_right - ground_truth_right)
    weighted_total = (
        coverage_diff
        + vertical_profile_diff
        + horizontal_profile_diff
        + grid_density_diff
        + edge_weight * (top_diff + bottom_diff + left_diff + right_diff)
    )
    weighted_denominator = 4.0 + 4.0 * edge_weight

    return {
        "viewerInkCoverage": round(viewer_coverage, 6),
        "groundTruthInkCoverage": round(ground_truth_coverage, 6),
        "inkCoverageDiff": round(coverage_diff, 6),
        "viewerTopInk": round(viewer_top, 6),
        "groundTruthTopInk": round(ground_truth_top, 6),
        "topInkDiff": round(top_diff, 6),
        "viewerBottomInk": round(viewer_bottom, 6),
        "groundTruthBottomInk": round(ground_truth_bottom, 6),
        "bottomInkDiff": round(bottom_diff, 6),
        "viewerLeftInk": round(viewer_left, 6),
        "groundTruthLeftInk": round(ground_truth_left, 6),
        "leftInkDiff": round(left_diff, 6),
        "viewerRightInk": round(viewer_right, 6),
        "groundTruthRightInk": round(ground_truth_right, 6),
        "rightInkDiff": round(right_diff, 6),
        "verticalProfileDiff": round(vertical_profile_diff, 6),
        "horizontalProfileDiff": round(horizontal_profile_diff, 6),
        "gridDensityDiff": round(grid_density_diff, 6),
        "layoutEdgeWeight": round(edge_weight, 6),
        "layoutStructureDiff": round(
            weighted_total / weighted_denominator,
            6,
        ),
    }


def main() -> int:
    args = parse_args()
    pairs = json.loads(Path(args.pairs_manifest).read_text("utf8"))
    results: list[dict[str, object]] = []

    for pair in pairs:
      viewer_path = Path(pair["viewerPath"])
      ground_truth_path = Path(pair["groundTruthPath"])
      viewer = open_normalized_image(viewer_path, args.width, args.height)
      ground_truth = open_normalized_image(ground_truth_path, args.width, args.height)
      viewer_mask = to_ink_mask(viewer, args.ink_threshold)
      ground_truth_mask = to_ink_mask(ground_truth, args.ink_threshold)

      diff = np.abs(viewer - ground_truth)
      mean_abs = float(diff.mean() / 255.0)
      rmse = float(math.sqrt(np.mean(np.square(diff, dtype=np.float64))) / 255.0)
      mismatch_ratio = float(np.mean(np.max(diff, axis=2) > args.tolerance))
      structure = structure_metrics(
          viewer_mask,
          ground_truth_mask,
          args.vertical_bands,
          args.horizontal_bands,
          args.grid_columns,
          args.grid_rows,
      )

      results.append(
          {
              **pair,
              "meanAbsoluteDiff": round(mean_abs, 6),
              "rootMeanSquareDiff": round(rmse, 6),
              "mismatchRatio": round(mismatch_ratio, 6),
              **structure,
          }
      )

    Path(args.output_json).write_text(
        json.dumps(
            {
                "comparisonWidth": args.width,
                "comparisonHeight": args.height,
                "tolerance": args.tolerance,
                "inkThreshold": args.ink_threshold,
                "verticalBands": args.vertical_bands,
                "horizontalBands": args.horizontal_bands,
                "gridColumns": args.grid_columns,
                "gridRows": args.grid_rows,
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
