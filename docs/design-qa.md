# Dual-theme workbench QA

## Scope

Porcelain Studio and Graphite Studio share one workbench component tree. QA covers the four stages (`内容`, `资产`, `镜头`, `成片`), responsive shell behavior, keyboard escape/focus behavior for task and evaluation drawers, reduced motion, document overflow, and absence of unsupported Release A controls.

## Commands

```text
pnpm --filter @aifilm/web test:unit
pnpm --filter @aifilm/web typecheck
pnpm --filter @aifilm/web build
pnpm --filter @aifilm/web exec playwright test
```

Set `PLAYWRIGHT_WORKBENCH_URL` to an authenticated project URL to run the stage and drawer interaction gates. The default suite still checks the public entry, theme persistence, overflow, and unsupported-control contract without inventing project data.

## Viewports and visual review

Review desktop at 2048x1152, 1440x900, 1366x768, 1024x768 and mobile at 768x1024 and 390x844 in both themes. Dynamic media is masked in screenshot comparisons. The timeline scroll region is the only permitted horizontal overflow.

## Known residuals

- Authenticated stage, delivery playback, and export assertions require `PLAYWRIGHT_WORKBENCH_URL` and real API data.
- Browser binaries may need `pnpm exec playwright install chromium` on a fresh machine.
- Existing bundle-size warnings are informational and do not change runtime behavior.

final result: blocked (Playwright Chromium binary unavailable in this environment)
