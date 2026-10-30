import argparse
import collections
import datetime
import gzip
import hashlib
import json
import math
import statistics
from pathlib import Path
from zoneinfo import ZoneInfo


ENGINES = ("docx-core", "docx-rs", "office_oxide", "undoc")
NORMALIZATION = {
    "JSON object key order",
    "paragraphStyles and tableStyles definition order",
}
EDGE_AUDITS = (
    ("final-xml-strict-parity.json", "XML compatibility", 51),
    ("final-prolog-strict-parity.json", "XML declarations and prologs", 51),
    ("final-boundary-strict-parity.json", "Prolog boundaries", 16),
)
CHART_METRICS = {
    "input_bytes": {"label": "Package size", "unit": "bytes",
                    "description": "Compressed input package size in bytes."},
    "xml_bytes": {"label": "XML package size", "unit": "bytes",
                  "description": "Total uncompressed .xml and .rels bytes across the package, from the ZIP directory."},
    "paragraphs": {"label": "Reference paragraphs", "unit": "paragraphs",
                   "description": "Source-reference paragraph occurrences across all stories."},
    "reference_characters": {"label": "Reference text length", "unit": "characters",
                             "description": "Summed Unicode character counts of the original oracle's normalized text across all stories."},
    "table_cells": {"label": "Reference table cells", "unit": "cells",
                    "description": "Source-reference table-cell occurrences across all stories."},
    "images": {"label": "Reference image occurrences", "unit": "occurrences",
               "description": "Source-reference image occurrences across all stories; these are markup counts, not unique assets or verified rendered images."},
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_json(path):
    return json.loads(path.read_text())


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def quantile(values, fraction):
    values = sorted(values)
    require(bool(values), "Cannot summarize an empty measurement group")
    position = (len(values) - 1) * fraction
    lower = int(position)
    upper = min(lower + 1, len(values) - 1)
    return values[lower] + (values[upper] - values[lower]) * (position - lower)


def latency_summary(values):
    require(all(math.isfinite(value) and value > 0 for value in values),
            "Latency measurements must be finite and positive")
    return {
        "documents": len(values),
        "median_ms": statistics.median(values),
        "p95_ms": quantile(values, 0.95),
        "sum_document_medians_ms": sum(values),
    }


def indexed_rows(rows):
    result = collections.defaultdict(dict)
    for row in rows:
        require(row["engine"] in ENGINES, "Unexpected engine in native comparison")
        require(row["engine"] not in result[row["id"]], "Duplicate native measurement")
        result[row["id"]][row["engine"]] = row
    return result


def complete_parity(path, expected_count, baseline_hash, candidate_hash,
                    expected_ids=None, expected_digest=None):
    audit = read_json(path)
    require(audit["binary_sha256"] == {
        "baseline": baseline_hash, "candidate": candidate_hash,
    }, f"Parser hashes do not match the final build in {path.name}")
    require(set(audit["normalization"]) == NORMALIZATION,
            f"Unexpected output normalization in {path.name}")
    records = audit["records"]
    require(len(records) == expected_count, f"Incomplete parity audit: {path.name}")
    ids = {row["id"] for row in records}
    require(len(ids) == expected_count, f"Duplicate parity records: {path.name}")
    if expected_ids is not None:
        require(ids == expected_ids, "Full parity audit does not cover the unchanged corpus")
    if expected_digest is not None:
        require(audit["digest_sha256"] == expected_digest,
                "Parity audits used different digest executables")
    for row in records:
        require(row.get("equal") is True, f"Output difference in {path.name}")
        for side, binary_hash in (("baseline", baseline_hash), ("candidate", candidate_hash)):
            value = row[side]
            require(value.get("status") == "ok" and value.get("compact_output") is False,
                    "Parity must use successful complete output")
            require(value.get("binary_sha256") == binary_hash,
                    "A parity record has a stale parser hash")
            require(value.get("digest_sha256") == audit["digest_sha256"],
                    "A parity record has a different digest hash")
        for field in ("model", "blocks"):
            require(row["baseline"][field] == row["candidate"][field],
                    "Full-output hashes or event counts differ")
    return {"matched": expected_count, "total": expected_count,
            "digest_sha256": audit["digest_sha256"]}


def paired_summary(rows):
    before = [row["baseline"]["medians"]["total_ms"] for row in rows]
    after = [row["candidate"]["medians"]["total_ms"] for row in rows]
    ratios = [a / b for a, b in zip(before, after)]
    return {
        "documents": len(rows),
        "median_paired_speedup": statistics.median(ratios),
        "faster_documents": sum(value > 1 for value in ratios),
        "baseline": latency_summary(before),
        "candidate": latency_summary(after),
        "p95_latency_ratio": quantile(before, 0.95) / quantile(after, 0.95),
        "q10_paired_speedup": quantile(ratios, 0.1),
        "q90_paired_speedup": quantile(ratios, 0.9),
    }


def load_paired(path, ids, baseline_hash, candidate_hash):
    run = read_json(path)
    require(run["binaries"]["baseline"]["sha256"] == baseline_hash,
            "Paired timings use a stale baseline probe")
    require(run["binaries"]["candidate"]["sha256"] == candidate_hash,
            "Paired timings use a stale candidate probe")
    rows = run["rows"]
    require(len(rows) == len(ids) and {row["id"] for row in rows} == ids,
            "Paired measurements do not cover the declared split")
    require(all("medians" in row.get(side, {}) for row in rows
                for side in ("baseline", "candidate")), "Incomplete paired timings")
    return rows, {"repeats": run["repeats"], "summary": paired_summary(rows)}


def wasm_summary(root):
    run = read_json(root / "wasm-comparison.json")
    sizes = {}
    for side, name in (("baseline", "baseline.wasm"), ("candidate", "final.wasm")):
        data = (root / name).read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        require(run["binaries"][side] == digest, "WASM timings use different module bytes")
        sizes[side] = {"raw": len(data), "gzip": len(gzip.compress(data, mtime=0)),
                       "sha256": digest}
    rows = run["rows"]
    require(bool(rows) and len({row["id"] for row in rows}) == len(rows),
            "Missing or duplicate WASM measurements")
    require(all(row[side].get("status") == "ok" for row in rows
                for side in ("baseline", "candidate")), "WASM comparison is incomplete")
    result = {"documents": len(rows), "repeats": run["repeats"], "size": sizes}
    for side in ("baseline", "candidate"):
        result[side] = {
            "warm_median_ms": statistics.median(row[side]["median_ms"] for row in rows),
            "warm_p95_ms": quantile([row[side]["median_ms"] for row in rows], 0.95),
            "cold_total_median_ms": statistics.median(
                row[side]["init_ms"] + row[side]["cold_ms"] for row in rows),
        }
    result["median_paired_warm_speedup"] = statistics.median(
        row["baseline"]["median_ms"] / row["candidate"]["median_ms"] for row in rows)
    result["median_paired_cold_speedup"] = statistics.median(
        (row["baseline"]["init_ms"] + row["baseline"]["cold_ms"])
        / (row["candidate"]["init_ms"] + row["candidate"]["cold_ms"]) for row in rows)
    result["gzip_change_percent"] = 100 * (sizes["candidate"]["gzip"] / sizes["baseline"]["gzip"] - 1)
    return result, {row["id"] for row in rows}


def build_report(args):
    root = args.out
    previous = read_json(args.previous / "summary.json")
    manifest = read_json(args.manifest)["entries"]
    manifest_ids = {entry["id"] for entry in manifest}
    docx_ids = {entry["id"] for entry in manifest if entry["format"] == "docx"}
    doc_ids = {entry["id"] for entry in manifest if entry["format"] == "doc"}
    require(len(manifest_ids) == len(manifest), "Corpus contains duplicate identifiers")
    candidate_hash = sha256(root / "final-parser-benchmark")
    baseline_hash = sha256(root / "baseline-parser-benchmark")
    require(baseline_hash == previous["candidate_binary_sha256"],
            "Baseline does not match the previously validated build")
    parity = complete_parity(root / "final-strict-parity.json", len(manifest),
                             baseline_hash, candidate_hash, manifest_ids)
    edge_audits = []
    for name, label, count in EDGE_AUDITS:
        result = complete_parity(root / name, count, baseline_hash, candidate_hash,
                                 expected_digest=parity["digest_sha256"])
        edge_audits.append({"label": label, "matched": result["matched"], "total": count})

    rows = read_json(root / "comparison-full/rows.json")
    require(len(rows) == len(manifest) * len(ENGINES), "Native comparison is incomplete")
    require(all(row["binary_sha256"] == candidate_hash for row in rows),
            "Native comparison contains stale executable hashes")
    current = indexed_rows(rows)
    require(set(current) == manifest_ids and all(set(v) == set(ENGINES) for v in current.values()),
            "Native comparison does not cover all engines and inputs")
    previous_rows = indexed_rows(read_json(args.previous / "comparison-full/rows.json"))
    fixed_common = {key for key in docx_ids if all(
        previous_rows[key][engine].get("status") == "ok" for engine in ENGINES)}
    require(len(fixed_common) == previous["performance"]["all"]["common"],
            "Previous common-success cohort is inconsistent")
    require(all(current[key][engine].get("status") == "ok"
                and "medians" in current[key][engine]
                for key in fixed_common for engine in ENGINES),
            "A fixed-cohort input did not complete; do not silently change the comparison cohort")
    engines = {}
    for engine in ENGINES:
        selected = [current[key][engine] for key in sorted(fixed_common)]
        engines[engine] = {
            **latency_summary([row["medians"]["total_ms"] for row in selected]),
            "median_relative_mad": statistics.median(row["relative_mad"] for row in selected),
            "statuses_all_docx": dict(collections.Counter(current[key][engine]["status"] for key in docx_ids)),
            "core_faster_documents": sum(current[key]["docx-core"]["medians"]["total_ms"]
                                          < current[key][engine]["medians"]["total_ms"] for key in fixed_common),
            "median_core_to_engine_ratio": statistics.median(
                current[key]["docx-core"]["medians"]["total_ms"]
                / current[key][engine]["medians"]["total_ms"] for key in fixed_common),
        }
    require(all(current[key]["docx-core"].get("status") == "ok" for key in docx_ids),
            "docx-core did not successfully parse the complete DOCX corpus")
    core_all = latency_summary([current[key]["docx-core"]["medians"]["total_ms"] for key in docx_ids])
    chart_source = read_json(root / "chart-metrics.json")["rows"]
    manifest_by_id = {entry["id"]: entry for entry in manifest}
    chart_points = []
    for ordinal, key in enumerate(sorted(fixed_common), start=1):
        require(key in chart_source, "A fixed-cohort input is missing chart metrics")
        metrics = {name: chart_source[key][name] for name in CHART_METRICS}
        require(all(isinstance(value, (int, float)) and not isinstance(value, bool)
                    and math.isfinite(value) and value >= 0 for value in metrics.values()),
                "Chart axes require finite nonnegative numbers, including zero counts")
        require(metrics["input_bytes"] == manifest_by_id[key]["bytes"]
                and all(current[key][engine]["input_bytes"] == metrics["input_bytes"]
                        for engine in ENGINES), "Chart package size does not match the timed input")
        chart_points.append({
            "ordinal": ordinal, "metrics": metrics,
            "latency_ms": {engine: current[key][engine]["medians"]["total_ms"] for engine in ENGINES},
        })
    quality = previous["feature_comparison_common_docx"]
    require(set(quality) == set(ENGINES)
            and all(value["documents"] == len(fixed_common) for value in quality.values()),
            "Retained feature scores do not match the fixed timing cohort")

    split = read_json(root / "split.json")
    profile_ids = read_json(root / "profile-ids.json")
    probe_hashes = {side: sha256(root / name) for side, name in
                    (("baseline", "baseline-probe"), ("candidate", "final-probe"))}
    _, tuning = load_paired(root / "final-tuning.json", set(split["tuning"]),
                            probe_hashes["baseline"], probe_hashes["candidate"])
    holdout_rows, holdout = load_paired(root / "final-holdout.json", set(split["holdout"]),
                                       probe_hashes["baseline"], probe_hashes["candidate"])
    validation = read_json(root / "validation.json")
    require(validation["candidate_binary_sha256"] == candidate_hash,
            "Validation does not bind the final native executable")
    require(validation.get("typecheck_passed") is True, "Type checking has not passed")
    decompressor = validation["decompressor_parity"]
    require(decompressor["binary_sha256"] == {
        "baseline": baseline_hash, "candidate": candidate_hash,
    }, "Decompressor audit does not bind the final native executable")
    require(isinstance(decompressor["cases"], int) and decompressor["cases"] > 0
            and decompressor["matched"] == decompressor["cases"],
            "Decompressor parity is incomplete")
    explored_ids = set(validation.get("explored_holdout_ids", profile_ids.values())) & set(split["holdout"])
    untouched_rows = [row for row in holdout_rows if row["id"] not in explored_ids]
    require(bool(untouched_rows), "No untouched within-turn holdout inputs remain")
    untouched = paired_summary(untouched_rows)
    checks = {}
    for name in ("rust", "javascript", "word_harness", "browser"):
        value = validation["tests"][name]
        require(all(isinstance(value[key], int) and value[key] >= 0
                    for key in ("passed", "failed", "skipped")), "Invalid validation counts")
        require(value["failed"] == 0, "Validation contains failures")
        checks[name] = {key: value[key] for key in ("passed", "failed", "skipped")}
    wasm, wasm_ids = wasm_summary(root)
    require(wasm_ids == set(split["tuning"]), "WASM timing cohort differs from the declared tuning cohort")
    layout_before = read_json(root / "layout-before.json")
    layout_after = read_json(root / validation["layout_candidate"])
    layout = [{"type": name.removeprefix("core."), "before_bytes": layout_before[name]["bytes"],
               "after_bytes": value["bytes"]}
              for name, value in layout_after.items()
              if name.startswith("core.") and name in layout_before]
    environment = read_json(root / "comparison-full/environment.json")
    require(environment["binary_sha256"] == candidate_hash, "Environment hash differs from timings")
    machine_source = read_json(root / "machine.json")
    machine = {key: machine_source[key] for key in
               ("cpu", "cores", "memory_bytes", "macos", "architecture", "rustc", "cargo", "node")}
    best_median = min(engines, key=lambda engine: engines[engine]["median_ms"])
    best_p95 = min(engines, key=lambda engine: engines[engine]["p95_ms"])
    data = {
        "generated_at": datetime.datetime.now(ZoneInfo("America/New_York")).isoformat(),
        "baseline_commit": read_json(root / "baseline.json")["commit"],
        "candidate_binary_sha256": candidate_hash,
        "machine": machine,
        "comparison": {"docx_attempted": len(docx_ids), "fixed_common": len(fixed_common),
                       "engines": engines, "core_all_docx": core_all,
                       "lowest_median": best_median, "lowest_p95": best_p95,
                       "core_fastest_both": best_median == "docx-core" and best_p95 == "docx-core",
                       "repeats": environment["repeats"],
                       "peak_one_minute_load": max(row["load_before"][0] for row in rows)},
        "paired": {"tuning": tuning, "holdout_all": holdout, "holdout_untouched_this_turn": untouched,
                   "profiled_holdout_documents": len(explored_ids)},
        "charts": {"metric_definitions": CHART_METRICS, "points": chart_points,
                   "identity": "Anonymous ordinal only; no corpus IDs, paths, names, or text are embedded",
                   "cohort_documents": len(fixed_common)},
        "quality_comparison": quality,
        "quality_provenance": "Unchanged extraction-reference scores for the same fixed common-success cohort. They are proxies for extraction coverage, not Word layout accuracy. Native timing is fresh; quality is transferred after full-output equivalence.",
        "parity": {"full": {"matched": parity["matched"], "total": parity["total"]},
                   "edge_audits": edge_audits, "normalization": sorted(NORMALIZATION),
                   "includes_source_xml_and_payloads": True},
        "tests": checks,
        "typecheck_passed": True,
        "decompressor_parity": {key: decompressor[key] for key in ("cases", "matched", "scope")},
        "test_totals": {key: sum(value[key] for value in checks.values())
                        for key in ("passed", "failed", "skipped")},
        "accuracy": previous["accuracy"],
        "accuracy_provenance": "Unchanged independent-reference scores transferred only after complete output equivalence to the previously validated build. Diagnostic reinterpretation does not rescore the benchmark.",
        "accuracy_diagnostics": read_json(root / "accuracy-diagnostics.json"),
        "wasm": wasm,
        "wasm_output_parity": validation.get("wasm_output_parity"),
        "layout": layout,
        "formatting_diagnostics": layout_after.get("formatting_diagnostics", {}),
        "implementation_notes": validation.get("implementation_notes", []),
        "legacy_doc": {"attempted": len(doc_ids), "statuses": {
            engine: dict(collections.Counter(current[key][engine]["status"] for key in doc_ids))
            for engine in ENGINES}},
    }
    return data


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=Path("output/parser-frontier"))
    parser.add_argument("--previous", type=Path, default=Path("output/parser-rewrite"))
    parser.add_argument("--manifest", type=Path, default=Path("output/parser-benchmark/manifest.json"))
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()
    data = build_report(args)
    if not args.check_only:
        (args.out / "report-data.json").write_text(json.dumps(data, indent=2))
        template = Path(__file__).with_name("frontier_report.html").read_text()
        payload = json.dumps(data).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
        require(template.count("REPORT_DATA") == 1, "Report template has an invalid data placeholder")
        (args.out / "report.html").write_text(template.replace("REPORT_DATA", payload))
    print(json.dumps({
        "common_documents": data["comparison"]["fixed_common"],
        "core_fastest_both": data["comparison"]["core_fastest_both"],
        "native_untouched_holdout": data["paired"]["holdout_untouched_this_turn"],
        "parity": data["parity"],
        "checks": data["test_totals"],
    }, indent=2))


if __name__ == "__main__":
    main()
