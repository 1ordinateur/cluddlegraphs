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

For the current `1.6.3` release candidate, run:

```bash
npm run check
```

Then create a GitHub release tagged:

```bash
1.6.3
```

Attach `main.js`, `manifest.json`, and `styles.css` to that release.

Release notes:

- Replaced connection-colour text dropdowns with Cluddle Graphs' existing native Obsidian colour picker.
- Resolved saved Canvas palette slots into their actual picker colours instead of showing labels such as `Colour 19`.
- Preserved existing palette-slot mappings and native-grey inheritance behavior.
- Fixed repeated graph synchronization re-enabling Canvas parent links after their native toggle was turned off.

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
- Ctrl-click and Cmd-click file nodes open in the same main editor pane as ordinary clicks.
- Shift/Alt-clicks, non-primary clicks, and tag nodes retain Obsidian's native navigation behavior.
- **Canvas connection colours** lists native and custom Canvas palette slots in the plugin settings.
- A yellow `7` source node creates a black `19` connection when that override is configured.
- Unmapped source colours create native-grey connections.
- Connection-colour controls use Obsidian's native colour picker and provide a reset button for inherited/native-grey behaviour.
- Turning **Canvas parent links** off removes Canvas-to-content hub links and they remain off after graph resynchronization.
- Recolouring a node or an existing connection does not trigger the connection default again.
- Disabling the plugin restores the original Canvas connection-creation method.
- Desktop graph and local graph behavior are tested. Mobile support remains disabled until Obsidian mobile graph behavior is explicitly verified.
