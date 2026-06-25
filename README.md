# @armvs/dom-inspector

Lightweight, framework-agnostic DOM Inspector inspired by browser DevTools.

Inspect elements, visualize the CSS box model, navigate the DOM tree, copy selectors, and debug layouts directly on any webpage — without opening browser DevTools.

<p align="center">
  <img width="900" src="docs/dark.png" alt="DOM Inspector Dark Theme">
  <br><br>
  <img width="900" src="docs/light.png" alt="DOM Inspector Light Theme">
</p>

---

## Why DOM Inspector?

When debugging production environments, admin panels, staging deployments, embedded widgets, or client websites, opening DevTools is not always convenient.

DOM Inspector provides a lightweight in-page inspection experience that can be enabled only for specific users, environments, or conditions.

### Ideal Use Cases

* Admin-only debugging tools
* Internal QA environments
* Staging deployments
* CMS development
* Design system validation
* Layout troubleshooting
* Production-safe inspection tools

---

## Features

* DevTools-inspired element inspection
* CSS Box Model visualization
* DOM hierarchy breadcrumbs
* Automatic CSS selector generation
* One-click selector copying
* Draggable inspection panel
* Runtime enable / disable controls
* Framework agnostic
* TypeScript support
* Zero runtime dependencies
* Unit tested with Vitest
* End-to-end tested with Playwright

---

## Installation

### npm

```bash
npm install @armvs/dom-inspector
```

### pnpm

```bash
pnpm add @armvs/dom-inspector
```

### yarn

```bash
yarn add @armvs/dom-inspector
```

---

## CDN Usage

```html
<link
  rel="stylesheet"
  href="https://cdn.jsdelivr.net/npm/@armvs/dom-inspector/dist/inspector.min.css"
/>

<script src="https://cdn.jsdelivr.net/npm/@armvs/dom-inspector/dist/inspector.min.js"></script>

<script>
  DOMInspector.init(true);
</script>
```

---

## Quick Start

### Always Enabled

```js
DOMInspector.init(true);
```

### Disabled

```js
DOMInspector.init(false);
```

### Local Development Only

```js
DOMInspector.init(
  () => location.hostname === 'localhost'
);
```

### Admin Users Only

```js
DOMInspector.init(
  () => window.isAdmin === true
);
```

---

## Framework Examples

### React

```jsx
import { useEffect } from 'react';
import DOMInspector from '@armvs/dom-inspector';

import '@armvs/dom-inspector/dist/inspector.css';

function App() {
  useEffect(() => {
    DOMInspector.init(true);
  }, []);

  return <div>Application</div>;
}
```

### Vue

```js
import { onMounted } from 'vue';
import DOMInspector from '@armvs/dom-inspector';

onMounted(() => {
  DOMInspector.init(true);
});
```

### Angular

```ts
import DOMInspector from '@armvs/dom-inspector';

constructor() {
  DOMInspector.init(true);
}
```

### Laravel

```blade
<script src="{{ asset('vendor/inspector/inspector.js') }}"></script>

<script>
DOMInspector.init(
    {{ auth()->user()?->isAdmin() ? 'true' : 'false' }}
);
</script>
```

### Dynamic Laravel Authorization

```blade
<body data-inspector="{{ auth()->user()?->isAdmin() ? '1' : '0' }}">

<script>
DOMInspector.init(
  () => document.body.dataset.inspector === '1'
);
</script>
```

---

## API

### Initialization

```js
DOMInspector.init(true);

DOMInspector.init(false);

DOMInspector.init(
  () => location.hostname === 'localhost'
);
```

### Runtime Controls

```js
DOMInspector.enable();

DOMInspector.disable();

DOMInspector.destroy();
```

---

## Keyboard Shortcuts

| Shortcut    | Action          |
| ----------- | --------------- |
| Alt + Hover | Inspect element |
| Alt + Click | Pin inspector   |
| Esc         | Close inspector |
| Drag Header | Move panel      |
| 📌          | Pin panel       |
| ⧉           | Copy selector   |

---

## Testing

Run unit tests:

```bash
npm test
```

Run end-to-end tests:

```bash
npm run test:e2e
```

---

## Browser Support

| Browser | Supported |
| ------- | --------- |
| Chrome  | ✅         |
| Firefox | ✅         |
| Edge    | ✅         |
| Safari  | ✅         |

---

## Security

DOM Inspector is designed to be safe for production usage.

* Uses `textContent` instead of `innerHTML`
* Safely ignores restricted cross-origin stylesheets
* Handles clipboard failures gracefully
* Cleans up all event listeners on `destroy()`
* Removes injected DOM nodes completely
* Adds no runtime overhead when disabled

---

## Version History

### v4.x

* Standalone JavaScript library
* Browser extension support
* Improved inspection workflow
* Enhanced testing coverage

---

## License

MIT License

Copyright (c) Sayat
