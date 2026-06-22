# @armvs/dom-inspector · v2.3.0

Lightweight DOM inspector inspired by browser DevTools.  
Inspect elements, box model, selectors, and debug layouts directly on any webpage.

## Install

```bash
npm install @armvs/dom-inspector@v2.3.0
```

## Usage

```html
<link rel="stylesheet" href="node_modules/@armvs/dom-inspector/dist/inspector.css">
<script src="node_modules/@armvs/dom-inspector/dist/inspector.js"></script>
<script>
  DOMInspector.init(true);
</script>
```

## Keyboard shortcuts

| Key | Action |
|---|---|
| Alt + hover | Inspect element |
| Alt + click | Pin element |
| Escape | Close panel |
| ↑ Arrow | Navigate to parent |
| ↓ Arrow | Navigate to first child |
| ← → Arrows | Navigate to siblings |

## License

MIT
