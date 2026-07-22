# Manjiao web theme audit - 2026-07-22

## Outcome

The dual-theme workbench is the reliable foundation. Its `components.css`, `shell.css`, `stages.css`, and `responsive.css` contain no raw color values and consume the semantic variables in `workbench/styles/tokens.css`. The legacy application is not yet a design system: `styles.css` contains about 3,671 raw color values, 189 shadow declarations, and 670 radius declarations. `light-theme.css` adds another 28 raw colors and relies heavily on selector overrides.

The new `src/design-system` layer aliases the proven workbench tokens rather than creating another palette. It is intentionally not imported globally yet; doing so before selector migration would conceal precedence bugs behind the existing `!important` theme overrides.

## File audit

| File | Finding | Action |
| --- | --- | --- |
| `workbench/styles/tokens.css` | Complete Porcelain/Graphite color contract; typography, radius and motion scales exist. | Keep as source of truth for Release A. |
| `workbench/styles/components.css` | Semantic colors; one tokenized popover shadow; six tokenized radius declarations. | Reuse behavior and accessibility patterns in shared primitives. |
| `workbench/styles/shell.css` | No raw colors, shadows or radii. | No migration required. |
| `workbench/styles/stages.css` | No raw colors; stage-specific geometry remains local. | Keep geometry local; avoid moving layout into global primitives. |
| `workbench/styles/responsive.css` | No raw colors and clean breakpoint ownership. | Use its 767/1100/1439 strategy as the application baseline. |
| `light-theme.css` | Parallel `--light-*` vocabulary plus raw state colors and extensive `!important`. | Deprecate after each legacy page adopts `--ds-*`; do not extend. |
| `styles.css` | Multiple generations of frontend and admin styles in one file; raw values make dark mode incomplete. | Split by page domain during migration; no bulk replacement. |

## Page-domain issues and migration order

1. **Authentication and public entry**: video overlays, navigation and form surfaces use local black/white alpha values. Map canvas/surface/text/overlay first; verify media contrast separately because media chrome legitimately needs darker neutral surfaces in both themes.
2. **Creator home, scripts and wizard**: repeated cards, fields, tabs and primary actions use nearly identical raw colors with inconsistent focus treatment. Adopt `.ds-field`, `.ds-button` and semantic selected/focus tokens, then remove matching `light-theme.css` overrides.
3. **Task center, credits, profile, settings and help**: status color is often the only state signal. Map status colors and retain text/icon labels; standardize compact table and empty-state spacing.
4. **Admin console**: `admin-v2-*` is visually coherent but independently hard-coded, including blue/green/amber/violet metric accents. Migrate shell, table, filter, pagination and dialog primitives first; treat categorical metric colors as data-visualization tokens rather than theme accents.
5. **Creator showcase moderation/publishing**: modal, form and review badges duplicate admin primitives. Move after admin primitives so it becomes a consumer, not a second implementation.
6. **Legacy project-workbench overrides**: leave untouched until the new four-stage workbench replaces every route consumer. Removing early risks old route regressions.

## Semantic mapping

| Legacy intent | New token |
| --- | --- |
| page/app background | `--ds-bg-canvas` |
| sidebar/header background | `--ds-bg-shell` |
| card/dialog/table background | `--ds-bg-surface` |
| muted section/hover background | `--ds-bg-subtle` / `--ds-bg-muted` |
| main/secondary/helper text | `--ds-text-primary` / `--ds-text-secondary` / `--ds-text-muted` |
| default/strong/divider borders | `--ds-border-default` / `--ds-border-strong` / `--ds-border-divider` |
| primary action/hover/selection | `--ds-action-primary` / `--ds-action-primary-hover` / `--ds-action-selected` |
| focus | `--ds-focus-ring` |
| success/info/warning/danger | `--ds-status-*` |
| modal scrim/floating shadow | `--ds-overlay` / `--ds-shadow-floating` |

## Guardrails

- Do not add new `!important`, gradients, glow, glass effects or arbitrary raw colors.
- Keep radii at 4/6/8px; pills are reserved for true compact statuses or segmented selections.
- A page migration is complete only when both themes pass contrast, keyboard focus, loading, empty, error and responsive checks.
- Do not infer dark colors from light values. Every visual intent must resolve through a semantic token.
- Preserve media and timeline geometry inside their owning feature styles; the design system owns primitives, not page layout.

## Migration checklist

- Import workbench tokens and `design-system/semantic-tokens.css` before adopting primitives.
- Replace page canvas and typography tokens before controls; this makes contrast failures visible.
- Replace form fields, buttons, statuses, surfaces and dialogs using opt-in classes or local selectors backed by `--ds-*`.
- Verify 390, 768, 1024 and 1440px widths in Porcelain and Graphite.
- Remove migrated raw declarations and their `light-theme.css` overrides in the same page-scoped change.
- Run unit tests, typecheck, production build and browser accessibility checks before marking that domain complete.
