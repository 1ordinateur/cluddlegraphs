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

For the current `1.5.6` release candidate, run:

```bash
npm run check
```

Then create a GitHub release tagged:

```bash
1.5.6
```

Attach `main.js`, `manifest.json`, and `styles.css` to that release.

Patch notes:

- Custom Canvas card shapes now use resolved Canvas node colors instead of a hard-coded white fill.
- Canvas group card colors now render correctly when group nodes use square or polygon shapes.
- Canvas zone rendering waits briefly for graph settling and remains opt-in.

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
