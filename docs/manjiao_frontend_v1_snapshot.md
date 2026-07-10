# Manjiao Frontend V1 Snapshot

Date: 2026-07-07

This is the visual/function baseline the user said is currently acceptable and should be recoverable if later V2 iterations regress.

## V1 Baseline Scope

- Main project production workbench route: `apps/web/src/pages/ProjectWorkbenchPage.tsx`
- Global styling and workbench theme rules: `apps/web/src/styles.css`
- Core flow:
  - Script parsing and scene split workbench.
  - Character and scene asset locking workbench.
  - Design desk / storyboard matrix.
  - Single-shot director workbench.
  - Video loop/export workbench.
- Important UX qualities to preserve:
  - Dense production-console feel, not a marketing landing page.
  - Character, scene, storyboard, image, and video modules remain in one closed production chain.
  - Generated media can be previewed from the workbench.
  - Existing dark/light workbench theme support remains intact.

## V2 Changes Started After This Snapshot

- Added six-part script structure strip.
- Hid internal prompt cards by default.
- Moved 12-grid storyboard preview into a larger global preview panel.
- Added aspect-aware media classes for portrait/landscape/square previews.
- Added custom video preview controls with seek progress.
- Switched LongCat-AudioDiT to cloud/server-side default.

## Rollback Notes

If a future V2 UI direction is worse than this baseline, first remove the V2 override block at the end of `apps/web/src/styles.css`, then revert the V2 additions in `ProjectWorkbenchPage.tsx` around:

- `script-story-structure-strip`
- `storyboard-global-preview-panel`
- `shotFrameClass` / `shotAspectClass`
- `CanvasPromptCard` default hidden behavior
- custom `videoRef` playback controls in `VideoBoard`

Do not run broad `git reset --hard` in this repository because the worktree contains unrelated user/server changes.
