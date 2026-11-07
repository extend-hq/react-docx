import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  fileSha256,
  readEvidenceJson,
  referenceQualificationErrors,
} from "./corpus-evidence.mjs";

const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const args = process.argv.slice(2);
const index = args.indexOf("--output");
if (args.includes("--help")) {
  console.log(
    "Usage: node scripts/word-oracle/report-corpus.mjs --output PATH"
  );
  process.exit(0);
}
if (index < 0) throw new Error("--output is required");
const output = path.resolve(args[index + 1]);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
};
const resultName = option("--comparison", "comparison.json");
const reportName = option("--report", "report.html");
const changesName = option("--changes", "renderer-changes.json");
const comparison = JSON.parse(
  await fs.readFile(path.join(output, resultName), "utf8")
);
let pageFields = null;
const pageFieldsValidation = {
  globalErrors: [],
  rejectedDocuments: [],
  rejectedVariants: [],
};
try {
  const candidate = await readEvidenceJson(
    path.join(output, "page-number-field-audit.json")
  );
  const captureProfile = await readEvidenceJson(
    path.join(output, "capture-profile.json")
  );
  const builds = await readEvidenceJson(
    path.join(output, "build-identities.json")
  );
  const environment = await readEvidenceJson(
    path.join(output, "word-capture-environment.json")
  );
  if (candidate?.captureProfileSha256 !== captureProfile?.captureProfileSha256)
    pageFieldsValidation.globalErrors.push("Capture profile mismatch");
  if (candidate?.buildIdentitiesSha256 !== builds?.artifactSha256)
    pageFieldsValidation.globalErrors.push("Build manifest mismatch");
  if (candidate?.wordEnvironmentSha256 !== environment?.artifactSha256)
    pageFieldsValidation.globalErrors.push("Word environment mismatch");
  if (
    candidate?.auditScriptSha256 !==
    (await fileSha256(path.join(output, "audit_page_number_fields.py")))
  )
    pageFieldsValidation.globalErrors.push("Field auditor identity mismatch");
  if (
    candidate?.sourceTemplateArtifactSha256 !==
    (await fileSha256(path.join(output, "page-field-source-templates.json")))
  )
    pageFieldsValidation.globalErrors.push("Source template identity mismatch");
  if (!pageFieldsValidation.globalErrors.length) {
    const comparisonById = new Map(
      comparison.documents.map((document) => [document.id, document])
    );
    for (const document of candidate.documents) {
      const row = comparisonById.get(document.id);
      const errors = [];
      if (document.sourceSha256 !== row?.sourceSha256)
        errors.push("Comparison source identity mismatch");
      const observed = Object.values(document.variants).some(
        (variant) => variant.observations?.length
      );
      if (observed) {
        const receipt = await readEvidenceJson(
          path.join(
            output,
            "word-references",
            `${document.sourceSha256}.receipt.json`
          )
        );
        errors.push(
          ...referenceQualificationErrors(
            receipt,
            document.sourceSha256,
            environment
          )
        );
        if (
          receipt?.artifactSha256 !== document.wordReceiptSha256 ||
          receipt?.artifactSha256 !== row?.wordReceiptSha256
        )
          errors.push("Word receipt snapshot mismatch");
        if (
          receipt?.pdfSha256 !== document.wordPdfSha256 ||
          receipt?.geometrySha256 !== document.wordGeometrySha256 ||
          receipt?.environmentSha256 !== document.wordEnvironmentSha256
        )
          errors.push("Word artifact identity mismatch");
        if (row?.wordStatus !== "ok")
          errors.push("Comparison reference is unqualified");
        try {
          if ((await fileSha256(row.sourcePath)) !== document.sourceSha256)
            errors.push("Current source hash mismatch");
          if ((await fileSha256(receipt.pdfPath)) !== document.wordPdfSha256)
            errors.push("Current Word PDF hash mismatch");
          if (
            (await fileSha256(receipt.geometryPath)) !==
            document.wordGeometrySha256
          )
            errors.push("Current Word geometry hash mismatch");
        } catch (error) {
          errors.push(`Reference artifact unavailable: ${error.message}`);
        }
      }
      if (errors.length)
        pageFieldsValidation.rejectedDocuments.push({
          id: document.id,
          errors,
        });
      for (const [variant, captureAudit] of Object.entries(document.variants)) {
        const variantErrors = [...errors];
        if (
          captureAudit.observations?.length &&
          comparison.variants.includes(variant)
        ) {
          const capture = await readEvidenceJson(
            path.join(
              output,
              "renderer",
              variant,
              `${document.sourceSha256}.json`
            )
          );
          const snapshot = row?.captureIdentities?.[variant];
          if (
            capture?.artifactSha256 !== captureAudit.captureSha256 ||
            capture?.artifactSha256 !== snapshot?.captureSha256
          )
            variantErrors.push("Renderer capture snapshot mismatch");
          if (
            capture?.sourceSha256 !== document.sourceSha256 ||
            capture?.buildSha256 !== builds.builds[variant]?.buildSha256 ||
            captureAudit.buildSha256 !== capture?.buildSha256
          )
            variantErrors.push("Renderer source/build identity mismatch");
          if (
            capture?.captureProfileSha256 !==
              captureProfile.captureProfileSha256 ||
            captureAudit.captureProfileSha256 !==
              capture?.captureProfileSha256 ||
            capture?.captureConfiguration?.mode !== "read-only" ||
            capture?.status !== "ok"
          )
            variantErrors.push("Renderer capture profile unqualified");
        }
        if (variantErrors.length) {
          pageFieldsValidation.rejectedVariants.push({
            id: document.id,
            variant,
            errors: variantErrors,
          });
          captureAudit.observations = [];
          captureAudit.summary = null;
          captureAudit.qualification = "unavailable";
          captureAudit.qualificationReason = variantErrors.join("; ");
        }
      }
    }
    pageFields = candidate;
  }
} catch (error) {
  pageFieldsValidation.globalErrors.push(String(error));
}
let visual = null;
let visualSnapshot = null;
const visualValidation = { rejectedSnapshots: [] };
const visualIdentityErrors = (candidate, comparison, builds) => {
  const rows = new Map(comparison.documents.map((row) => [row.id, row]));
  const errors = [];
  for (const document of candidate.documents ?? []) {
    for (const variant of comparison.variants) {
      const measured = document.variants?.[variant];
      if (measured?.status !== "ok") continue;
      const row = rows.get(document.id);
      if (
        document.sourceSha256 !== row?.sourceSha256 ||
        measured.sourceSha256 !== row?.sourceSha256
      )
        errors.push(`${document.id}/${variant}: source identity mismatch`);
      if (
        !measured.buildSha256 ||
        measured.buildSha256 !== builds.builds[variant]?.buildSha256
      )
        errors.push(`${document.id}/${variant}: build identity mismatch`);
      if (
        !measured.referenceReceiptSha256 ||
        measured.referenceReceiptSha256 !== row?.wordReceiptSha256 ||
        !measured.referencePdfSha256 ||
        measured.referencePdfSha256 !== row?.wordPdfSha256
      )
        errors.push(`${document.id}/${variant}: Word snapshot mismatch`);
    }
  }
  return errors;
};
const visualSnapshots = [
  {
    dataPath: "visual/comparison.json",
    reportPath: "visual/report.html",
    scope: "primary",
  },
  {
    dataPath: "visual/final-precorrection-partial/comparison.json",
    reportPath: "visual/final-precorrection-partial/report.html",
    scope: "partial-precorrection",
  },
];
if (
  comparison.variants.every((variant) =>
    ["baseline", "migrated", "refined"].includes(variant)
  )
)
  visualSnapshots.unshift({
    dataPath: "visual/three-build-final-word-references/comparison.json",
    reportPath: "visual/three-build-final-word-references/report.html",
    scope: "primary",
  });
if (comparison.variants.includes("final")) visualSnapshots.reverse();
for (const snapshot of visualSnapshots) {
  try {
    const candidate = await readEvidenceJson(
      path.join(output, snapshot.dataPath)
    );
    const captureProfile = await readEvidenceJson(
      path.join(output, "capture-profile.json")
    );
    if (
      candidate?.upstreamCaptureProfileSha256 ===
        captureProfile?.captureProfileSha256 &&
      comparison.variants.every((variant) => candidate?.aggregate?.[variant])
    ) {
      const identities = await readEvidenceJson(
        path.join(output, "build-identities.json")
      );
      const errors = visualIdentityErrors(candidate, comparison, identities);
      if (errors.length) {
        visualValidation.rejectedSnapshots.push({ ...snapshot, errors });
        continue;
      }
      visual = candidate;
      visualSnapshot = snapshot;
      break;
    }
  } catch {}
}
let sourceIntegrity = null;
let visualFeatureSummary = null;
let visualReferenceCoverage = null;
if (visual) {
  try {
    const candidate = await readEvidenceJson(
      path.join(output, "visual/feature-summary.json")
    );
    const identities = await readEvidenceJson(
      path.join(output, "build-identities.json")
    );
    if (
      candidate?.comparisonSha256 === visual.artifactSha256 &&
      candidate?.buildIdentitiesSha256 === identities?.artifactSha256 &&
      comparison.variants.every(
        (variant) =>
          candidate.buildSha256ByVariant?.[variant] ===
          identities.builds[variant]?.buildSha256
      )
    )
      visualFeatureSummary = {
        generatedAt: candidate.generatedAt,
        sharedQualifiedDocuments: candidate.sharedQualifiedDocuments,
        allSelectedCaptureAttemptsTerminal:
          candidate.allSelectedCaptureAttemptsTerminal,
        groups: Object.keys(candidate.groups),
        artifactSha256: candidate.artifactSha256,
      };
  } catch {}
  try {
    const candidate = await readEvidenceJson(
      path.join(output, "visual/reference-coverage.json")
    );
    if (
      candidate?.comparisonSha256 === visual.artifactSha256 &&
      candidate?.upstreamCaptureProfileSha256 ===
        visual.upstreamCaptureProfileSha256 &&
      candidate?.wordReferenceManifestSha256 ===
        (await fileSha256(
          path.join(output, "word-reference-manifest-final.json")
        ))
    )
      visualReferenceCoverage = candidate;
  } catch {}
}
try {
  const candidate = await readEvidenceJson(
    path.join(output, "final-all-alias-integrity.json")
  );
  if (
    candidate?.inventorySha256 ===
    (await fileSha256(path.join(output, "inventory.json")))
  ) {
    const { records, ...summary } = candidate;
    sourceIntegrity = summary;
  }
} catch {}
let correctedValidation = null;
let environmentIntegrity = null;
try {
  const candidate = await readEvidenceJson(
    path.join(output, "word-environment-drift.json")
  );
  if (
    candidate?.profileUnchanged === true &&
    candidate.baselineEnvironmentSha256 === comparison.wordEnvironmentSha256 &&
    candidate.differences &&
    Object.keys(candidate.differences).length === 0 &&
    ["addedFonts", "removedFonts", "changedFonts"].every(
      (key) => Array.isArray(candidate[key]) && candidate[key].length === 0
    )
  )
    environmentIntegrity = {
      checkedAtUtc: candidate.checkedAtUtc,
      fontCount: candidate.current.fontCount,
      artifactSha256: candidate.artifactSha256,
    };
} catch {}
if (comparison.variants.includes("final-corrected")) {
  try {
    const candidate = await readEvidenceJson(
      path.join(output, "corrected-validation.json")
    );
    const identities = await readEvidenceJson(
      path.join(output, "build-identities.json")
    );
    if (
      candidate?.build?.buildSha256 ===
      identities?.builds?.["final-corrected"]?.buildSha256
    )
      correctedValidation = {
        buildSha256: candidate.build.buildSha256,
        validatedAt: candidate.validatedAt,
        artifactSha256: candidate.artifactSha256,
        checks: candidate.checks,
      };
  } catch {}
}
let rendererChanges = null;
try {
  rendererChanges = JSON.parse(
    await fs.readFile(path.join(output, changesName), "utf8")
  );
} catch {}
const compact = comparison.documents.map((document) => ({
  ...document,
  variants: Object.fromEntries(
    Object.entries(document.variants).map(([name, value]) => [
      name,
      Object.fromEntries(
        Object.entries(value).filter(
          ([key]) =>
            ![
              "perPage",
              "positionSamples",
              "pageBoundaries",
              "printedPageLabelCandidates",
              "pageSizeErrors",
            ].includes(key)
        )
      ),
    ])
  ),
}));
const data = JSON.stringify({
  ...comparison,
  visual,
  visualSnapshot,
  visualValidation,
  visualFeatureSummary,
  visualReferenceCoverage,
  sourceIntegrity,
  correctedValidation,
  environmentIntegrity,
  pageFields,
  pageFieldsValidation,
  documents: compact,
  rendererChanges: rendererChanges && {
    ...rendererChanges,
    changes: rendererChanges.changes.map(
      ({ positionSamples, ...rest }) => rest
    ),
  },
}).replace(/</g, "\\u003c");
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Word corpus parity</title><style>
:root{font-family:system-ui,sans-serif;color:#182638;background:#f4f6f9;font-size:14px}*{box-sizing:border-box}body{margin:0}main{max-width:1500px;margin:auto;padding:32px}h1{font-size:30px;letter-spacing:-.025em;margin:0 0 8px}h2{font-size:18px;margin:0 0 16px}p{line-height:1.55;margin:8px 0}a{color:#155baf}header{margin-bottom:26px}.muted{color:#5b6b7c}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:22px 0}.card,section{background:white;border:1px solid #dbe2eb;border-radius:10px;padding:20px}.card b{display:block;font-size:28px;margin:6px 0}.card span{color:#5b6b7c}section{margin:18px 0}.controls{display:flex;gap:14px;flex-wrap:wrap;align-items:end;margin:14px 0}label{display:flex;flex-direction:column;gap:6px;font-weight:600}select,input{font:inherit;border:1px solid #b7c3d1;border-radius:5px;padding:8px;color:inherit;background:white}input[type=search]{min-width:300px}button{font:inherit;border:1px solid #b7c3d1;background:white;border-radius:5px;padding:7px 12px;cursor:pointer}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{text-align:left;padding:10px;border-bottom:1px solid #e8edf3;font-size:12px;vertical-align:top}th{position:sticky;top:0;background:#f8fafc;font-weight:650}td.number,th.number{text-align:right;white-space:nowrap}td.name{max-width:310px;overflow-wrap:anywhere}.scroll{max-height:650px;overflow:auto}.positive{color:#087443}.negative{color:#af2535}.tag{font-size:11px;border-radius:4px;background:#eaf0f8;padding:3px 6px}.chart{width:100%;height:380px;border:1px solid #edf0f5;border-radius:6px}.legend{display:flex;gap:18px;font-size:12px;margin:8px 0}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px}details{margin:14px 0}pre{white-space:pre-wrap;font-size:12px}#detail{max-height:500px;overflow:auto}svg text{font:11px system-ui;fill:#5b6b7c}@media(max-width:800px){main{padding:16px}.cards{grid-template-columns:repeat(2,1fr)}th,td{padding:7px}}
</style><main><header><p class="muted">LOCAL CORPUS · WORD NATIVE PDF REFERENCE</p><h1>Word layout parity</h1><p>Frozen baseline and Pretext 1.0.0, compared against the same source bytes and physical Word pages.</p><p id="stamp" class="muted"></p><p><a href="${resultName}">Full comparison data</a> · <a href="inventory-report.md">Inventory and scan coverage</a> · <a href="${changesName}">Renderer changes</a> · <a href="build-identities.json">Frozen build identities</a></p></header><div id="cards" class="cards"></div><section><h2>Paired comparison</h2><p class="muted">Both renderers must complete and share a qualified Word reference. Page counts and breaks use physical page ordinals. Printed PAGE/NUMPAGES labels are scored separately only when a source-grounded audit qualifies the occurrence; ordinary numeric footer candidates remain unqualified. Missing or unaligned reference text stays in every recall denominator. Zero native text is unmeasured for text layout. Word-repaired references and changed-text pairs with unresolved alignment are excluded from headline fidelity comparisons; coverage and lower bounds remain in the data.</p><div id="aggregate"></div></section><section><h2>Printed page labels</h2><div id="page-fields"></div></section><section><h2>Physical page visual comparison</h2><div id="visual"></div></section><section><h2>Fidelity and latency</h2><div class="controls"><label>Horizontal axis<select id="x"><option value="readyMs">Ready latency (ms)</option><option value="referencePageCount">Word physical pages</option><option value="expectedCharacters">Word native characters</option><option value="byteSize">Source size (bytes)</option><option value="imageCount">Rendered images</option><option value="sourceCharacters">Source characters</option><option value="sourceParagraphs">Source paragraphs</option><option value="sourceTables">Source tables</option><option value="sourceSections">Source sections</option></select></label><label>Vertical axis<select id="y"><option value="fullyVisiblePageMembershipRecall">Visible text on correct page</option><option value="lineBreakRecall">Line break recall</option><option value="fullyVisibleTextRecall">Visible native text recall (lower bound)</option><option value="positionWithin2PtRecall">Position within 2 pt / all text</option><option value="wordPositionCoverage">Position measurement coverage</option><option value="readyMs">Ready latency (ms)</option></select></label><label>Build<select id="variant"><option value="migrated">Pretext 1.0.0</option><option value="baseline">Baseline</option></select></label><label>Horizontal scale<select id="scale"><option value="log">Logarithmic</option><option value="linear">Linear</option></select></label></div><svg id="chart" class="chart" viewBox="0 0 1200 380" role="img" aria-label="Corpus fidelity and latency scatter plot"></svg><div class="legend"><span><i class="dot" style="background:#2774b9"></i>DOCX</span><span><i class="dot" style="background:#a66b20"></i>Binary DOC</span><span id="plotcount" class="muted"></span></div><p class="muted">Each dot is one measured document. Position residuals compare PDF glyph boxes with DOM inline boxes and are comparative proxies. Ready latency includes font/image loading and the stable-layout guard. Runs used recorded worker schedules and shared resources, including overlapping geometry and visual captures. These are observed pipeline timings, not controlled dependency speed benchmarks.</p></section><section><h2>Coverage by document feature</h2><div id="features"></div></section><section><h2>Document results</h2><div class="controls"><label>Find document<input id="search" type="search" placeholder="Name, hash or path"></label><label>Show<select id="filter"><option value="all">All inventoried documents</option><option value="paired">Word and both renderers available</option><option value="changed">Renderer changed</option><option value="userdocs">User documents</option><option value="generated">Prior generated artifacts</option><option value="regressed">Measured text/page regression</option><option value="failed">Failures or unavailable</option><option value="repaired">Word repaired reference</option><option value="pagefields">Source page number fields</option><option value="unresolved">Alignment unresolved</option><option value="doc">Binary DOC</option><option value="docx">DOCX</option></select></label><label>Sort<select id="sort"><option value="recall">Lowest page membership</option><option value="delta">Largest page-membership regression</option><option value="latency">Slowest renderer</option><option value="name">Source name</option></select></label><button id="refresh">Refresh report</button></div><p id="count" class="muted"></p><div class="scroll"><table><thead><tr><th>Document</th><th>Status</th><th class="number">Pages<br>Word / old / new</th><th class="number">Visible text<br>old → new</th><th class="number">Correct page<br>old → new</th><th class="number">Line breaks<br>old → new</th><th class="number">Printed labels<br>matching / qualified</th><th class="number">Position coverage<br>new</th><th class="number">Ready ms<br>old → new</th></tr></thead><tbody id="rows"></tbody></table></div><details><summary>Selected document details</summary><pre id="detail">Select a document row.</pre></details></section><section><h2>Measurement limits</h2><div id="methods"></div></section></main><script>const data=${data};
const $=id=>document.getElementById(id),escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),pct=value=>Number.isFinite(value)?(value*100).toFixed(1)+'%':'—',num=value=>Number.isFinite(value)?Math.round(value).toLocaleString():'—';
const beforeName=data.variants[0],afterName=data.variants[1];
const paired=data.documents.filter(d=>!d.wordRepairsObserved&&d.variants[beforeName]?.status==='ok'&&d.variants[afterName]?.status==='ok'),changed=new Set(data.rendererChanges?.changes.filter(d=>d.score>0).map(d=>d.id));
$('stamp').textContent=beforeName+' → '+afterName+'. Updated '+new Date(data.generatedAt).toLocaleString()+'. '+data.eligibleDocuments.toLocaleString()+' eligible unique sources; '+data.corpusDocuments.toLocaleString()+' inventoried unique files. Renderer-change manifest updated '+(data.rendererChanges?.generatedAt??'not yet available')+'.';
if(data.sourceIntegrity)$('stamp').insertAdjacentHTML('afterend','<p class="muted"><a href="final-all-alias-integrity.json">Original-source integrity audit</a>: '+num(data.sourceIntegrity.unchangedPaths)+' / '+num(data.sourceIntegrity.checkedPaths)+' paths unchanged across '+num(data.sourceIntegrity.uniqueDocuments)+' unique documents; '+num(data.sourceIntegrity.unstableReads)+' unstable reads. Verified '+escape(data.sourceIntegrity.verifiedAtUtc)+'.</p>');
if(data.environmentIntegrity)$('stamp').insertAdjacentHTML('afterend','<p class="muted"><a href="word-environment-drift.json">Word environment integrity</a>: capture profile and '+num(data.environmentIntegrity.fontCount)+' font files remain unchanged. Verified '+escape(data.environmentIntegrity.checkedAtUtc)+'.</p>');
if(data.correctedValidation)$('stamp').insertAdjacentHTML('afterend','<p class="muted"><a href="corrected-validation.json">Corrected build validation</a>: existing unit, Word-oracle, browser, type and build checks; separate actual-build controls. Full corpus coverage is reported below.</p>');
$('variant').innerHTML='<option value="'+escape(afterName)+'">'+escape(afterName)+'</option><option value="'+escape(beforeName)+'">'+escape(beforeName)+'</option>';
const agg=data.aggregate[afterName],base=data.aggregate[beforeName],rendererDone=data.documents.filter(d=>['ok','reference-unavailable','capture-failed'].includes(d.variants[beforeName]?.status)&&['ok','reference-unavailable','capture-failed'].includes(d.variants[afterName]?.status)).length;
$('cards').innerHTML=[['Renderer pairs',num(rendererDone)+' / '+num(data.eligibleDocuments),'Completed or explicitly failed'],['Word-qualified pairs',num(data.pairedDocuments),'Shared comparison denominator'],['Native text page parity',num(agg.qualifiedPageParity),'Same pages, dimensions and visible text'],['Migration changes',num(changed.size),'Renderer differences awaiting Word attribution']].map(([label,value,note])=>'<div class="card">'+label+'<b>'+value+'</b><span>'+note+'</span></div>').join('');
const metrics=[['Available Word reference pages','referenceAvailablePages',num],['Word pages in paired comparison','pairedReferencePages',num],['Word pages whose renderer failed','rendererFailedReferencePages',num],['Raw physical page count equal','exactPageCount',num],['Qualified native text page parity','qualifiedPageParity',num],['Visible native text recall (lower bound)','fullyVisibleTextRecall',pct],['Visible text on correct physical page — character weighted','fullyVisiblePageMembershipRecall',pct],['Visible text on correct physical page — mean per document','fullyVisiblePageMembershipRecallMacro',pct],['Line break recall — break weighted','lineBreakRecall',pct],['Line break recall — mean per document','lineBreakRecallMacro',pct],['Position measurement coverage','wordPositionCoverage',pct],['Median ready latency (ms)','readyMsMedian',num],['95th percentile ready latency (ms)','readyMsP95',num]];
$('aggregate').innerHTML='<p class="muted">Fidelity comparison cohort: '+num(agg.fidelityComparableDocuments)+' paired documents; '+num(agg.unresolvedAlignmentDocuments)+' have partial alignment. Reference characters unresolved by alignment: '+num(base.unresolvedCharacters)+' / '+num(agg.unresolvedCharacters)+' (before / after). All recall values are conservative lower bounds.</p><table><thead><tr><th>Metric</th><th class="number">'+escape(beforeName)+'</th><th class="number">'+escape(afterName)+'</th></tr></thead><tbody>'+metrics.map(([label,key,format])=>'<tr><td>'+label+'</td><td class="number">'+format(base[key])+'</td><td class="number">'+format(agg[key])+'</td></tr>').join('')+'</tbody></table>';
const fidelityPaired=paired.filter(d=>d.deltaQualification==='same-alignment-coverage');
const fieldById=new Map((data.pageFields?.documents??[]).map(d=>[d.id,d]));
const fieldPairs=[];for(const d of data.pageFields?.documents??[]){const before=d.variants[beforeName],after=d.variants[afterName];if(!before||!after)continue;const matched=new Map((after.observations??[]).filter(o=>o.status==="qualified"&&o.referenceQualification==="fresh-word-reference").map(o=>[o.templateId+":"+o.physicalPageIndex0,o]));for(const a of before.observations??[]){const b=matched.get(a.templateId+":"+a.physicalPageIndex0);if(a.status==="qualified"&&a.referenceQualification==="fresh-word-reference"&&b&&JSON.stringify(a.wordValues)===JSON.stringify(b.wordValues))fieldPairs.push({id:d.id,before:a,after:b});}}
const fieldDocuments=new Set(fieldPairs.map(o=>o.id));
const fieldMatchRateMacro=(side)=>{const rates=[...fieldDocuments].map(id=>{const rows=fieldPairs.filter(o=>o.id===id);return rows.filter(o=>o[side].valuesMatch).length/rows.length});return rates.length?rates.reduce((a,b)=>a+b,0)/rates.length:null};
$("page-fields").innerHTML=data.pageFields?'<p>'+num(data.pageFields.sourcePageOrNumpagesDocumentCount)+' sources contain PAGE/NUMPAGES fields; '+num(data.pageFields.sourceCandidateDocumentCount)+' have eligible static source anchors. This comparison currently qualifies '+num(fieldPairs.length)+' shared occurrences in '+num(fieldDocuments.size)+' documents. Updated '+escape(data.pageFields.generatedAtUtc)+'. <a href="page-number-field-audit.json">Source and value evidence</a></p><table><thead><tr><th>Qualified printed occurrences</th><th class="number">'+escape(beforeName)+'</th><th class="number">'+escape(afterName)+'</th></tr></thead><tbody><tr><td>Values match Word</td><td class="number">'+num(fieldPairs.filter(o=>o.before.valuesMatch).length)+'</td><td class="number">'+num(fieldPairs.filter(o=>o.after.valuesMatch).length)+'</td></tr><tr><td>Values missing or differ</td><td class="number">'+num(fieldPairs.filter(o=>!o.before.valuesMatch).length)+'</td><td class="number">'+num(fieldPairs.filter(o=>!o.after.valuesMatch).length)+'</td></tr><tr><td>Matching rate — mean per document</td><td class="number">'+pct(fieldMatchRateMacro('before'))+'</td><td class="number">'+pct(fieldMatchRateMacro('after'))+'</td></tr></tbody></table><p class="muted">Physical page index and displayed field value are independent. Qualification requires source templates and unique unclipped matches; numeric-only footers remain ambiguous. Word-repaired references stay conditional.</p>':'<p class="muted">Source-grounded printed-label qualification is pending for this capture profile. Physical page counts do not establish label parity.</p>';
if(data.pageFieldsValidation.globalErrors.length||data.pageFieldsValidation.rejectedVariants.length)$('page-fields').innerHTML+='<p class="muted">Evidence identity checks withheld '+num(data.pageFieldsValidation.rejectedVariants.length)+' stale or unqualified variant records. '+escape(data.pageFieldsValidation.globalErrors.join('; '))+'</p>';
const visualMetrics=[['Edge overlap','edgeIoU'],['Edge recall within3pt','edgeRecallWithin3Pt'],['Edge precision within3pt','edgePrecisionWithin3Pt'],['Ink overlap','inkIoU'],['Ink recall within3pt','inkRecallWithin3Pt']];
$('visual').innerHTML=data.visual&&data.visual.aggregate[beforeName]&&data.visual.aggregate[afterName]?'<p>'+(data.visualSnapshot?.scope==='partial-precorrection'?'Partial pre-correction diagnostic. ':'')+num(data.visual.pairedDocuments)+' documents in the shared visual cohort ('+escape(Object.keys(data.visual.aggregate).join(', '))+'); '+num(data.visual.aggregate[afterName]?.pagePairCount)+' ordinal comparison canvases. Updated '+escape(data.visual.generatedAt)+'. <a href="'+escape(data.visualSnapshot?.reportPath??'visual/report.html')+'">Open page image inspector</a></p><table><thead><tr><th>Low-resolution diagnostic</th><th class="number">'+escape(beforeName)+'</th><th class="number">'+escape(afterName)+'</th></tr></thead><tbody>'+visualMetrics.map(([label,key])=>'<tr><td>'+label+'</td><td class="number">'+pct(data.visual.aggregate[beforeName]?.[key])+'</td><td class="number">'+pct(data.visual.aggregate[afterName]?.[key])+'</td></tr>').join('')+'</tbody></table><p class="muted">Physical page coordinates remain fixed. These48DPI ink/edge diagnostics cover image-only pages but do not establish pixel parity. Missing pages and unloaded content remain in denominators.</p>':'<p class="muted">Visual metrics are unavailable for this selected build pair. <a href="visual/report.html">Current image inspector</a> · <a href="visual/final-precorrection-partial/report.html">Partial pre-correction diagnostic</a>. Native-text-empty pages receive no text layout pass.</p>';
if(data.visualReferenceCoverage){const coverage=data.visualReferenceCoverage,latest=coverage.variants[afterName];$('visual').insertAdjacentHTML('beforeend','<p class="muted"><a href="visual/reference-coverage.json">Actual Word page coverage</a>: the shared visual cohort covers '+num(coverage.sharedQualifiedWordPhysicalPages)+' of '+num(coverage.primaryQualifiedReferencePhysicalPages)+' primary Word pages. '+(latest?escape(afterName)+' independently covers '+num(latest.pairedDocuments)+' references / '+num(latest.pairedWordPhysicalPages)+' Word pages; renderer failures retain '+num(latest.unpairedByReason['capture-error']?.wordPhysicalPages??0)+' Word pages in the coverage denominator. ':'')+'Ordinal comparison canvases can include extra renderer pages.</p>');}
if(data.visualFeatureSummary)$('visual').insertAdjacentHTML('beforeend','<p class="muted"><a href="visual/feature-summary.json">Visual feature coverage</a>: '+num(data.visualFeatureSummary.groups.length)+' overlapping groups on '+num(data.visualFeatureSummary.sharedQualifiedDocuments)+' shared qualified documents, with document, page and pixel weighting reported separately.</p>');
const featureGroups=[['User documents',d=>d.group==='user-document'],['Prior generated artifacts',d=>d.group==='prior-generated-artifact'],['Repository fixtures',d=>d.group==='repository-fixture'],['DOCX',d=>d.format==='docx'],['Binary DOC',d=>d.format==='doc'],['Tables',d=>d.sourceFeatures?.tables>0],['Nested tables',d=>d.sourceFeatures?.nestedTables>0],['Multiple columns',d=>d.sourceFeatures?.multiColumnSections>0],['Floating drawings / shapes',d=>(d.sourceFeatures?.floatingDrawings??0)+(d.sourceFeatures?.legacyPositionedShapes??0)>0],['Text boxes',d=>d.sourceFeatures?.textBoxes>0],['Footnotes',d=>d.sourceFeatures?.footnoteReferences>0],['Endnotes',d=>d.sourceFeatures?.endnoteReferences>0],['Page number fields',d=>d.sourceFeatures?.pageNumberFields>0],['Direct keep-with-next enabled',d=>d.sourceFeatures?.directKeepNextEnabled>0],['CJK text',d=>d.sourceFeatures?.cjkCharacters>0],['Bidi script text',d=>d.sourceFeatures?.bidiScriptCharacters>0],['Migration changed',d=>changed.has(d.id)]];
const median=values=>values.length?values.sort((a,b)=>a-b)[Math.floor((values.length-1)/2)]:null;
$('features').innerHTML='<p class="muted">Source feature inspection available for '+num(data.documents.filter(d=>d.sourceFeatureStatus==='ok').length)+' documents; unavailable for '+num(data.documents.filter(d=>d.sourceFeatureStatus!=='ok').length)+'. Counts reflect declared source structure; direct settings do not resolve style inheritance.</p><table><thead><tr><th>Feature</th><th class="number">Inventoried present</th><th class="number">Qualified fidelity pairs</th><th class="number">Visible page recall<br>(lower bound)</th><th class="number">Median ready ms</th></tr></thead><tbody>'+featureGroups.map(([label,predicate])=>{const total=data.documents.filter(predicate),rows=fidelityPaired.filter(predicate),expected=rows.reduce((s,d)=>s+d.variants[afterName].expectedCharacters,0),correct=rows.reduce((s,d)=>s+d.variants[afterName].fullyVisibleCorrectPageCharacters,0),times=total.map(d=>d.variants[afterName]?.readyMs).filter(Number.isFinite);return '<tr><td>'+label+'</td><td class="number">'+num(total.length)+'</td><td class="number">'+num(rows.length)+'</td><td class="number">'+pct(expected?correct/expected:null)+'</td><td class="number">'+num(median(times))+'</td></tr>'}).join('')+'</tbody></table>';
function renderChart(){const variant=$('variant').value,xKey=$('x').value,yKey=$('y').value,log=$('scale').value==='log',points=(yKey==='readyMs'?data.documents.filter(d=>Number.isFinite(d.variants[variant]?.readyMs)):fidelityPaired).map(d=>({d,x:xKey==='byteSize'?d.byteSize:xKey==='sourceCharacters'?d.complexity?.characters:xKey==='sourceParagraphs'?d.complexity?.paragraphs:xKey==='sourceTables'?d.complexity?.tables:xKey==='sourceSections'?d.complexity?.sections:d.variants[variant][xKey],y:d.variants[variant][yKey]})).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&(!log||p.x>0)),transform=x=>log?Math.log10(x):x;let xs=points.map(p=>transform(p.x)),ys=points.map(p=>p.y),minX=Math.min(0,...xs),maxX=Math.max(1,...xs),minY=Math.min(0,...ys),maxY=Math.max(yKey==='readyMs'?1:1,...ys);if(log&&points.length)minX=Math.min(...xs);const xx=x=>70+(transform(x)-minX)/(maxX-minX||1)*1090,yy=y=>330-(y-minY)/(maxY-minY||1)*290;let svg='<path d="M70 30V330H1160" fill="none" stroke="#b6c1cd"/>';for(let i=0;i<=4;i++){const y=minY+(maxY-minY)*i/4,Y=yy(y),x=minX+(maxX-minX)*i/4,X=70+1090*i/4;svg+='<line x1="70" x2="1160" y1="'+Y+'" y2="'+Y+'" stroke="#edf0f4"/><text x="60" y="'+(Y+4)+'" text-anchor="end">'+(yKey==='readyMs'?num(y):pct(y))+'</text><text x="'+X+'" y="352" text-anchor="middle">'+num(log?10**x:x)+'</text>'}svg+=points.map(p=>'<circle cx="'+xx(p.x)+'" cy="'+yy(p.y)+'" r="4" fill="'+(p.d.format==='doc'?'#a66b20':'#2774b9')+'" fill-opacity=".65"><title>'+escape(p.d.sourcePath)+'\\n'+escape(xKey)+': '+num(p.x)+'\\n'+escape(yKey)+': '+(yKey==='readyMs'?num(p.y):pct(p.y))+'</title></circle>').join('');$('chart').innerHTML=svg;$('plotcount').textContent=points.length+' documents with both selected measurements';}
function renderRows(){const query=$('search').value.toLowerCase(),filter=$('filter').value;let rows=data.documents.filter(d=>(d.sourcePath+' '+d.id).toLowerCase().includes(query));if(filter==='paired')rows=rows.filter(d=>d.delta&&!d.wordRepairsObserved);if(filter==='repaired')rows=rows.filter(d=>d.wordRepairsObserved);if(filter==='pagefields')rows=rows.filter(d=>d.sourceFeatures?.pageNumberFields>0);if(filter==='unresolved')rows=rows.filter(d=>d.deltaQualification==='unresolved-alignment');if(filter==='changed')rows=rows.filter(d=>changed.has(d.id));if(filter==='userdocs')rows=rows.filter(d=>d.group==='user-document');if(filter==='generated')rows=rows.filter(d=>d.group==='prior-generated-artifact');if(filter==='regressed')rows=rows.filter(d=>(d.delta?.fullyVisiblePageMembershipRecall??0)<-0.000001||(d.delta?.fullyVisibleTextRecall??0)<-0.000001);if(filter==='failed')rows=rows.filter(d=>!d.delta);if(filter==='doc'||filter==='docx')rows=rows.filter(d=>d.format===filter);const key=$('sort').value;rows.sort((a,b)=>key==='name'?a.sourcePath.localeCompare(b.sourcePath):key==='latency'?(b.variants[afterName]?.readyMs??-1)-(a.variants[afterName]?.readyMs??-1):key==='delta'?(a.delta?.fullyVisiblePageMembershipRecall??2)-(b.delta?.fullyVisiblePageMembershipRecall??2):(a.variants[afterName]?.fullyVisiblePageMembershipRecall??2)-(b.variants[afterName]?.fullyVisiblePageMembershipRecall??2));$('count').textContent=rows.length+' matching documents. All failures and pending captures remain in inventory coverage.';$('rows').innerHTML=rows.map(d=>{const a=d.variants[beforeName]??{},b=d.variants[afterName]??{},status=d.eligible?(d.wordRepairsObserved?'Word repaired · conditional':d.deltaQualification==='unresolved-alignment'?'Alignment unresolved · lower bound':(a.unresolvedCharacters>0||b.unresolvedCharacters>0)?'Partial alignment · lower bound':d.delta?'Measured':a.status+' / '+b.status):d.classificationReason;return '<tr data-id="'+escape(d.id)+'"><td class="name"><b>'+escape(d.sourcePath.split('/').at(-1))+'</b><br><span class="muted">'+escape(d.id)+'</span> <span class="tag">'+escape(d.format)+'</span><br><span class="muted">'+escape(d.group)+'</span></td><td>'+escape(status)+(changed.has(d.id)?'<br><span class="tag">renderer changed</span>':'')+'</td><td class="number">'+num(b.referencePageCount??d.referencePageCount)+' / '+num(a.rendererPageCount)+' / '+num(b.rendererPageCount)+'</td><td class="number">'+pct(a.fullyVisibleTextRecall)+' → '+pct(b.fullyVisibleTextRecall)+'</td><td class="number">'+pct(a.fullyVisiblePageMembershipRecall)+' → '+pct(b.fullyVisiblePageMembershipRecall)+'</td><td class="number">'+pct(a.lineBreakRecall)+' → '+pct(b.lineBreakRecall)+'</td><td class="number">'+(fieldPairs.some(o=>o.id===d.id)?num(fieldPairs.filter(o=>o.id===d.id&&o.after.valuesMatch).length)+' / '+num(fieldPairs.filter(o=>o.id===d.id).length):'—')+'</td><td class="number">'+pct(b.wordPositionCoverage)+'</td><td class="number">'+num(a.readyMs)+' → '+num(b.readyMs)+'</td></tr>'}).join('');}
$('methods').innerHTML='<p><b>Text normalization.</b> '+escape(data.methods.normalization)+'</p><p><b>Alignment.</b> '+escape(data.methods.alignment)+'</p><p><b>Geometry.</b> '+escape(data.methods.geometry)+'</p><ul>'+data.methods.limitations.map(item=>'<li>'+escape(item)+'</li>').join('')+'</ul>';
for(const id of ['x','y','variant','scale'])$(id).addEventListener('change',renderChart);for(const id of ['search','filter','sort'])$(id).addEventListener(id==='search'?'input':'change',renderRows);$('refresh').onclick=()=>location.reload();$('rows').onclick=event=>{const row=event.target.closest('tr[data-id]');if(!row)return;$('detail').textContent=JSON.stringify({...data.documents.find(d=>d.id===row.dataset.id),printedLabelAudit:fieldById.get(row.dataset.id),rendererSourceIdentity:data.rendererChanges?.sourceIdentityDiagnostics?.find(d=>d.id===row.dataset.id)},null,2);$('detail').parentElement.open=true};renderChart();renderRows();
</script></html>`;
await fs.writeFile(path.join(output, reportName + ".tmp"), html);
await fs.rename(
  path.join(output, reportName + ".tmp"),
  path.join(output, reportName)
);
console.log(path.join(output, reportName));
