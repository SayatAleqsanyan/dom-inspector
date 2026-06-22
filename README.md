# @armvs/dom-inspector

Lightweight DevTools-inspired DOM Inspector for any website.

Inspect elements, visualize the CSS box model, navigate the DOM tree, copy selectors and debug layouts without opening browser DevTools.

<p align="center">

<img width="900" src="docs/demo.gif">

</p>

---

## Features

✅ DevTools-style element inspection

✅ CSS box model visualization

✅ DOM breadcrumbs navigation

✅ CSS selector generation

✅ One-click selector copy

✅ Draggable inspector panel

✅ Runtime enable / disable

✅ Framework agnostic

✅ TypeScript support

✅ Zero dependencies

✅ Vitest unit tests

✅ Playwright integration tests

---

# Installation

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

### CDN

```html
<link rel="stylesheet"
href="https://cdn.jsdelivr.net/npm/@armvs/dom-inspector/dist/inspector.css">

<script src="https://cdn.jsdelivr.net/npm/@armvs/dom-inspector/dist/inspector.js"></script>

```

---

# Quick Start

Enable inspector permanently

```js
DOMInspector.init(true);
```

Enable only for localhost

```js
DOMInspector.init(

()=>location.hostname==="localhost"

);

```

Enable only for administrators

```js
DOMInspector.init(

()=>window.isAdmin===true

);

```

Disable inspector

```js
DOMInspector.init(false);
```

---

# Framework Examples

## React

```jsx

import DOMInspector from '@armvs/dom-inspector';

import '@armvs/dom-inspector/dist/inspector.css';



useEffect(()=>{

DOMInspector.init(true);

},[]);

```

---

## Vue

```js

import DOMInspector from '@armvs/dom-inspector';



onMounted(()=>{

DOMInspector.init(true);

});


```

---

## Angular

```ts

constructor(){


DOMInspector.init(true);


}


```

---

## Laravel Blade

```blade


<link rel="stylesheet"

href="{{ asset('vendor/inspector/inspector.css') }}">



<script src="{{ asset('vendor/inspector/inspector.js') }}"></script>



<script>


DOMInspector.init(

auth()->user()?->isAdmin() ?? false

);


</script>

```

---

## Dynamic Laravel Mode

```blade

<body

data-inspector="{{ auth()->user()?->isAdmin() ? '1' : '0' }}">



<script>


DOMInspector.init(

()=>document.body.dataset.inspector==='1'

);


</script>


```

---

# API

## init()

```js

DOMInspector.init(true);


DOMInspector.init(false);


DOMInspector.init(

()=>location.hostname==='localhost'

);


```

---

## Runtime Methods

```js


DOMInspector.enable();


DOMInspector.disable();


DOMInspector.destroy();


```

---

# Keyboard Shortcuts

| Shortcut    | Action          |
| ----------- | --------------- |
| Alt + Hover | Inspect element |
| Alt + Click | Pin panel       |
| Esc         | Close panel     |
| Drag Header | Move panel      |
| 📌          | Pin inspector   |
| ⧉           | Copy selector   |

---

# Testing

Run unit tests

```bash
npm test
```

Run integration tests

```bash
npx playwright test
```

---

# Browser Support

| Browser | Support |
| ------- | ------- |
| Chrome  | ✅       |
| Firefox | ✅       |
| Edge    | ✅       |
| Safari  | ✅       |

---

# Security

Uses textContent only

No innerHTML

Cross-origin stylesheets ignored safely

Clipboard errors handled gracefully

destroy() removes all listeners and DOM nodes

No overhead when disabled

---

# Versions

## 2.x

Standalone JavaScript library

## 3.x

Standalone library

Browser extension support

---

# License

MIT
