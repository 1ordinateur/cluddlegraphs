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

For the current `1.6.0` release candidate, run:

```bash
npm run check
```

Then create a GitHub release tagged:

```bash
1.6.0
```

Attach `main.js`, `manifest.json`, and `styles.css` to that release.

Release notes:

- Added configurable source-node-colour mappings for the initial colour of newly created Canvas connections.
- Unmapped node colours default to the native theme-aware grey connection colour.
- Existing connections, node recolouring, and manual post-creation edge colours remain untouched.
- Added native Canvas and Advanced Canvas compatibility, settings swatches, lifecycle cleanup, and regression coverage.

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
- **Canvas connection colours** lists native and custom Canvas palette slots in the plugin settings.
- A yellow `7` source node creates a black `19` connection when that override is configured.
- Unmapped source colours create native-grey connections.
- Recolouring a node or an existing connection does not trigger the connection default again.
- Disabling the plugin restores the original Canvas connection-creation method.
- Desktop graph and local graph behavior are tested. Mobile support remains disabled until Obsidian mobile graph behavior is explicitly verified.
