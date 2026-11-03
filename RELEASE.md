# Release Notes

## Obsidian Community Submission

The Obsidian Community directory expects the repository default branch to contain:

- `README.md`
- `LICENSE`
- `manifest.json`

The GitHub release whose tag matches `manifest.json` `version` must include:

- `main.js`
- `manifest.json`
- `styles.css`

For the current `1.6.5` release candidate, run:

```bash
npm run check
```

Then create a GitHub release tagged:

```bash
1.6.5
```

Attach `main.js`, `manifest.json`, and `styles.css` to that release.

Release notes:

- The plugin reads each Canvas palette colour from the `--canvas-color` value of its Canvas colour class. The result does not depend on `styles.css` or on the order of theme rules.
- The hidden colour probes get `display: none` from `styles.css`, not from an inline style.
- The graph and Canvas method wrappers no longer copy `this` into a local variable. The behaviour does not change.
- These changes follow the source rules of the Obsidian Community directory review.

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
- Canvas palette colours in the graph and the colour swatches in the plugin settings show the same colours as in 1.6.4, also in a graph in a separate window.
- In a Canvas, connect two cards in one coloured group, also with a connection that has its own colour. The graph link shows the group colour. A connection to a card in a different group keeps its own colour.
- A Canvas save that only moves a card inside the same group does not rebuild the graph. A new note that a Canvas refers to appears in the graph after a short delay.
- Canvas zone clouds stay on their nodes while you drag the graph and after a window resize.
- With a graph tab open in the background, typing in a note and editing a Canvas stay smooth. In the developer tools, a Performance recording made while you type shows no graph frames after the rebuild.
- With the global graph open, create a Canvas connection, a note link and a new note. Obsidian stays responsive while the layout moves. A Performance recording shows at most about 30 graph frames a second, with idle time between them.
- In a graph whose layout is still, a hover, pan or zoom moves at the full frame rate.
- Put the global graph in a tab that is not active, then edit notes and Canvases. A Performance recording shows no graph rebuild and no graph frame. Select the graph tab: it shows the changes after one rebuild.
- Repeat with the local graph in a collapsed sidebar, and with the graph in a separate window that you minimize and then restore.
- Desktop graph and local graph behavior are tested. Mobile support remains disabled until Obsidian mobile graph behavior is explicitly verified.
