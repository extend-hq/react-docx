# Word input formats

The [0.13.0 release comparison](benchmarks-0.13.0.md) contains the final benchmarks rerun on merged main.

`extend-docx::parse_document_bytes` and `parse_document_blocks` accept bytes, not a filename or MIME type. They dispatch compound-file input to the legacy Word adapter and other input to the OOXML ZIP reader. The document structures inside the container must still be valid; a ZIP or CFB signature alone does not establish Word support.

The standard Word input family comprises six extensions and five distinct MIME types:

| Extension | Format | Canonical MIME type | Parser path |
| --- | --- | --- | --- |
| `.doc` | Word 97–2003 binary document | `application/msword` | Legacy Word binary |
| `.dot` | Word 97–2003 binary template | `application/msword` | Legacy Word binary |
| `.docx` | OOXML document | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | OOXML ZIP |
| `.dotx` | OOXML template | `application/vnd.openxmlformats-officedocument.wordprocessingml.template` | OOXML ZIP |
| `.docm` | Macro-enabled OOXML document | `application/vnd.ms-word.document.macroEnabled.12` | OOXML ZIP |
| `.dotm` | Macro-enabled OOXML template | `application/vnd.ms-word.template.macroEnabled.12` | OOXML ZIP |

MIME registrations: [binary Word](https://www.iana.org/assignments/media-types/application/msword), [OOXML document](https://www.iana.org/assignments/media-types/application/vnd.openxmlformats-officedocument.wordprocessingml.document), [OOXML template](https://www.iana.org/assignments/media-types/application/vnd.openxmlformats-officedocument.wordprocessingml.template), [macro-enabled document](https://www.iana.org/assignments/media-types/application/vnd.ms-word.document.macroEnabled.12), [macro-enabled template](https://www.iana.org/assignments/media-types/application/vnd.ms-word.template.macroEnabled.12). Microsoft describes the extensions in its [file-format reference](https://learn.microsoft.com/office/compatibility/office-file-format-reference).

These describe content extraction. They do not promise macro execution, template instantiation, extraction of every template resource, full format fidelity, or lossless round trips to a template or macro-enabled format. Native block extraction requires a separate layout step for page geometry. Supported bytes can also arrive with a generic `application/octet-stream` MIME type or a misleading extension; neither adds a new supported format. Strict and Transitional OOXML share these MIME types; feature coverage remains implementation-dependent.

Encrypted/password-to-open documents and pre-Word-97 binary formats are not supported. There are no standalone input adapters for RTF, ODT/OTT, Word 2003 XML, Flat OPC XML, HTML/MHTML, PDF, XLS/XLSX, or PPT/PPTX. Embedded media processing does not imply standalone support for its file formats.

The legacy adapter uses the repository's own CFB reader, followed by Word binary decoding and synthesis of an OOXML package for the shared model builder. It does not depend on the external Rust `cfb` crate. Swapping that crate in would replace container access, not Word decoding.

## Measured coverage

The November 2, 2026 targeted benchmark uses 10 existing binary DOC documents, 10 LibreOffice-generated DOT templates, 12 existing OOXML documents, and 12 controlled package variants each for DOTX, DOCM, and DOTM. The package variants change the main-part content type and contain no VBA project. They establish compatibility with those package variants, not broad real-world macro/template coverage.

Raw receipts and the interactive report are stored locally under `output/word-formats-20261102`. The report separates each format, preserves all feature metrics, and limits comparative timings to the common successful cohort for parsers with that format capability. Binary references come from LibreOffice conversion and are a proxy, not Word ground truth. Original filename extensions are not used to decide the format.

The expanded external corpus is stored under `output/word-formats-expanded-20261102`. It contains 257 content-hash-deduplicated originals: 203 DOC, 31 DOCX, 6 DOCM, 4 DOTX, 2 DOT, and 11 DOTM. Sources are Embrace/SafeDocs, public Apache POI, Apache Tika and LibreOffice regression corpora, and public template download pages. Ten inputs contain VBA-related streams or projects; macros are not executed. No generated variants are included in this cohort.

Independent inspection identifies nine pre-Word-97 documents and two encrypted documents outside core's declared scope. The report exposes both the declared-supported-version cohort and all acquired Word inputs. Reference generation/extraction succeeds for 253 inputs; two encrypted inputs and two other unreadable binary inputs are retained in parse coverage but omitted from accuracy denominators. Public regression corpora include deliberately malformed inputs and are not representative of production error rates.

The repair retains the initial `output/word-formats-fixed-20261102` measurements. Final four-library reruns are stored under `output/word-formats-final-20261102`, with separate first-pass and repaired new-input cohorts and a complete 1,000-DOCX rerun. The complete [fix and validation report](word-parser-fixes.md) includes before/after feature recall, the measured latency cost, and unresolved fidelity limits. The original corpus, references, scores, and baseline report remain intact.

## Reproduce the benchmark

Build the pinned comparison harness and copy its executable into the run directory's `bin/parser-benchmark`. Use `corpus.py` to inventory explicitly supplied local roots and create `manifest.json`. Its legacy conversion requires absolute input roots. Create binary references in `references`, then use LibreOffice's `dot:MS Word 97 Vorlage` export filter to create hash-named templates in `generated/dot`. Reopen those templates with LibreOffice's DOCX export into `references/dot`.

Run the following phases from the repository root, with an absolute or repository-relative run directory:

```sh
python3 scripts/parser-benchmark/word_formats.py prepare --out output/word-formats-20261102
python3 scripts/parser-benchmark/word_formats.py run --out output/word-formats-20261102 --repeats 9
python3 scripts/parser-benchmark/word_formats.py score --out output/word-formats-20261102
python3 scripts/parser-benchmark/word_formats.py report --out output/word-formats-20261102
```

The preparation phase selects paired local OOXML fixtures plus six inputs spread by size below 5 MB. Review `format-manifest.json` before timing when changing the corpus. Run timings sequentially after builds and reference generation finish. `format-environment.json` records executable, source, scorer, and corpus hashes, pinned versions, repeat count, random seed, and load averages. The timing samples exclude filesystem reads, output serialization, destruction, process startup, and reference conversion. The p95 is across per-document warm medians, not a request-level service p95.

For downloaded originals, use `word_formats_external.py` with the `inventory`, `references`, and `oracles` phases instead of `word_formats.py prepare`. Install `olefile` into the run directory's `python-deps` for independent binary classification. Keep download manifests under `downloads`, then run the same `run`, `score`, and `report` phases. Reference conversion uses isolated LibreOffice profiles with macro security set to its highest level. Preserve failed conversions and missing references as explicit records.
