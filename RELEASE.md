# Release Notes

## Obsidian Community Submission

The Obsidian Community directory expects the repository default branch to contain:

- `README.md`
- `LICENSE`
- `manifest.json`

The GitHub release whose tag matches `manifest.json` `version` must include:

- `main.js`
- `manifest.json`
- `styles.css`, if the plugin adds one later

For the current `1.5.7` release candidate, run:

```bash
npm run check
```

Then create a GitHub release tagged:

```bash
1.5.7
```

Attach `main.js`, `manifest.json`, and `styles.css` to that release.

Patch notes:

- Parent Canvas links now default on and use a single, correctly synchronized graph control.
- Removed the redundant parent-link toggle and migrated obsolete disabled values.
- Restored Canvas node and group colors with Obsidian 1.13 color APIs and CSS variables.
- Added regression tests for parent-link defaults, toggle state, and Canvas color compatibility.

## Manual QA

Before submission, verify:

- Global graph opens with the plugin enabled.
- Local graph opens with the plugin enabled.
- **Highlight search matches** appears at the bottom of **Filters**.
- Default graph search behavior is unchanged when the toggle is off.
- Highlight mode keeps non-matching nodes visible when the toggle is on.
- **Highlighted hit nodes** appears in **Display** and changes the direct-hit color.
- Graph reset shows **Are you sure?** and does not reset until confirmed.
- Disabling the plugin removes added controls and restores graph rendering.
- Desktop graph and local graph behavior are tested. Mobile support remains disabled until Obsidian mobile graph behavior is explicitly verified.
