# AGENTS.md — Shared Component Library

This is Insomnia's shared component library (React Aria + Tailwind). See the design/roadmap


## Conventions

- Build on `react-aria-components` (high-level) first; only drop to `react-aria` hooks when the
  high-level component can't meet the need (e.g. Tooltip's arbitrary non-focusable trigger).
- **Colors** use repo CSS variables (`token-(--var)`, e.g. `text-(--color-font)`, `bg-(--hl-sm)`).
  Everything else (size/spacing/radius/font) uses native Tailwind utilities — do NOT use
  `--padding-*` / `--radius-*` / `--font-size-*`. Hardcode a color only if no repo variable fits, with a `FIXME`.
- **Variants** use `tailwind-variants` (`tv`); non-variant components use `cls()` (tailwind-merge).
- **Preserve `theme--*` scope classes** (`theme--dialog`, `theme--tooltip`, `theme--dropdown__menu`,
  `theme--link`, …) on the matching component root — they are the per-component theming contract
  (`src/ui/plugins/misc.ts`). Dropping them silently breaks user theme customization.

## When you add or change a component → document it in the code

There is no separate docs site. Describe props and variants in the component's TypeScript types and
doc comments, and keep this folder's README accurate.
