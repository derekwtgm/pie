# Labeled screenshot validation — 0.9.0

Use **Image validation** to measure your saved fixed-layout card/amount calibration
on images whose expected labels you supply. It reads selected local screenshots;
it does not capture a client or send results to an observation tracker or solver.

## Try the pipeline

Choose **Load synthetic validation demo**, then **Run validation**. This demo has
deliberately incorrect and negative examples. Its result is not a client-recognition
benchmark. Six exact PNG fixtures, their manifest and reference calibration are in
`examples/image-validation`.

To exercise the files separately, open `calibration.json` in **Image calibration**.
Then open `manifest.json` in **Image validation**, select all six PNG files and run.
Manual files use the current Image calibration; the built-in demo uses its own
isolated reference samples and does not replace the current calibration.

## Label your own images

1. Create or load regions and labeled references in **Image calibration**.
2. Open **Image validation**, select PNG/JPEG files and expand **Create or edit
   expected labels**.
3. Choose **Create labeled dataset**. Select the image, table and calibrated field.
4. **Show selected image** previews the local file for your visual review.
5. Choose **Known label** and enter its exact card/amount label, or explicitly
   choose **Must reject** for an unreadable/unsupported negative example.
6. Choose **Add / update expected field**. Repeat for the desired image/table/field
   combinations. Removing a label leaves that field outside evaluation; it does
   not assert that the reader should reject it.
7. Export expected labels and keep your original files. Run validation and export
   its report. Export Image calibration separately if needed.

Only saved labels participate in a run. Form edits take effect when you choose
**Add / update expected field**. Empty drafts cannot run or export. Labels and
images are not saved by observation or simulation recovery. Export before closing.
Whole-workspace backup in 0.10 can also keep labels/reports/calibration together and
embed selected originals in a manual file. Automatic whole-workspace recovery keeps
image references only.

File selection and a manual manifest use current Image calibration, which may be
different from a synthetic demo's isolated calibration.

Use evaluation images separate from the reference screenshots. Include genuinely
unreadable cases, animations, scaling/layout differences and labels absent from
the reference set, while describing their ground truth honestly. A manifest's
source value is a declaration, not authentication or proof of independent sampling.

## Manifest

The top-level object accepts exactly `format`, `version`, `source`, `name`, `cases`.
Each case accepts exactly `id`, `image`, `table`, `fields`. Each expected field
accepts exactly `field`, `kind`, `expected`.

```json
{
  "format": "eightmax-image-dataset",
  "version": 1,
  "source": "recorded-screenshot",
  "name": "My labeled screenshots",
  "cases": [
    {
      "id": "case-1",
      "image": "Screenshot (1).png",
      "table": 1,
      "fields": [
        {"field": "hero_1", "kind": "card", "expected": "As"},
        {"field": "pot", "kind": "amount", "expected": "100"},
        {"field": "board_1", "kind": "card", "expected": null}
      ]
    }
  ]
}
```

Source is `synthetic` or `recorded-screenshot`. Names have 1–80 characters. Case
identities are unique ASCII letters/digits/underscore/hyphen, 1–64 characters.
Tables are 1–10. Image names must match selected files exactly, including case;
paths, URL syntax, parent traversal and Windows-forbidden filename characters
are refused. Case-insensitive duplicate selected filenames or image/table cases
are refused to avoid ambiguous binding. Multiple tables may refer to one image.

Field names use the existing lowercase calibration syntax. Kinds are `card` or
`amount` and must stay consistent for a table/field across the dataset. Expected
cards use `As`, `Td`, etc.; duplicate known visible cards in one case are refused.
Amounts are plain strings with 1–6 digits and at most two decimal places. Exact
spelling matters: `100`, `0100` and `100.00` are different labels. There is no
numeric-unit inference, decimal correction or general digit OCR.

`expected:null` explicitly means the field must not produce an accepted label.
Omitted fields are ungraded. Every calibrated region on that table still enters
the reader's ordinary layout and duplicate-card checks, even if not all regions
have labels in the manifest.

## Outcomes and metrics

| Outcome | Meaning |
| --- | --- |
| `correct-match` | Accepted label exactly equals supplied known truth |
| `wrong-match` | Accepted label differs from known truth, or expected truth is null |
| `rejected` with known truth | Reader abstained; known-field coverage decreases |
| `rejected` with null truth | Correct negative rejection |
| `unscored` | Missing file/region, incompatible field type or image decode failure |

| Metric | Definition |
| --- | --- |
| Accepted accuracy | Correct accepted labels / all accepted labels, including wrong negative accepts |
| Known-field coverage | Accepted known labels, right or wrong / all known expected fields, including unscored fields |
| Known correct rate | Correct accepted known labels / all known expected fields |
| False-acceptance rate | Accepted null-expected fields / scored null-expected fields |

Unavailable denominators are null in JSON and shown as **Unavailable**. Missing
evidence does not become a successful rejection. The complete flag requires no
unscored fields; it does not mean the reader was correct or safe. Reports expose
per-table/per-field counts, wrong-label confusion counts and individual outcomes.
Similarity scores and different-label margins remain fixed heuristics from the
existing matcher (0.92 / 0.04), not calibrated probabilities.

An exact normalized crop equal to any reference sample of the same kind is marked
`exactReferenceOverlap:true`. The main metrics retain it; a separate summary uses
only scored fields with no exact overlap. This comparison cannot detect all
duplicates, related sessions, transformation leakage or incorrect labels. Its
absence does not prove an independent held-out test set. Inspect the main counts
so that wrong accepts are not hidden by the overlap subset.

## Synthetic expected result

| Quantity | Fixture result |
| --- | --- |
| Fields scored | 12 |
| Correct accepted / all accepted | 6 / 10 (60%) |
| Wrong-label matches / negative false accepts | 2 / 2 |
| Correct negative rejections | 2 |
| Exact reference crop overlaps | 2 |
| Accepted accuracy without exact overlap | 50% |

These are intentionally constructed pipeline outcomes. Some pattern images have
the same content but different expected labels to exercise error reporting; this
is not an independently sampled recognition dataset or a client-card model.

## Processing, limits and exports

The evaluator snapshots labels and calibration before running. It decodes one
image at a time and reuses that image for all labeled tables in it. Missing or
broken files do not prevent other files from being scored. Changes to calibration,
labels or selected files invalidate old scores. Late imports/runs cannot replace
newer input/results. Stop and global Emergency stop/Escape discard incomplete
reports. A decoder already in flight may finish; its bitmap is closed and cancelled
results are ignored. Starting validation clears the manual image preview.

The simulator is paused and portable studies cancelled during validation. New
simulation/study/capacity starts are blocked until completion or cancellation.
Separate native jobs and other applications are outside browser control.

| Input | Bound |
| --- | --- |
| Manifest | 4 MB UTF-8, 1–200 cases, up to 2,000 expected fields |
| Case | 1–32 expected fields |
| Selected images | Up to 100 PNG/JPEG files, 100 MB total |
| Individual image | 10 MB, up to 20 MP after decoding |

Decoded-size checking happens after bitmap decoding. These are file/count bounds,
not a measured peak-memory cap, target-PC speed result or localStorage quota.

Report format is `eightmax-image-validation`, version 1. It includes label/score
outcomes and metrics, but no screenshot or reference-template pixels. Reports
always retain `decisionReady:false` and `recognitionValidatedForLiveUse:false`.
They are not observation sequences, solver policies or resumable checkpoints.
Ground-truth labels, calibration and original images remain separate files.

Tests here use synthetic pixels, Pillow-decoded PNG fixtures and an in-memory DOM
with mocked browser bitmap/canvas behavior. Actual browser rendering/decoding,
dialogs/downloads and Windows launch remain unverified. No real KKPoker dataset,
live recognition accuracy, scaling reliability or ten-table processing rate was
established by this release.
