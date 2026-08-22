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

For the current `1.6.1` release candidate, run:

```bash
npm run check
```

Then create a GitHub release tagged:

```bash
1.6.1
```

Attach `main.js`, `manifest.json`, and `styles.css` to that release.

Release notes:

- Fixed local-graph node clicks so ordinary clicks open files directly in the most recently used main editor leaf instead of replacing the local-graph tab.
- Patched the renderer callback that receives real graph clicks rather than the engine method retained only for compatibility.
- Preserved native tag-node, modifier-click, and unresolved-path behavior.
- Added renderer-level regression coverage and clean callback restoration on unload.

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
- An ordinary local-graph file-node click opens in the most recently used main editor pane without replacing the local graph.
- Modifier-clicks and tag nodes retain Obsidian's native navigation behavior.
- **Canvas connection colours** lists native and custom Canvas palette slots in the plugin settings.
- A yellow `7` source node creates a black `19` connection when that override is configured.
- Unmapped source colours create native-grey connections.
- Recolouring a node or an existing connection does not trigger the connection default again.
- Disabling the plugin restores the original Canvas connection-creation method.
- Desktop graph and local graph behavior are tested. Mobile support remains disabled until Obsidian mobile graph behavior is explicitly verified.
