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

For the current `1.6.4` release candidate, run:

```bash
npm run check
```

Then create a GitHub release tagged:

```bash
1.6.4
```

Attach `main.js`, `manifest.json`, and `styles.css` to that release.

Release notes:

- Large graphs render faster. Canvas node shapes are drawn one time in white, and Obsidian's native tint gives their colour. Before, each Canvas node shape was drawn again in each animation frame.
- Canvas card colours go into the graph data, so Obsidian's native renderer applies them. Coloured cards now show their true colour. Before, the colour was applied two times, so the cards looked darker.
- Canvas link colours are written to the link tint after the native render. Renderer colours are no longer swapped in each frame.
- A graph rebuild wakes the native render loop only when a Canvas label, shape or link colour changes. Before, each rebuild made the graph draw every node and link for about one second, also in a hidden graph tab. Obsidian rebuilds the graph after each note edit and each Canvas save.
- Graph rebuilds use about 30% less time, because the Canvas link injection makes fewer key strings and checks each path one time.
- Canvas palette colours are resolved one time and kept across graph rebuilds. A theme or CSS snippet change clears them.
- Canvas reloads are debounced, with a maximum wait of 2 seconds. Only the canvases that changed, or that refer to a changed file, are read again. When the parsed Canvas data does not change, the graph is not rebuilt.
- Search highlight neighbours, hidden zone links and Canvas zone clouds use less work in each frame. Zone clouds are drawn again only when their shapes change, and they stay on their nodes while the graph pans.

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
- Canvas text, link, and group cards show their true Canvas or inherited colour, and their shapes stay the same while the graph moves.
- Canvas link colours show on lines and arrows, also while a node is hovered.
- A Canvas save that only moves a card inside the same group does not rebuild the graph. A new note that a Canvas refers to appears in the graph after a short delay.
- Canvas zone clouds stay on their nodes while you drag the graph and after a window resize.
- With a graph tab open in the background, typing in a note and editing a Canvas stay smooth. In the developer tools, a Performance recording made while you type shows no graph frames after the rebuild.
- Desktop graph and local graph behavior are tested. Mobile support remains disabled until Obsidian mobile graph behavior is explicitly verified.
