# Web design-system migration layer

`semantic-tokens.css` aliases the existing workbench theme contract. `components.css` contains opt-in primitives only, so adding these files does not alter legacy pages.

Adopting pages should import `workbench/styles/tokens.css`, then these two files. Migrate one page domain at a time and remove its old theme override only after both light and dark visual checks pass.
