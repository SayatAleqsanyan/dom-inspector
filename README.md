````md
# @armvs/dom-inspector

Lightweight, zero-dependency DOM inspector. Drop it into any project — works with plain HTML, Laravel Blade, Vue, React, or any framework.

---

## Installation

### npm
```bash
npm install @armvs/dom-inspector
````

---

### CDN (Recommended)

#### jsDelivr

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@armvs/dom-inspector/dist/inspector.css">
<script src="https://cdn.jsdelivr.net/npm/@armvs/dom-inspector/dist/inspector.js"></script>
```

#### unpkg

```html
<link rel="stylesheet" href="https://unpkg.com/@armvs/dom-inspector/dist/inspector.css">
<script src="https://unpkg.com/@armvs/dom-inspector/dist/inspector.js"></script>
```

---

## Usage

### Plain HTML (node_modules)

```html
<link rel="stylesheet" href="node_modules/@armvs/dom-inspector/dist/inspector.css">
<script src="node_modules/@armvs/dom-inspector/dist/inspector.js"></script>

<script>
  DOMInspector.init(true);
</script>
```

⚠️ Note: This requires running on a local server (not file://)

---

### JS / Bundler (Vite, Webpack, React, Vue)

```js
import DOMInspector from '@armvs/dom-inspector';
import '@armvs/dom-inspector/dist/inspector.css';

DOMInspector.init(true);
```

---

### Laravel (Blade)

```blade
<link rel="stylesheet" href="{{ asset('vendor/inspector/inspector.css') }}">
<script src="{{ asset('vendor/inspector/inspector.js') }}"></script>

<script>
  DOMInspector.init(auth()->user()?->isAdmin() ?? false);
</script>
```

---

### Blade (recommended dynamic mode)

```blade
<body data-inspector="{{ auth()->user()?->isAdmin() ? '1' : '0' }}">

<script>
  DOMInspector.init(() =>
    document.body.dataset.inspector === '1'
  );
</script>
```

---

## API

### DOMInspector.init(value)

| Value         | Behavior              |
| ------------- | --------------------- |
| true          | Always enabled        |
| false         | Disabled              |
| () => boolean | Dynamic runtime check |

```js
DOMInspector.init(true);
DOMInspector.init(false);
DOMInspector.init(() => location.hostname === 'localhost');
DOMInspector.init(() => localStorage.getItem('inspector') === 'on');
DOMInspector.init(() => document.body.dataset.inspector === '1');
```

---

### Runtime methods

```js
DOMInspector.enable();
DOMInspector.disable();
DOMInspector.destroy();
```

---

## Controls

| Action           | Result            |
| ---------------- | ----------------- |
| Alt + hover      | Inspect element   |
| Alt + click      | Pin panel         |
| Esc              | Close panel       |
| Breadcrumb click | Navigate DOM tree |
| Drag header      | Move panel        |
| ⧉                | Copy selector     |
| 📌               | Pin / unpin       |

---

## File structure

```
dist/
├── inspector.js
└── inspector.css
```

---

## Security

* Uses textContent only → XSS safe
* Cross-origin CSS safely ignored
* Clipboard errors handled gracefully
* Full cleanup via destroy()
* Zero overhead when disabled

---

## Notes

* npm version requires bundler or server
* CDN version works directly in browser
* file:// mode works only with CDN or UMD build

---

## License

MIT

```
