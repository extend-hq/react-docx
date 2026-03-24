# Editor Architecture (Model-First)

## Problem

The editor currently mixes:

- DOM-driven transient draft state
- model mutations
- selection/range state
- history snapshots

across many independent React states. That creates invalid state windows where:

- selection/range points to removed nodes
- stale draft rehydration rewrites DOM and moves caret
- multi-step commands produce fragmented undo behavior

## Target Architecture

Move toward a ProseMirror-style state machine:

- single canonical editor state
  - `model`
  - `selection`
  - `activeTextRange`
  - `pendingRunStyle`
  - `history` (past/future)
- command dispatch API
  - input: command + payload
  - output: deterministic transaction result
- strict post-transaction invariant pass
  - selection/range always valid for current model
  - invalid locations auto-remapped to nearest legal paragraph/cell

## Implemented Foundation

1. Model-aware cursor invariants:
   - normalize paragraph locations against current model
   - normalize text ranges (location + offsets) against current model
   - normalize selection against current model
2. Automatic invariant enforcement after model changes.
3. Auto-clear invalid selected form field locations.
4. DOM draft rehydrate safeguards (stale-write guards + selection restore) to prevent caret jumps.

## Next Steps

1. Replace `applyModelChange` with explicit transaction dispatcher:
   - `{ modelPatch, selectionPatch, rangePatch, pendingStylePatch, historyMeta }`
2. Collapse model/history/selection/range into one reducer state for atomic commits.
3. Route all editing commands through transactions (`replace`, `delete`, `split`, `list`, `table`).
4. Add command-level regression tests:
   - cross-node delete/replace
   - mixed table + paragraph selection
   - list depth/tab/backspace behavior
   - undo cursor restoration invariants

