;(function (global, factory) {
  typeof module !== 'undefined' && module.exports
    ? (module.exports = factory())
    : typeof define === 'function' && define.amd
      ? define(factory)
      : (global.DOMInspector = factory());
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ── CONSTANTS ──
  const PREFIX = '__insp';
  const PW = 360;
  // PH is dynamic — panel height is capped by viewport, computed at position time

  // ── DEFAULT CONFIG ──
  const DEFAULTS = {
    triggerKey:    'Alt',
    freezeOnClick: false,
    cssUrl:        null,
  };

  // ── STATE ──
  let _cfg        = { ...DEFAULTS };
  let _enabled    = false;
  let _mounted    = false;
  let _pinned     = null;
  let _current    = null;
  let _timer      = null;
  let _isDark     = true;
  let _isDragging = false;
  let _dragOffX   = 0, _dragOffY = 0;
  let _mouseX     = 0, _mouseY   = 0;
  let _layers     = [];
  let _dimLabels  = [];
  let _listeners  = [];
  let _handlers   = {};
  let _rafId      = null;
  let _pendingNode = null;
  let _activeTab  = 'layout';

  // #7 — debounce for nested element hover stabilization
  let _hoverTimer = null;
  const HOVER_DEBOUNCE = 40; // ms

  // v2.4 — Theme system
  let _theme = 'dark'; // 'dark' | 'light' | object

  // v2.4 — DOM Mutation History
  let _mutationObserver = null;
  let _mutationHistory  = [];
  const MAX_MUTATIONS   = 80;

  // v2.4 — Touch support
  let _touchStartX = 0, _touchStartY = 0;

  // ── SSR GUARD ──
  function isBrowser() {
    return typeof window !== 'undefined' && typeof document !== 'undefined';
  }

  // ── SAFE DOM HELPERS ──
  function el(tag, cls, attrs) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'text') e.textContent = v;
      else e.setAttribute(k, v);
    });
    return e;
  }

  function setText(id, val) {
    const node = document.getElementById(id);
    if (node) node.textContent = (val === '' || val == null) ? '—' : val;
  }

  function shortVal(v, max = 24) {
    if (!v || v === 'none' || v === 'normal' || v === 'auto') return v || '—';
    return v.length > max ? v.slice(0, max) + '…' : v;
  }

  function shortFont(ff) {
    return (ff || '').split(',')[0].replace(/['"]/g, '').trim().slice(0, 20);
  }

  function rgbToHex(rgb) {
    const m = (rgb || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return rgb || '—';
    return '#' + [m[1], m[2], m[3]].map(v => (+v).toString(16).padStart(2, '0')).join('');
  }

  // ── SELECTOR GENERATOR ──
  // Returns stable single-segment selector for a node, preferring test-friendly attributes
  function getSimpleSelector(node) {
    const tag = node.tagName.toLowerCase();
    if (node.id && !node.id.startsWith(PREFIX)) return tag + '#' + node.id;
    // Prefer data-testid > data-test > data-cy > data-qa > other data-* attributes
    const stableAttrs = ['data-testid', 'data-test', 'data-cy', 'data-qa'];
    for (const attr of stableAttrs) {
      const val = node.getAttribute(attr);
      if (val) return `${tag}[${attr}="${val}"]`;
    }
    // Any other data-* attribute
    for (const attr of Array.from(node.attributes)) {
      if (attr.name.startsWith('data-') && !attr.name.startsWith('data-v-')) {
        return `${tag}[${attr.name}="${attr.value}"]`;
      }
    }
    if (node.className && typeof node.className === 'string') {
      const cls = node.className.trim().split(/\s+/)
        .filter(c => !c.startsWith(PREFIX) && c !== '');
      if (cls.length) return tag + '.' + cls.slice(0, 2).join('.');
    }
    return tag;
  }

  // Checks if a selector uniquely matches exactly one element in the document
  function isUnique(selector) {
    try { return document.querySelectorAll(selector).length === 1; } catch (_) { return false; }
  }

  // generateStableSelector: builds the most stable, concise selector possible.
  // Preference order: id > data-testid/test/cy/qa > data-* > unique class combo > nth-of-type
  function generateStableSelector(node) {
    if (!node || node.nodeType !== 1) return '';
    const tag = node.tagName.toLowerCase();

    // id — most stable
    if (node.id && !node.id.startsWith(PREFIX)) {
      const sel = `#${node.id}`;
      if (isUnique(sel)) return sel;
    }

    // data-testid / data-test / data-cy / data-qa
    const stableAttrs = ['data-testid', 'data-test', 'data-cy', 'data-qa'];
    for (const attr of stableAttrs) {
      const val = node.getAttribute(attr);
      if (val) {
        const sel = `[${attr}="${val}"]`;
        if (isUnique(sel)) return sel;
      }
    }

    // Any other data-* attribute
    for (const attr of Array.from(node.attributes)) {
      if (attr.name.startsWith('data-') && !attr.name.startsWith('data-v-')) {
        const sel = `${tag}[${attr.name}="${attr.value}"]`;
        if (isUnique(sel)) return sel;
      }
    }

    // Unique class combinations (try adding more classes until unique)
    if (node.className && typeof node.className === 'string') {
      const cls = node.className.trim().split(/\s+/)
        .filter(c => !c.startsWith(PREFIX) && c !== '');
      for (let i = 1; i <= cls.length; i++) {
        const sel = tag + '.' + cls.slice(0, i).join('.');
        if (isUnique(sel)) return sel;
      }
    }

    // Fall back to structural path — but avoid nth-child, use nth-of-type only when needed
    const parts = [];
    let cur = node;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      // Try to anchor on an id or data-testid ancestor to keep selector short
      if (cur.id && !cur.id.startsWith(PREFIX)) {
        parts.unshift(`#${cur.id}`);
        break;
      }
      for (const attr of stableAttrs) {
        const val = cur.getAttribute(attr);
        if (val) { parts.unshift(`[${attr}="${val}"]`); break; }
      }
      if (parts.length && parts[0].startsWith('[')) break;

      let seg = cur.tagName.toLowerCase();
      // Count same-tag siblings only — nth-of-type is more stable than nth-child
      let idx = 1;
      let sib = cur.previousElementSibling;
      while (sib) { if (sib.tagName === cur.tagName) idx++; sib = sib.previousElementSibling; }
      if (idx > 1) seg += `:nth-of-type(${idx})`;
      parts.unshift(seg);
      cur = cur.parentElement;
      if (parts.length > 5) break;
    }
    return parts.join(' > ');
  }

  function getFullSelector(node) {
    return generateStableSelector(node);
  }

  function getXPath(node) {
    if (node === document.body) return '/html/body';
    // If inside a shadow root, note the boundary
    if (isInShadow(node)) {
      return '(shadow-root) ' + getXPathSegment(node);
    }
    return getXPathSegment(node);
  }

  function getXPathSegment(node) {
    if (node === document.body) return '/html/body';
    const parts = [];
    let cur = node;
    while (cur && cur.nodeType === 1) {
      if (cur instanceof ShadowRoot) break;
      const parent = cur.parentNode;
      if (!parent || parent instanceof ShadowRoot) break;
      let idx = 1;
      let sib = cur.previousElementSibling;
      while (sib) { if (sib.tagName === cur.tagName) idx++; sib = sib.previousElementSibling; }
      parts.unshift(cur.tagName.toLowerCase() + (idx > 1 ? `[${idx}]` : ''));
      cur = parent;
      if (cur === document.documentElement || cur === document.body) break;
    }
    return '/html/' + parts.join('/');
  }

  function isStackingCtx(style) {
    return (style.position !== 'static' && style.zIndex !== 'auto')
      || style.opacity !== '1'
      || style.transform !== 'none'
      || style.filter !== 'none'
      || style.isolation === 'isolate'
      || (style.willChange && style.willChange !== 'auto');
  }

  function isInspectorNode(node) {
    return (node.closest && node.closest(`#${PREFIX}_panel`))
      || (node.id && node.id.startsWith(PREFIX))
      || node.classList.contains(`${PREFIX}_layer`)
      || node.classList.contains(`${PREFIX}_dim`);
  }

  // ── SHADOW DOM HELPERS ──
  // Returns true if a node lives inside a shadow root
  function isInShadow(node) {
    let cur = node;
    while (cur) {
      if (cur instanceof ShadowRoot) return true;
      cur = cur.parentNode;
    }
    return false;
  }

  // Walk up through shadow boundaries to get the full host chain
  function getShadowHostChain(node) {
    const chain = [];
    let cur = node.parentNode || node.parentElement;
    while (cur) {
      if (cur instanceof ShadowRoot) {
        chain.unshift({ type: 'shadow', host: cur.host });
        cur = cur.host.parentNode || cur.host.parentElement;
      } else {
        cur = cur.parentNode || cur.parentElement;
      }
    }
    return chain;
  }

  // Generate a selector string that includes shadow host context
  function getShadowSelector(node) {
    const parts = [];
    let cur = node;
    while (cur && cur.nodeType === 1) {
      const parent = cur.parentNode;
      if (parent instanceof ShadowRoot) {
        // We crossed a shadow boundary — note the host
        const hostSel = generateStableSelector(parent.host);
        parts.unshift(`>> ${cur.tagName.toLowerCase()}`);
        parts.unshift(hostSel);
        cur = parent.host.parentNode || parent.host.parentElement;
        break;
      }
      parts.unshift(getSimpleSelector(cur));
      cur = cur.parentElement;
      if (parts.length > 6) break;
    }
    return parts.join(' > ');
  }

  // ── THEME SYSTEM (v2.4) ──
  // Applies theme to the panel. theme: 'dark' | 'light' | { primary, bg, text, border, ... }
  function applyTheme(panel, theme) {
    if (!panel) return;
    panel.classList.remove('insp-dark', 'insp-light', 'insp-custom');
    // Remove any previously injected custom theme style
    const old = document.getElementById(`${PREFIX}_custom_theme`);
    if (old) old.parentNode.removeChild(old);

    if (theme === 'dark' || !theme) {
      panel.classList.add('insp-dark');
      _isDark = true;
    } else if (theme === 'light') {
      panel.classList.add('insp-light');
      _isDark = false;
    } else if (typeof theme === 'object') {
      // Custom theme: inject CSS vars onto the panel
      panel.classList.add('insp-custom');
      _isDark = false;
      const vars = Object.entries(theme)
        .map(([k, v]) => `  --insp-${k}: ${v};`)
        .join('\n');
      const style = document.createElement('style');
      style.id = `${PREFIX}_custom_theme`;
      style.textContent = `#${PREFIX}_panel.insp-custom {\n${vars}\n}`;
      document.head.appendChild(style);
    }
  }

  // ── DOM MUTATION HISTORY (v2.4) ──
  function startMutationObserver() {
    if (_mutationObserver) return;
    _mutationObserver = new MutationObserver((records) => {
      for (const rec of records) {
        const target = rec.target;
        // Skip inspector nodes
        if (target.id && target.id.startsWith(PREFIX)) continue;
        if (target.closest && target.closest(`#${PREFIX}_panel`)) continue;

        let entry = null;
        if (rec.type === 'childList') {
          rec.addedNodes.forEach(n => {
            if (n.nodeType === 1 && !(n.id && n.id.startsWith(PREFIX))) {
              entry = { type: 'added',   tag: n.tagName ? n.tagName.toLowerCase() : '#text', time: Date.now() };
            }
          });
          rec.removedNodes.forEach(n => {
            if (n.nodeType === 1 && !(n.id && n.id.startsWith(PREFIX))) {
              entry = { type: 'removed', tag: n.tagName ? n.tagName.toLowerCase() : '#text', time: Date.now() };
            }
          });
        } else if (rec.type === 'attributes') {
          const tag = target.tagName ? target.tagName.toLowerCase() : '?';
          entry = { type: 'attr',    tag, attr: rec.attributeName, time: Date.now() };
        } else if (rec.type === 'characterData') {
          const p = rec.target.parentElement;
          entry = { type: 'text',    tag: p ? p.tagName.toLowerCase() : '#text', time: Date.now() };
        }
        if (entry) {
          _mutationHistory.unshift(entry);
          if (_mutationHistory.length > MAX_MUTATIONS) _mutationHistory.length = MAX_MUTATIONS;
          emit('mutation', entry);
          // Live-update mutation pane if visible
          if (_activeTab === 'mutations') renderMutationPane();
        }
      }
    });
    _mutationObserver.observe(document.body, {
      childList: true, subtree: true, attributes: true, characterData: true,
    });
  }

  function stopMutationObserver() {
    if (_mutationObserver) { _mutationObserver.disconnect(); _mutationObserver = null; }
  }

  function renderMutationPane() {
    const list = document.getElementById(`${PREFIX}_mut_list`);
    if (!list) return;
    while (list.firstChild) list.removeChild(list.firstChild);
    if (_mutationHistory.length === 0) {
      const empty = el('span', 'insp-mut-empty', { text: 'No mutations recorded yet.' });
      list.appendChild(empty); return;
    }
    _mutationHistory.forEach(m => {
      const r = el('div', 'insp-mut-row');
      const badge = el('span', `insp-mut-badge insp-mut-${m.type}`);
      const iconMap = { added: '+', removed: '−', attr: '~', text: 'T' };
      const labelMap = { added: 'added', removed: 'removed', attr: 'attr', text: 'text' };
      badge.textContent = iconMap[m.type] || '?';
      const desc = el('span', 'insp-mut-desc');
      let txt = `<${m.tag}>`;
      if (m.type === 'attr') txt += ` .${m.attr}`;
      desc.textContent = `${labelMap[m.type]}  ${txt}`;
      const time = el('span', 'insp-mut-time');
      const age = Math.round((Date.now() - m.time) / 1000);
      time.textContent = age < 2 ? 'just now' : `${age}s ago`;
      r.append(badge, desc, time);
      list.appendChild(r);
    });
  }

  // ── EVENT LISTENER INSPECTOR (v2.4) ──
  // Reads event listeners via getEventListeners (DevTools only) or falls back to
  // tracking listeners added via the inspected page's own addEventListener patches.
  // We maintain a WeakMap-based registry that pages can opt into.
  const _listenerRegistry = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

  function getAttachedListeners(node) {
    // Primary: Chrome DevTools protocol (only works in DevTools context)
    if (typeof getEventListeners === 'function') {
      try {
        const map = getEventListeners(node);
        return Object.entries(map).map(([type, handlers]) => ({ type, count: handlers.length }));
      } catch (_) {}
    }
    // Secondary: our own registry (populated if page uses patchAddEventListener())
    if (_listenerRegistry && _listenerRegistry.has(node)) {
      const map = _listenerRegistry.get(node);
      return Object.entries(map).map(([type, handlers]) => ({ type, count: handlers.length }));
    }
    // Fallback: infer from element type
    return inferLikelyListeners(node);
  }

  function inferLikelyListeners(node) {
    const tag = node.tagName.toLowerCase();
    const listeners = [];
    const inlineEvents = ['onclick','onmousedown','onmouseup','onkeydown','onkeyup',
      'onchange','oninput','onsubmit','onfocus','onblur','onscroll'];
    inlineEvents.forEach(ev => {
      if (node[ev]) listeners.push({ type: ev.slice(2), count: 1, inferred: false });
    });
    // Check for common ARIA/role patterns
    const role = node.getAttribute('role');
    if (tag === 'button' || role === 'button') listeners.push({ type: 'click', count: '?', inferred: true });
    if (tag === 'a' && node.href)             listeners.push({ type: 'click', count: '?', inferred: true });
    if (tag === 'form')                       listeners.push({ type: 'submit', count: '?', inferred: true });
    if (['input','select','textarea'].includes(tag)) {
      listeners.push({ type: 'change', count: '?', inferred: true });
      listeners.push({ type: 'input',  count: '?', inferred: true });
    }
    return listeners;
  }

  function renderEventsPane(node) {
    const list = document.getElementById(`${PREFIX}_events_list`);
    const note = document.getElementById(`${PREFIX}_events_note`);
    if (!list) return;
    while (list.firstChild) list.removeChild(list.firstChild);

    const listeners = getAttachedListeners(node);
    const hasDevTools = typeof getEventListeners === 'function';
    const hasRegistry = _listenerRegistry && _listenerRegistry.has(node);

    if (note) {
      note.textContent = hasDevTools
        ? 'Via DevTools getEventListeners().'
        : hasRegistry
          ? 'Via listener registry.'
          : 'Inline handlers + inferred from element type. For full data, open in DevTools or call DOMInspector.patchAddEventListener().';
    }

    if (listeners.length === 0) {
      list.appendChild(el('span', 'insp-evt-empty', { text: 'No event listeners detected.' }));
      return;
    }

    // Deduplicate inferred vs real
    const seen = new Map();
    listeners.forEach(l => {
      if (!seen.has(l.type) || !l.inferred) seen.set(l.type, l);
    });

    seen.forEach(l => {
      const r = el('div', 'insp-evt-row');
      const badge = el('span', 'insp-evt-badge', { text: l.type });
      const count = el('span', `insp-evt-count${l.inferred ? ' insp-evt-inferred' : ''}`);
      count.textContent = l.inferred ? '?' : `×${l.count}`;
      count.title = l.inferred ? 'Inferred from element type' : `${l.count} handler(s)`;
      r.append(badge, count);
      list.appendChild(r);
    });
  }

  // ── FRAMEWORK DETECTION (v2.5) ──

  // React: reads component name from Fiber internal
  function detectReact(node) {
    // React 16+ stores fiber on __reactFiber$... or __reactInternalInstance$...
    const fiberKey = Object.keys(node).find(k =>
      k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
    );
    if (!fiberKey) return null;

    let fiber = node[fiberKey];
    // Walk up fiber tree to find the nearest named function/class component
    let cur = fiber;
    while (cur) {
      const type = cur.type;
      if (type) {
        // Function component or class component
        const name = typeof type === 'function'
          ? (type.displayName || type.name || null)
          : typeof type === 'string' ? null : null;
        if (name && name !== 'Unknown' && !/^[a-z]/.test(name)) {
          // Also check for hooks
          const hooks = collectReactHooks(cur);
          return { name, hooks };
        }
      }
      cur = cur.return || null;
    }
    return null;
  }

  function collectReactHooks(fiber) {
    const hooks = [];
    try {
      let memoizedState = fiber.memoizedState;
      while (memoizedState) {
        const queue = memoizedState.queue;
        if (queue !== null && queue !== undefined) {
          // useState or useReducer
          const val = memoizedState.memoizedState;
          if (typeof val !== 'function' && typeof val !== 'object') {
            hooks.push({ type: 'state', value: String(val).slice(0, 30) });
          } else {
            hooks.push({ type: 'state' });
          }
        } else if (typeof memoizedState.memoizedState === 'function') {
          hooks.push({ type: 'effect' });
        } else if (memoizedState.deps !== undefined) {
          hooks.push({ type: 'memo/callback' });
        }
        memoizedState = memoizedState.next;
        if (hooks.length >= 8) break; // cap for display
      }
    } catch (_) {}
    return hooks;
  }

  // Vue: reads component from __vue_app__ or __vueParentComponent
  function detectVue(node) {
    // Vue 3
    let cur = node;
    while (cur && cur !== document.body) {
      if (cur.__vueParentComponent) {
        const comp = cur.__vueParentComponent;
        const name = comp.type?.name
          || comp.type?.displayName
          || comp.type?.__name
          || (comp.type === Object(comp.type) ? extractVueName(comp) : null);
        if (name) {
          const props = comp.props ? Object.keys(comp.props).slice(0, 6) : [];
          return { name, version: 3, props };
        }
      }
      // Vue 2
      if (cur.__vue__) {
        const vm = cur.__vue__;
        const name = vm.$options?.name
          || vm.$options?._componentTag
          || vm.$options?.components && Object.keys(vm.$options.components)[0]
          || null;
        if (name) {
          const props = vm.$options?.props ? Object.keys(vm.$options.props).slice(0, 6) : [];
          return { name, version: 2, props };
        }
      }
      cur = cur.parentElement;
    }
    return null;
  }

  function extractVueName(comp) {
    // Last-resort: try to derive from file path stored in __file
    if (comp.type?.__file) {
      const file = comp.type.__file;
      const base = file.split('/').pop().replace(/\.\w+$/, '');
      return base || null;
    }
    return null;
  }

  // Angular: reads component from ng attributes or __ngContext__
  function detectAngular(node) {
    let cur = node;
    while (cur && cur !== document.body) {
      // Angular Ivy (v9+): __ngContext__ on host element
      if (cur.__ngContext__ !== undefined) {
        const ctx = cur.__ngContext__;
        // ctx is an LView array; index 8 is the component instance
        if (Array.isArray(ctx)) {
          const instance = ctx[8];
          if (instance) {
            const name = instance.constructor?.name || null;
            if (name && name !== 'Object') {
              // Read @Input() property names
              const inputs = Object.keys(instance)
                .filter(k => !k.startsWith('_') && !k.startsWith('ng'))
                .slice(0, 6);
              return { name, version: 'Ivy', inputs };
            }
          }
        }
      }
      // Angular older: ng-version attribute on app root
      if (cur.hasAttribute && cur.hasAttribute('ng-version')) {
        return { name: 'AppRoot', version: cur.getAttribute('ng-version'), inputs: [] };
      }
      cur = cur.parentElement;
    }
    return null;
  }

  function renderFrameworkPane(node) {
    const container = document.getElementById(`${PREFIX}_fw_content`);
    if (!container) return;
    while (container.firstChild) container.removeChild(container.firstChild);

    const react   = detectReact(node);
    const vue     = detectVue(node);
    const angular = detectAngular(node);

    if (!react && !vue && !angular) {
      const none = el('div', 'insp-fw-none');
      none.textContent = 'No React, Vue, or Angular component detected on this element or its ancestors.';
      container.appendChild(none);
      return;
    }

    if (react) {
      container.appendChild(fwSection('React', react.name, '#61dafb', [
        ['Component', react.name],
        ...react.hooks.map((h, i) => [
          `Hook ${i + 1}`,
          h.type + (h.value !== undefined ? ` = ${h.value}` : ''),
        ]),
      ]));
    }

    if (vue) {
      container.appendChild(fwSection('Vue ' + vue.version, vue.name, '#42b883', [
        ['Component', vue.name],
        ...(vue.props.length ? [['Props', vue.props.join(', ')]] : []),
      ]));
    }

    if (angular) {
      container.appendChild(fwSection('Angular ' + angular.version, angular.name, '#dd1b16', [
        ['Component', angular.name],
        ...(angular.inputs.length ? [['Inputs', angular.inputs.join(', ')]] : []),
      ]));
    }
  }

  function fwSection(frameworkLabel, componentName, color, rows) {
    const wrap = el('div', 'insp-fw-section');

    const header = el('div', 'insp-fw-header');
    const dot = el('span', 'insp-fw-dot');
    dot.style.background = color;
    const label = el('span', 'insp-fw-label');
    label.textContent = frameworkLabel;
    const comp = el('span', 'insp-fw-comp');
    comp.textContent = componentName;
    header.append(dot, label, comp);
    wrap.appendChild(header);

    rows.forEach(([k, v]) => {
      const r = el('div', 'insp-fw-row');
      r.append(
        el('span', 'insp-fw-key', { text: k }),
        el('span', 'insp-fw-val', { text: v })
      );
      wrap.appendChild(r);
    });

    return wrap;
  }

  // ── EVENT EMITTER ──
  function emit(name, detail) {
    (_handlers[name] || []).forEach(fn => { try { fn(detail); } catch(_) {} });
    if (isBrowser()) {
      document.dispatchEvent(new CustomEvent(`dom-inspector:${name}`, { detail }));
    }
  }

  // ── v3.0: FLEX / GRID INSPECTOR ──

  function getFlexInfo(style) {
    if (style.display !== 'flex' && style.display !== 'inline-flex') return null;
    return {
      display:        style.display,
      direction:      style.flexDirection,
      wrap:           style.flexWrap,
      justifyContent: style.justifyContent,
      alignItems:     style.alignItems,
      alignContent:   style.alignContent,
      gap:            style.gap !== 'normal' ? style.gap : (style.rowGap + ' / ' + style.columnGap),
    };
  }

  function getGridInfo(style) {
    if (style.display !== 'grid' && style.display !== 'inline-grid') return null;
    const parseTracks = (tmpl) => {
      if (!tmpl || tmpl === 'none') return 0;
      return tmpl.trim().split(/\s+(?=[0-9]|auto|fr|min|max|repeat|fit|\[)/).length;
    };
    return {
      display:         style.display,
      columns:         `${parseTracks(style.gridTemplateColumns)} (${shortVal(style.gridTemplateColumns, 26)})`,
      rows:            `${parseTracks(style.gridTemplateRows)} (${shortVal(style.gridTemplateRows, 26)})`,
      gap:             style.gap !== 'normal' ? style.gap : (style.rowGap + ' / ' + style.columnGap),
      'auto-flow':     style.gridAutoFlow,
      alignItems:      style.alignItems,
      justifyItems:    style.justifyItems,
    };
  }

  function getFlexItemInfo(node, style) {
    const parent = node.parentElement;
    if (!parent) return null;
    const ps = getComputedStyle(parent);
    if (ps.display !== 'flex' && ps.display !== 'inline-flex') return null;
    return {
      flexGrow:   style.flexGrow,
      flexShrink: style.flexShrink,
      flexBasis:  style.flexBasis,
      alignSelf:  style.alignSelf,
      order:      style.order,
    };
  }

  function getGridItemInfo(node, style) {
    const parent = node.parentElement;
    if (!parent) return null;
    const ps = getComputedStyle(parent);
    if (ps.display !== 'grid' && ps.display !== 'inline-grid') return null;
    return {
      'col-start':  style.gridColumnStart,
      'col-end':    style.gridColumnEnd,
      'row-start':  style.gridRowStart,
      'row-end':    style.gridRowEnd,
      area:         style.gridArea,
      alignSelf:    style.alignSelf,
      justifySelf:  style.justifySelf,
    };
  }

  function renderLayoutInspectorPane(node, style) {
    const container = document.getElementById(`${PREFIX}_layout_inspector`);
    if (!container) return;
    while (container.firstChild) container.removeChild(container.firstChild);

    const flex     = getFlexInfo(style);
    const grid     = getGridInfo(style);
    const flexItem = getFlexItemInfo(node, style);
    const gridItem = getGridItemInfo(node, style);

    if (!flex && !grid && !flexItem && !gridItem) {
      const none = el('div', 'insp-li-none');
      none.textContent = `display: ${style.display} — no flex/grid context.`;
      container.appendChild(none); return;
    }

    function liSection(title, color, data) {
      const wrap = el('div', 'insp-li-section');
      const hdr = el('div', 'insp-li-header');
      const dot = el('span', 'insp-li-dot'); dot.style.background = color;
      hdr.append(dot, el('span', 'insp-li-label', { text: title }));
      wrap.appendChild(hdr);
      Object.entries(data).forEach(([k, v]) => {
        if (v === null || v === undefined || v === '' || v === 'normal' || v === '0px') return;
        const r = el('div', 'insp-li-row');
        r.append(el('span', 'insp-li-key', { text: k }), el('span', 'insp-li-val', { text: String(v) }));
        wrap.appendChild(r);
      });
      return wrap;
    }

    if (flex)     container.appendChild(liSection('Flex Container', '#89b4fa', flex));
    if (grid)     container.appendChild(liSection('Grid Container', '#a6e3a1', grid));
    if (flexItem) container.appendChild(liSection('Flex Item', '#cba6f7', flexItem));
    if (gridItem) container.appendChild(liSection('Grid Item', '#f9e2af', gridItem));
  }

  // ── v3.0: ACCESSIBILITY AUDIT ──

  const A11Y_RULES = [
    { id:'img-alt',       sev:'error',   msg:'<img> missing alt attribute.',
      check: n => n.tagName==='IMG' && !n.getAttribute('alt') },
    { id:'button-name',   sev:'error',   msg:'<button> has no accessible name.',
      check: n => n.tagName==='BUTTON' && !n.textContent.trim() && !n.getAttribute('aria-label') && !n.getAttribute('aria-labelledby') },
    { id:'input-label',   sev:'error',   msg:'Form control has no associated label.',
      check: n => {
        if (!['INPUT','SELECT','TEXTAREA'].includes(n.tagName)) return false;
        if (n.getAttribute('type')==='hidden') return false;
        return !(n.getAttribute('aria-label') || n.getAttribute('aria-labelledby')
          || (n.id && document.querySelector(`label[for="${n.id}"]`)));
      }},
    { id:'link-name',     sev:'error',   msg:'<a> has no accessible name.',
      check: n => n.tagName==='A' && !n.textContent.trim() && !n.getAttribute('aria-label') },
    { id:'tabindex-pos',  sev:'warning', msg:'tabindex > 0 disrupts tab order. Use 0.',
      check: n => parseInt(n.getAttribute('tabindex'),10) > 0 },
    { id:'aria-hidden-focus', sev:'warning', msg:'aria-hidden="true" on a focusable element.',
      check: n => n.getAttribute('aria-hidden')==='true' && isFocusable(n) },
    { id:'interactive-role', sev:'warning', msg:'Interactive role on non-focusable element — add tabindex="0".',
      check: n => {
        const role = n.getAttribute('role');
        return ['button','link','menuitem','tab','checkbox','radio','switch'].includes(role) && !isFocusable(n);
      }},
    { id:'contrast',      sev:'warning', msg:'Estimated contrast ratio < 4.5:1 (WCAG AA).',
      check: n => {
        if (!n.textContent.trim()) return false;
        const s = getComputedStyle(n);
        const bgL = relLum(s.backgroundColor), fgL = relLum(s.color);
        if (bgL===null||fgL===null) return false;
        const ratio = (Math.max(bgL,fgL)+0.05)/(Math.min(bgL,fgL)+0.05);
        return ratio < 4.5;
      }},
  ];

  function relLum(colorStr) {
    const m = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return null;
    const ch = v => { const c=parseInt(v)/255; return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4); };
    return 0.2126*ch(m[1]) + 0.7152*ch(m[2]) + 0.0722*ch(m[3]);
  }

  function runA11yAudit(node) {
    return A11Y_RULES
      .filter(r => { try { return r.check(node); } catch(_) { return false; } })
      .map(r => ({ id: r.id, message: r.msg, severity: r.sev }));
  }

  function renderA11yAuditSection(node) {
    const auditEl = document.getElementById(`${PREFIX}_a11y_audit`);
    if (!auditEl) return;
    while (auditEl.firstChild) auditEl.removeChild(auditEl.firstChild);
    const issues = runA11yAudit(node);
    if (issues.length === 0) {
      auditEl.appendChild(el('div', 'insp-a11y-ok', { text: '✓ No issues detected.' }));
      return;
    }
    issues.forEach(issue => {
      const row = el('div', `insp-a11y-issue insp-a11y-${issue.severity}`);
      const icon = { error:'✕', warning:'⚠', info:'ℹ' }[issue.severity] || '•';
      row.append(
        el('span', 'insp-a11y-icon', { text: icon }),
        el('span', 'insp-a11y-msg',  { text: issue.message })
      );
      auditEl.appendChild(row);
    });
  }

  // ── v3.0: EXPORT FORMATS ──

  function exportAsHTML(data) {
    if (!data) return '';
    const tbl = obj => Object.entries(obj)
      .map(([k,v])=>`<tr><td>${k}</td><td>${String(v).replace(/</g,'&lt;')}</td></tr>`).join('');
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>DOM Inspector — ${data.tagName}</title>
<style>body{font-family:monospace;font-size:12px;background:#1e1e2e;color:#cdd6f4;padding:20px}
h1{color:#cba6f7}h2{color:#89b4fa;margin-top:16px}
table{border-collapse:collapse;width:100%}td{padding:3px 8px;border-bottom:1px solid #313244}
td:first-child{color:#6c7086;width:40%}.sel{background:#252535;padding:6px 10px;border-radius:4px;color:#a6e3a1;word-break:break-all}</style></head>
<body><h1>&lt;${data.tagName}&gt;</h1>
<h2>Selector</h2><div class="sel">${data.selector}</div>
<h2>XPath</h2><div class="sel">${data.xpath}</div>
<h2>Dimensions</h2><table><tr><td>width</td><td>${data.width}px</td></tr><tr><td>height</td><td>${data.height}px</td></tr></table>
<h2>Attributes</h2><table>${tbl(data.attributes)}</table>
<h2>Accessibility</h2><table><tr><td>role</td><td>${data.a11y.role}</td></tr>
<tr><td>name</td><td>${data.a11y.accessibleName}</td></tr>
<tr><td>focusable</td><td>${data.a11y.focusable}</td></tr></table>
</body></html>`;
  }

  function exportAsMarkdown(data) {
    if (!data) return '';
    const tbl = obj => Object.entries(obj).map(([k,v])=>`| \`${k}\` | ${v} |`).join('\n');
    return `# DOM Inspector — \`<${data.tagName}>\`\n\n## Selector\n\`\`\`css\n${data.selector}\n\`\`\`\n\n## XPath\n\`\`\`\n${data.xpath}\n\`\`\`\n\n## Dimensions\n| | |\n|---|---|\n| width | ${data.width}px |\n| height | ${data.height}px |\n\n## Attributes\n| Attribute | Value |\n|---|---|\n${tbl(data.attributes)}\n\n## Accessibility\n| | |\n|---|---|\n| role | ${data.a11y.role} |\n| name | ${data.a11y.accessibleName} |\n| focusable | ${data.a11y.focusable} |\n`;
  }

  function exportAsYAML(data) {
    if (!data) return '';
    const q = s => `"${String(s).replace(/"/g,'\\"')}"`;
    const obj2yaml = (obj, indent) => Object.entries(obj)
      .map(([k,v])=>`${' '.repeat(indent)}${k}: ${q(v)}`).join('\n');
    return `element: "<${data.tagName}>"\nselector: ${q(data.selector)}\nxpath: ${q(data.xpath)}\ndimensions:\n  width: ${data.width}\n  height: ${data.height}\nattributes:\n${obj2yaml(data.attributes,2)}\naccessibility:\n  role: ${q(data.a11y.role)}\n  name: ${q(data.a11y.accessibleName)}\n  focusable: ${data.a11y.focusable}\n`;
  }

  // ── LAYERS ──
  function clearLayers() {
    _layers.forEach(l => l.parentNode && l.parentNode.removeChild(l));
    _layers = [];
    _dimLabels.forEach(l => l.parentNode && l.parentNode.removeChild(l));
    _dimLabels = [];
  }

  function makeLayer(x, y, w, h, cls) {
    const d = el('div', `${PREFIX}_layer ${PREFIX}_${cls}`);
    d.style.cssText = `left:${x}px;top:${y}px;width:${Math.max(0,w)}px;height:${Math.max(0,h)}px;`;
    document.body.appendChild(d);
    _layers.push(d);
  }

  function makeDimLabel(x, y, text) {
    const d = el('div', `${PREFIX}_dim`, { text });
    d.style.cssText = `left:${x}px;top:${y}px;`;
    document.body.appendChild(d);
    _dimLabels.push(d);
  }

  // ── CSS VARS ──
  function getCSSVars() {
    const vars = {};
    try {
      Array.from(document.styleSheets).forEach(sheet => {
        try {
          Array.from(sheet.cssRules || []).forEach(rule => {
            if (rule.style) {
              Array.from(rule.style).filter(p => p.startsWith('--'))
                .forEach(p => { vars[p] = rule.style.getPropertyValue(p).trim(); });
            }
          });
        } catch (_) {}
      });
    } catch (_) {}
    return vars;
  }

  // ── PANEL BUILD ──
  function buildPanel() {
    if (document.getElementById(`${PREFIX}_panel`)) return;

    const panel = el('div', '', { id: `${PREFIX}_panel` });
    applyTheme(panel, _theme);

    // Header
    const header = el('div', '', { id: `${PREFIX}_header` });
    const tag    = el('span', '', { id: `${PREFIX}_tag`, text: '<div>' });
    const acts   = el('div', 'insp-actions');
    const btnPin   = el('button', '', { title: 'Pin  (Alt+click)', text: '📌', id: `${PREFIX}_btn_pin` });
    const btnTheme = el('button', '', { title: 'Toggle theme',     text: '☀',  id: `${PREFIX}_btn_theme` });
    const btnCopy  = el('button', '', { title: 'Copy selector',    text: '⧉',  id: `${PREFIX}_btn_copy` });
    const btnClose = el('button', '', { title: 'Close  (Esc)',     text: '✕',  id: `${PREFIX}_btn_close` });
    [btnPin, btnTheme, btnCopy, btnClose].forEach(b => acts.appendChild(b));
    header.append(tag, acts);
    panel.appendChild(header);

    // Breadcrumb
    panel.appendChild(el('div', '', { id: `${PREFIX}_breadcrumb` }));

    // Tabs with scroll arrows
    const tabsWrap = el('div', '', { id: `${PREFIX}_tabs_wrap` });
    const arrL = el('div', 'insp-tab-arr', { id: `${PREFIX}_tab_arr_l`, text: '‹' });
    const arrR = el('div', 'insp-tab-arr', { id: `${PREFIX}_tab_arr_r`, text: '›' });
    const tabs = el('div', '', { id: `${PREFIX}_tabs` });
    [
      ['layout','Layout'],
      ['typo','Typography'],
      ['computed','Computed'],
      ['selectors','Selectors'],
      ['dom','DOM Tree'],
      ['events','Events'],
      ['mutations','Mutations'],
      ['framework','Framework'],
      ['flexgrid','Flex/Grid'],
      ['audit','Audit'],
      ['a11y','A11y'],
      ['stacking','Stacking'],
      ['vars','CSS Vars'],
    ].forEach(([key, label], i) => {
      const t = el('div', 'insp-tab' + (i === 0 ? ' active' : ''));
      t.dataset.tab = key;
      t.textContent = label;
      tabs.appendChild(t);
    });
    tabsWrap.appendChild(arrL);
    tabsWrap.appendChild(tabs);
    tabsWrap.appendChild(arrR);
    panel.appendChild(tabsWrap);

    // Body
    const body = el('div', '', { id: `${PREFIX}_body` });
    body.appendChild(buildLayoutPane());
    body.appendChild(buildTypoPane());
    body.appendChild(buildComputedPane());
    body.appendChild(buildSelectorsPane());
    body.appendChild(buildDOMTreePane());
    body.appendChild(buildEventsPane());
    body.appendChild(buildMutationsPane());
    body.appendChild(buildFrameworkPane());
    body.appendChild(buildFlexGridPane());
    body.appendChild(buildAuditPane());
    body.appendChild(buildA11yPane());
    body.appendChild(buildStackingPane());
    body.appendChild(buildVarsPane());
    panel.appendChild(body);

    document.body.appendChild(panel);

    // Tooltip
    document.body.appendChild(el('div', '', { id: `${PREFIX}_tooltip` }));

    // Keyboard hint
    const hint = el('div', '', { id: `${PREFIX}_hint` });
    const trigName = _cfg.triggerKey;
    hint.textContent = `↑ Parent  ↓ Child  ← → Sibling  Esc Close  ${trigName}+click Pin`;
    panel.appendChild(hint);

    wireControls(panel, tabs, arrL, arrR);
  }

  // ── PANE BUILDERS ──
  function row(labelText, valId) {
    const r = el('div', 'insp-row');
    r.append(el('span', 'insp-lbl', { text: labelText }), el('span', 'insp-val', { id: valId, text: '—' }));
    return r;
  }

  function sec(text) {
    const s = el('div', 'insp-sec'); s.textContent = text; return s;
  }

  function bmRow(color, label, valId) {
    const r = el('div', 'insp-bm');
    const dot = el('span', 'insp-dot'); dot.style.background = color;
    r.append(dot, el('span', '', { text: label }), el('span', 'insp-bm-v', { id: valId, text: '—' }));
    return r;
  }

  function trRow(key, valId) {
    const r = el('div', 'insp-tr');
    r.append(el('span', 'insp-tk', { text: key }), el('span', 'insp-tv', { id: valId, text: '—' }));
    return r;
  }

  function ziRow(key, valId) {
    const r = el('div', 'insp-zi');
    r.append(el('span', 'insp-zk', { text: key }), el('span', 'insp-zv', { id: valId, text: '—' }));
    return r;
  }

  function buildLayoutPane() {
    const p = el('div', 'insp-pane active', { id: `${PREFIX}_pane_layout` });

    const info = el('div', 'insp-info-block');
    [
      ['Tag',        `${PREFIX}_info_tag`],
      ['ID',         `${PREFIX}_info_id`],
      ['Classes',    `${PREFIX}_info_classes`],
    ].forEach(([k, id]) => info.appendChild(trRow(k, id)));
    p.appendChild(info);

    p.appendChild(sec('Dimensions'));
    [
      ['Width',  `${PREFIX}_info_w`],
      ['Height', `${PREFIX}_info_h`],
    ].forEach(([k, id]) => p.appendChild(trRow(k, id)));

    p.appendChild(sec('Spacing'));
    [
      ['Margin',  `${PREFIX}_info_margin`],
      ['Padding', `${PREFIX}_info_padding`],
      ['Border',  `${PREFIX}_info_border`],
    ].forEach(([k, id]) => p.appendChild(trRow(k, id)));

    p.appendChild(sec('Layout'));
    [
      ['Display',  `${PREFIX}_info_display`],
      ['Position', `${PREFIX}_info_pos`],
      ['Z-Index',  `${PREFIX}_info_zi`],
    ].forEach(([k, id]) => p.appendChild(trRow(k, id)));

    p.appendChild(sec('Color'));
    p.appendChild((() => {
      const r = el('div','insp-tr');
      const wrap = el('span','insp-tv');
      const sw = el('span','insp-swatch', { id:`${PREFIX}_bg_swatch` });
      const bv = el('span','', { id:`${PREFIX}_info_bg`, text:'—' });
      wrap.append(sw, bv);
      r.append(el('span','insp-tk',{text:'Background'}), wrap);
      return r;
    })());
    p.appendChild((() => {
      const r = el('div','insp-tr');
      const wrap = el('span','insp-tv');
      const sw = el('span','insp-swatch', { id:`${PREFIX}_color_swatch` });
      const bv = el('span','', { id:`${PREFIX}_info_color`, text:'—' });
      wrap.append(sw, bv);
      r.append(el('span','insp-tk',{text:'Text Color'}), wrap);
      return r;
    })());

    p.appendChild(sec('Typography'));
    [
      ['Font Size', `${PREFIX}_info_fs`],
    ].forEach(([k, id]) => p.appendChild(trRow(k, id)));

    p.appendChild(sec('Box Model'));
    [
      bmRow('#f9e2af','Margin',  `${PREFIX}_margin`),
      bmRow('#fab387','Border',  `${PREFIX}_border_val`),
      bmRow('#a6e3a1','Padding', `${PREFIX}_padding`),
      bmRow('#89b4fa','Content', `${PREFIX}_content`),
    ].forEach(r => p.appendChild(r));

    p.appendChild(sec('Inherited'));
    p.appendChild((() => {
      const s = sec(''); s.style.borderTop='none'; s.style.paddingTop='0';
      s.append(document.createTextNode('from '));
      const from = el('span','',{id:`${PREFIX}_inh_from`,text:'body'});
      from.style.color='#89b4fa'; s.appendChild(from); return s;
    })());
    [
      trRow('font-family', `${PREFIX}_inh_ff`),
      trRow('font-size',   `${PREFIX}_inh_fs`),
      trRow('line-height', `${PREFIX}_inh_lh`),
      trRow('color',       `${PREFIX}_inh_color`),
    ].forEach(r => p.appendChild(r));

    return p;
  }

  function buildTypoPane() {
    const p = el('div', 'insp-pane', { id: `${PREFIX}_pane_typo` });
    [
      ['font-family',    `${PREFIX}_ff`],
      ['font-size',      `${PREFIX}_fs`],
      ['font-weight',    `${PREFIX}_fw`],
      ['line-height',    `${PREFIX}_lh`],
      ['letter-spacing', `${PREFIX}_ls`],
      ['text-align',     `${PREFIX}_ta`],
      ['text-transform', `${PREFIX}_tt`],
      ['text-decoration',`${PREFIX}_td`],
      ['color',          `${PREFIX}_color`],
      ['white-space',    `${PREFIX}_ws`],
      ['overflow',       `${PREFIX}_overflow`],
      ['cursor',         `${PREFIX}_cursor`],
    ].forEach(([k,id]) => p.appendChild(trRow(k, id)));
    return p;
  }

  function buildComputedPane() {
    const p = el('div', 'insp-pane', { id: `${PREFIX}_pane_computed` });
    const PROPS = [
      'display','position','width','height','min-width','max-width',
      'min-height','max-height','color','background-color','font-size',
      'font-weight','line-height','z-index','opacity','visibility',
      'overflow','overflow-x','overflow-y','box-sizing','flex-direction',
      'flex-wrap','align-items','justify-content','grid-template-columns',
      'grid-template-rows','padding','margin','border','border-radius',
      'transform','transition','animation','cursor','pointer-events',
    ];
    PROPS.forEach(prop => {
      const r = el('div', 'insp-computed-row');
      r.append(
        el('span', 'insp-ck', { text: prop }),
        el('span', 'insp-cv', { id: `${PREFIX}_cp_${prop.replace(/-/g,'_')}`, text: '—' })
      );
      p.appendChild(r);
    });
    return p;
  }

  function buildSelectorsPane() {
    const p = el('div', 'insp-pane', { id: `${PREFIX}_pane_selectors` });

    p.appendChild(sec('CSS Selector'));
    const selBox = el('div', 'insp-sel-box', { id: `${PREFIX}_full_sel`, text: '—' });
    p.appendChild(selBox);
    const selCopyBtn = el('button', 'insp-copy-btn', { text: 'Copy' });
    selCopyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyText(selBox.textContent, e.clientX, e.clientY);
    });
    p.appendChild(selCopyBtn);

    p.appendChild(sec('querySelector'));
    const qsBox = el('div', 'insp-sel-box insp-qs-box', { id: `${PREFIX}_qs_sel`, text: '—' });
    p.appendChild(qsBox);
    const qsCopyBtn = el('button', 'insp-copy-btn', { text: 'Copy' });
    qsCopyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyText(document.getElementById(`${PREFIX}_qs_raw`)?.textContent || '', e.clientX, e.clientY);
    });
    p.appendChild(qsCopyBtn);
    const qsRaw = el('span', '', { id: `${PREFIX}_qs_raw` });
    qsRaw.style.display = 'none';
    p.appendChild(qsRaw);

    p.appendChild(sec('XPath'));
    const xpBox = el('div', 'insp-sel-box', { id: `${PREFIX}_xpath_val`, text: '—' });
    p.appendChild(xpBox);
    const xpCopyBtn = el('button', 'insp-copy-btn', { text: 'Copy' });
    xpCopyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyText(xpBox.textContent, e.clientX, e.clientY);
    });
    p.appendChild(xpCopyBtn);

    // v3.0 — Export formats
    p.appendChild(sec('Export'));
    const exportRow = el('div', 'insp-export-row');
    [['JSON','json'],['HTML','html'],['Markdown','markdown'],['YAML','yaml']].forEach(([label, fmt]) => {
      const btn = el('button', 'insp-export-btn', { text: label });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const result = exportData(fmt === 'json' ? undefined : fmt);
        if (!result) return;
        const str = fmt === 'json' ? JSON.stringify(result, null, 2) : result;
        copyText(str, e.clientX, e.clientY);
      });
      exportRow.appendChild(btn);
    });
    p.appendChild(exportRow);

    return p;
  }

  function buildDOMTreePane() {
    const p = el('div', 'insp-pane', { id: `${PREFIX}_pane_dom` });
    p.appendChild(el('div', '', { id: `${PREFIX}_dom_tree` }));
    return p;
  }

  // v2.4 — Events pane
  function buildEventsPane() {
    const p = el('div', 'insp-pane', { id: `${PREFIX}_pane_events` });
    const note = el('div', 'insp-events-note', { id: `${PREFIX}_events_note` });
    p.appendChild(note);
    p.appendChild(el('div', '', { id: `${PREFIX}_events_list` }));
    return p;
  }

  // v2.4 — Mutations pane
  function buildMutationsPane() {
    const p = el('div', 'insp-pane', { id: `${PREFIX}_pane_mutations` });

    const controls = el('div', 'insp-mut-controls');
    const clearBtn = el('button', 'insp-copy-btn', { text: 'Clear history' });
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      _mutationHistory = [];
      renderMutationPane();
    });
    controls.appendChild(clearBtn);
    p.appendChild(controls);
    p.appendChild(el('div', '', { id: `${PREFIX}_mut_list` }));
    return p;
  }

  // v2.5 — Framework pane
  function buildFrameworkPane() {
    const p = el('div', 'insp-pane', { id: `${PREFIX}_pane_framework` });
    p.appendChild(el('div', '', { id: `${PREFIX}_fw_content` }));
    return p;
  }

  // v3.0 — Flex/Grid inspector pane
  function buildFlexGridPane() {
    const p = el('div', 'insp-pane', { id: `${PREFIX}_pane_flexgrid` });
    p.appendChild(el('div', '', { id: `${PREFIX}_layout_inspector` }));
    return p;
  }

  // v3.0 — Accessibility audit pane
  function buildAuditPane() {
    const p = el('div', 'insp-pane', { id: `${PREFIX}_pane_audit` });
    const hdr = el('div', 'insp-audit-header');
    const title = el('span', '', { text: 'Accessibility Audit' });
    const runBtn = el('button', 'insp-copy-btn insp-audit-run', { text: 'Re-run' });
    runBtn.style.width = 'auto';
    runBtn.style.padding = '2px 10px';
    hdr.append(title, runBtn);
    p.appendChild(hdr);
    p.appendChild(el('div', '', { id: `${PREFIX}_a11y_audit` }));
    runBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (_current) renderA11yAuditSection(_current);
    });
    return p;
  }

  function buildA11yPane() {
    const p = el('div', 'insp-pane', { id: `${PREFIX}_pane_a11y` });
    [
      ziRow('role',             `${PREFIX}_a11y_role`),
      ziRow('aria-label',       `${PREFIX}_a11y_label`),
      ziRow('aria-labelledby',  `${PREFIX}_a11y_labelledby`),
      ziRow('aria-describedby', `${PREFIX}_a11y_describedby`),
      ziRow('aria-hidden',      `${PREFIX}_a11y_hidden`),
      ziRow('aria-expanded',    `${PREFIX}_a11y_expanded`),
      ziRow('aria-checked',     `${PREFIX}_a11y_checked`),
      ziRow('aria-live',        `${PREFIX}_a11y_live`),
      ziRow('tabindex',         `${PREFIX}_a11y_tabindex`),
      ziRow('focusable',        `${PREFIX}_a11y_focusable`),
      ziRow('disabled',         `${PREFIX}_a11y_disabled`),
      ziRow('required',         `${PREFIX}_a11y_required`),
      sec('Accessible Name'),
      (() => {
        const r = el('div','insp-a11y-name');
        r.appendChild(el('span','insp-a11y-name-v',{id:`${PREFIX}_a11y_accname`,text:'—'}));
        return r;
      })(),
    ].forEach(c => p.appendChild(c));
    return p;
  }

  function buildStackingPane() {
    const p = el('div', 'insp-pane', { id: `${PREFIX}_pane_stacking` });
    [
      ziRow('z-index',      `${PREFIX}_zi`),
      ziRow('opacity',      `${PREFIX}_opacity`),
      ziRow('transform',    `${PREFIX}_transform`),
      ziRow('transition',   `${PREFIX}_transition`),
      ziRow('animation',    `${PREFIX}_animation`),
      sec('Stacking Context'),
      (() => {
        const r = el('div','insp-zi');
        r.append(el('span','insp-zk',{text:'Creates new context'}), el('span','',{id:`${PREFIX}_stacking_ctx`,text:'—'}));
        return r;
      })(),
      ziRow('overflow',       `${PREFIX}_overflow2`),
      ziRow('pointer-events', `${PREFIX}_pe`),
      ziRow('visibility',     `${PREFIX}_vis`),
      ziRow('border-radius',  `${PREFIX}_br`),
      ziRow('box-shadow',     `${PREFIX}_bs`),
      ziRow('filter',         `${PREFIX}_filter`),
    ].forEach(c => p.appendChild(c));
    return p;
  }

  function buildVarsPane() {
    const p = el('div', 'insp-pane', { id: `${PREFIX}_pane_vars` });
    const list = el('div', '', { id: `${PREFIX}_vars_list` });
    const empty = el('span', '', { text: 'No CSS variables found.' });
    empty.style.cssText = 'color:#6c7086;font-size:12px;';
    list.appendChild(empty);
    p.appendChild(list);
    return p;
  }

  // ── WIRE CONTROLS ──
  function wireControls(panel, tabs, arrL, arrR) {
    arrL.addEventListener('click', (e) => { e.stopPropagation(); tabs.scrollBy({ left: -90, behavior: 'smooth' }); });
    arrR.addEventListener('click', (e) => { e.stopPropagation(); tabs.scrollBy({ left: 90, behavior: 'smooth' }); });

    tabs.querySelectorAll('.insp-tab').forEach(tab => {
      addListener(tab, 'click', (e) => {
        e.stopPropagation();
        tabs.querySelectorAll('.insp-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.insp-pane').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        _activeTab = tab.dataset.tab;
        const pane = document.getElementById(`${PREFIX}_pane_${tab.dataset.tab}`);
        if (pane) pane.classList.add('active');
      });
    });

    addListener(document.getElementById(`${PREFIX}_btn_theme`), 'click', (e) => {
      e.stopPropagation();
      _theme = _isDark ? 'light' : 'dark';
      applyTheme(panel, _theme);
      document.getElementById(`${PREFIX}_btn_theme`).textContent = _isDark ? '☀' : '🌙';
    });

    addListener(document.getElementById(`${PREFIX}_btn_close`), 'click', (e) => {
      e.stopPropagation(); closePanel();
    });

    addListener(document.getElementById(`${PREFIX}_btn_copy`), 'click', (e) => {
      e.stopPropagation();
      const sel = document.getElementById(`${PREFIX}_full_sel`)?.textContent || '';
      copyText(sel, e.clientX, e.clientY);
    });

    addListener(document.getElementById(`${PREFIX}_btn_pin`), 'click', (e) => {
      e.stopPropagation();
      if (_pinned) {
        _pinned = null;
        document.getElementById(`${PREFIX}_btn_pin`).style.opacity = '0.5';
      } else {
        _pinned = _current;
        document.getElementById(`${PREFIX}_btn_pin`).style.opacity = '1';
      }
    });

    const header = document.getElementById(`${PREFIX}_header`);
    addListener(header, 'mousedown', (e) => {
      if (e.target.closest('.insp-actions')) return;
      _isDragging = true;
      const r = panel.getBoundingClientRect();
      _dragOffX = e.clientX - r.left;
      _dragOffY = e.clientY - r.top;
      e.preventDefault();
    });

    // #10 — panel itself stops click propagation only, pointer-events handled via CSS
    addListener(panel, 'click', (e) => e.stopPropagation());
  }

  // ── HELPERS ──
  function copyText(text, x, y) {
    if (!text || text === '—') return;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text)
        .then(() => showTooltip('Copied!', x, y))
        .catch(() => showTooltip('Copy failed', x, y));
    } else {
      showTooltip('Clipboard N/A', x, y);
    }
  }

  // ── POSITION ──
  // #1, #3 — Smart positioning relative to element, with viewport boundary detection
  function positionPanel(targetRect) {
    if (_isDragging) return;
    const panel = document.getElementById(`${PREFIX}_panel`);
    if (!panel) return;

    const vw = window.innerWidth, vh = window.innerHeight;
    const MARGIN = 10;
    // Use actual rendered height (respects max-height:calc(100vh-24px))
    const ph = Math.min(panel.offsetHeight || 400, vh - MARGIN * 2);

    // If we have a target rect, position relative to element (DevTools style)
    if (targetRect) {
      const candidates = [
        // 1. Right of element
        { left: targetRect.right + MARGIN, top: targetRect.top },
        // 2. Left of element
        { left: targetRect.left - PW - MARGIN, top: targetRect.top },
        // 3. Above element
        { left: targetRect.left, top: targetRect.top - ph - MARGIN },
        // 4. Below element
        { left: targetRect.left, top: targetRect.bottom + MARGIN },
      ];

      for (const pos of candidates) {
        // Clamp to viewport
        const cl = Math.max(MARGIN, Math.min(pos.left, vw - PW - MARGIN));
        const ct = Math.max(MARGIN, Math.min(pos.top, vh - ph - MARGIN));
        // Check if this position fits without overlap with element (only for first 2 candidates)
        const fits = cl >= MARGIN && cl + PW <= vw - MARGIN && ct >= MARGIN && ct + ph <= vh - MARGIN;
        if (fits || candidates.indexOf(pos) === candidates.length - 1) {
          panel.style.left = cl + 'px';
          panel.style.top  = ct + 'px';
          return;
        }
      }
    } else {
      // Fallback: near mouse
      const off = 18;
      let left = _mouseX + off;
      let top  = _mouseY + off;
      // Clamp
      left = Math.min(Math.max(left, MARGIN), vw - PW - MARGIN);
      top  = Math.min(Math.max(top, MARGIN), vh - PH - MARGIN);
      panel.style.left = left + 'px';
      panel.style.top  = top + 'px';
    }
  }

  // ── BREADCRUMB ──
  function buildBreadcrumb(node) {
    const chain = [];
    let cur = node;
    while (cur && cur !== document.body && chain.length < 5) {
      chain.unshift(cur); cur = cur.parentElement;
    }
    chain.unshift(document.body);
    const bc = document.getElementById(`${PREFIX}_breadcrumb`);
    while (bc.firstChild) bc.removeChild(bc.firstChild);
    chain.forEach((n, i) => {
      const s = el('span', 'insp-bc-item');
      s.textContent = n.tagName.toLowerCase() + (n.id && !n.id.startsWith(PREFIX) ? '#'+n.id : '');
      s.addEventListener('click', (e) => { e.stopPropagation(); _pinned = n; _current = n; renderPanel(n); });
      bc.appendChild(s);
      if (i < chain.length - 1) {
        const sep = el('span', 'insp-bc-sep'); sep.textContent = '›'; bc.appendChild(sep);
      }
    });
  }

  // ── DOM TREE ──
  function buildDOMTree(node) {
    const tree = document.getElementById(`${PREFIX}_dom_tree`);
    if (!tree) return;
    while (tree.firstChild) tree.removeChild(tree.firstChild);
    const root = node.parentElement || node;
    renderTreeNode(root, tree, node, 0, 2);
  }

  function renderTreeNode(n, container, selected, depth, maxDepth) {
    if (!n || n.id === `${PREFIX}_panel` || n.id === `${PREFIX}_tooltip`) return;
    if (depth > maxDepth) return;

    const item = el('div', 'insp-tree-item');
    item.style.paddingLeft = (depth * 14 + 4) + 'px';
    if (n === selected) item.classList.add('insp-tree-selected');

    // Shadow root indicator
    const hasShadow = n.shadowRoot != null;
    const hasChildren = (n.children && n.children.length > 0) || hasShadow;
    const toggle = el('span', 'insp-tree-toggle');
    toggle.textContent = hasChildren ? '▾' : ' ';
    item.appendChild(toggle);

    const label = el('span', 'insp-tree-label');
    let txt = n.tagName.toLowerCase();
    if (n.id && !n.id.startsWith(PREFIX)) txt += '#' + n.id;
    else if (n.className && typeof n.className === 'string') {
      const cls = n.className.trim().split(/\s+/).filter(c => !c.startsWith(PREFIX) && c);
      if (cls.length) txt += '.' + cls.slice(0, 2).join('.');
    }
    if (hasShadow) txt += ' ◎'; // shadow host indicator
    label.textContent = txt;
    item.appendChild(label);
    container.appendChild(item);

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      _pinned = n; _current = n; renderPanel(n);
    });

    if (hasChildren && depth < maxDepth) {
      // Show shadow root children with indentation
      if (hasShadow) {
        const shadowLabel = el('div', 'insp-tree-item');
        shadowLabel.style.paddingLeft = ((depth + 1) * 14 + 4) + 'px';
        const sl = el('span', 'insp-tree-label');
        sl.textContent = '#shadow-root';
        sl.style.opacity = '0.5';
        sl.style.fontStyle = 'italic';
        shadowLabel.appendChild(sl);
        container.appendChild(shadowLabel);
        Array.from(n.shadowRoot.children || []).forEach(child => {
          renderTreeNode(child, container, selected, depth + 2, maxDepth + 1);
        });
      }
      Array.from(n.children).forEach(child => {
        if (!child.id || !child.id.startsWith(PREFIX)) {
          renderTreeNode(child, container, selected, depth + 1, maxDepth);
        }
      });
    }
  }

  // ── ACCESSIBILITY ──
  function getAccessibleName(node) {
    if (node.getAttribute('aria-label')) return node.getAttribute('aria-label');
    const lby = node.getAttribute('aria-labelledby');
    if (lby) { const ref = document.getElementById(lby); if (ref) return ref.textContent.trim(); }
    if (node.id) { const lbl = document.querySelector(`label[for="${node.id}"]`); if (lbl) return lbl.textContent.trim(); }
    if (node.title) return node.title;
    if (node.alt) return node.alt;
    const txt = node.textContent.trim();
    return txt ? txt.slice(0, 60) : '—';
  }

  function isFocusable(node) {
    const tag = node.tagName.toLowerCase();
    if (['a','button','input','select','textarea'].includes(tag)) return true;
    if (node.getAttribute('tabindex') !== null) return true;
    if (node.getAttribute('contenteditable') === 'true') return true;
    return false;
  }

  function inferRole(node) {
    const map = {
      a:'link',button:'button',input:'textbox',select:'listbox',textarea:'textbox',
      img:'img',nav:'navigation',main:'main',header:'banner',footer:'contentinfo',
      aside:'complementary',form:'form',table:'table',ul:'list',ol:'list',li:'listitem',
      h1:'heading',h2:'heading',h3:'heading',h4:'heading',h5:'heading',h6:'heading',
    };
    return map[node.tagName.toLowerCase()] || '(none)';
  }

  // ── TRIGGER KEY CHECK ──
  function isTriggerKey(e) {
    const k = _cfg.triggerKey;
    if (k === 'Alt')     return e.altKey;
    if (k === 'Control') return e.ctrlKey;
    if (k === 'Meta')    return e.metaKey;
    if (k === 'Shift')   return e.shiftKey;
    return e.altKey;
  }

  // ── RENDER ──
  // #9 — use getBoundingClientRect() for all geometry (handles transform/fixed/sticky)
  function renderPanel(node) {
    const rect  = node.getBoundingClientRect(); // #9
    const style = getComputedStyle(node);
    const m  = { t:parseFloat(style.marginTop),       l:parseFloat(style.marginLeft),
                 r:parseFloat(style.marginRight),      b:parseFloat(style.marginBottom) };
    const bo = { t:parseFloat(style.borderTopWidth),  l:parseFloat(style.borderLeftWidth),
                 r:parseFloat(style.borderRightWidth), b:parseFloat(style.borderBottomWidth) };
    const pa = { t:parseFloat(style.paddingTop),      l:parseFloat(style.paddingLeft),
                 r:parseFloat(style.paddingRight),     b:parseFloat(style.paddingBottom) };

    clearLayers();
    makeLayer(rect.left-m.l, rect.top-m.t, rect.width+m.l+m.r, rect.height+m.t+m.b, 'margin');
    makeLayer(rect.left, rect.top, rect.width, rect.height, 'border');
    makeLayer(rect.left+bo.l, rect.top+bo.t, rect.width-bo.l-bo.r, rect.height-bo.t-bo.b, 'padding');
    makeLayer(rect.left+bo.l+pa.l, rect.top+bo.t+pa.t,
      rect.width-bo.l-bo.r-pa.l-pa.r, rect.height-bo.t-bo.b-pa.t-pa.b, 'content');
    makeDimLabel(rect.left, rect.top - 22,
      `${Math.round(rect.width)} × ${parseFloat(rect.height).toFixed(1)}`);

    buildBreadcrumb(node);

    const bgColor   = style.backgroundColor;
    const textColor = style.color;
    const bgHex  = (bgColor  === 'transparent' || bgColor  === 'rgba(0, 0, 0, 0)') ? 'transparent' : rgbToHex(bgColor);
    const txtHex = rgbToHex(textColor);
    const cw = Math.round(rect.width  - bo.l-bo.r-pa.l-pa.r);
    const ch = Math.round(rect.height - bo.t-bo.b-pa.t-pa.b);
    const parent = node.parentElement;
    const pStyle = parent ? getComputedStyle(parent) : null;

    document.getElementById(`${PREFIX}_tag`).textContent = `<${node.tagName.toLowerCase()}>`;

    setText(`${PREFIX}_info_tag`,     node.tagName.toLowerCase());
    setText(`${PREFIX}_info_id`,      node.id && !node.id.startsWith(PREFIX) ? node.id : '—');
    const cls = node.className && typeof node.className === 'string'
      ? node.className.trim().split(/\s+/).filter(c => !c.startsWith(PREFIX) && c).join(' ')
      : '';
    setText(`${PREFIX}_info_classes`, cls || '—');
    setText(`${PREFIX}_info_w`,       Math.round(rect.width)  + 'px');
    setText(`${PREFIX}_info_h`,       parseFloat(rect.height).toFixed(1) + 'px');
    setText(`${PREFIX}_info_margin`,  style.margin);
    setText(`${PREFIX}_info_padding`, style.padding);
    setText(`${PREFIX}_info_border`,  style.borderWidth);
    setText(`${PREFIX}_info_display`, style.display);
    setText(`${PREFIX}_info_pos`,     style.position);
    setText(`${PREFIX}_info_zi`,      style.zIndex);
    setText(`${PREFIX}_info_fs`,      parseFloat(style.fontSize).toFixed(1) + 'px');

    const bgSw = document.getElementById(`${PREFIX}_bg_swatch`);
    if (bgSw) bgSw.style.background = bgHex === 'transparent' ? 'none' : bgHex;
    setText(`${PREFIX}_info_bg`, bgHex);

    const colorSw = document.getElementById(`${PREFIX}_color_swatch`);
    if (colorSw) colorSw.style.background = txtHex;
    setText(`${PREFIX}_info_color`, txtHex);

    setText(`${PREFIX}_margin`,    style.margin);
    setText(`${PREFIX}_border_val`,style.borderWidth);
    setText(`${PREFIX}_padding`,   style.padding);
    setText(`${PREFIX}_content`,   `${cw} × ${ch}`);

    if (pStyle) {
      setText(`${PREFIX}_inh_from`,  parent.tagName.toLowerCase());
      setText(`${PREFIX}_inh_ff`,    shortFont(pStyle.fontFamily));
      setText(`${PREFIX}_inh_fs`,    parseFloat(pStyle.fontSize).toFixed(0)+'px');
      setText(`${PREFIX}_inh_lh`,    parseFloat(pStyle.lineHeight).toFixed(0)+'px');
      setText(`${PREFIX}_inh_color`, rgbToHex(pStyle.color));
    }

    setText(`${PREFIX}_ff`,       shortFont(style.fontFamily));
    setText(`${PREFIX}_fs`,       parseFloat(style.fontSize).toFixed(2)+'px');
    setText(`${PREFIX}_fw`,       style.fontWeight);
    setText(`${PREFIX}_lh`,       parseFloat(style.lineHeight).toFixed(2)+'px');
    setText(`${PREFIX}_ls`,       style.letterSpacing);
    setText(`${PREFIX}_ta`,       style.textAlign);
    setText(`${PREFIX}_tt`,       style.textTransform);
    setText(`${PREFIX}_td`,       style.textDecoration);
    setText(`${PREFIX}_color`,    txtHex);
    setText(`${PREFIX}_ws`,       style.whiteSpace);
    setText(`${PREFIX}_overflow`, style.overflow);
    setText(`${PREFIX}_cursor`,   style.cursor);

    const COMPUTED_PROPS = [
      'display','position','width','height','min-width','max-width',
      'min-height','max-height','color','background-color','font-size',
      'font-weight','line-height','z-index','opacity','visibility',
      'overflow','overflow-x','overflow-y','box-sizing','flex-direction',
      'flex-wrap','align-items','justify-content','grid-template-columns',
      'grid-template-rows','padding','margin','border','border-radius',
      'transform','transition','animation','cursor','pointer-events',
    ];
    COMPUTED_PROPS.forEach(prop => {
      const id = `${PREFIX}_cp_${prop.replace(/-/g,'_')}`;
      const el2 = document.getElementById(id);
      if (el2) {
        let v = style.getPropertyValue(prop);
        if (prop === 'color' || prop === 'background-color') v = rgbToHex(v);
        el2.textContent = shortVal(v) || '—';
      }
    });

    const fullSel = isInShadow(node) ? getShadowSelector(node) : generateStableSelector(node);
    const xpath   = getXPath(node);
    const qsStr   = `document.querySelector(\n  '${fullSel}'\n)`;
    const el3 = document.getElementById(`${PREFIX}_full_sel`);
    if (el3) el3.textContent = fullSel;
    const qsBox = document.getElementById(`${PREFIX}_qs_sel`);
    if (qsBox) qsBox.textContent = qsStr;
    const qsRaw = document.getElementById(`${PREFIX}_qs_raw`);
    if (qsRaw) qsRaw.textContent = fullSel;
    const xpEl = document.getElementById(`${PREFIX}_xpath_val`);
    if (xpEl) xpEl.textContent = xpath;

    setText(`${PREFIX}_zi`,        style.zIndex);
    setText(`${PREFIX}_opacity`,   style.opacity);
    setText(`${PREFIX}_transform`, shortVal(style.transform));
    setText(`${PREFIX}_transition`,shortVal(style.transition));
    setText(`${PREFIX}_animation`, shortVal(style.animation));
    const ctxEl = document.getElementById(`${PREFIX}_stacking_ctx`);
    if (ctxEl) {
      const yes = isStackingCtx(style);
      const badge = el('span', `insp-badge ${yes ? 'insp-yes' : 'insp-no'}`, { text: yes ? 'yes' : 'no' });
      while (ctxEl.firstChild) ctxEl.removeChild(ctxEl.firstChild);
      ctxEl.appendChild(badge);
    }
    setText(`${PREFIX}_overflow2`, style.overflow);
    setText(`${PREFIX}_pe`,        style.pointerEvents);
    setText(`${PREFIX}_vis`,       style.visibility);
    setText(`${PREFIX}_br`,        style.borderRadius);
    setText(`${PREFIX}_bs`,        shortVal(style.boxShadow));
    setText(`${PREFIX}_filter`,    shortVal(style.filter));

    const varList = document.getElementById(`${PREFIX}_vars_list`);
    if (varList) {
      while (varList.firstChild) varList.removeChild(varList.firstChild);
      const vars = getCSSVars();
      const keys = Object.keys(vars);
      if (keys.length === 0) {
        const empty = el('span', '', { text: 'No CSS variables found.' });
        empty.style.cssText = 'color:#6c7086;font-size:12px;';
        varList.appendChild(empty);
      } else {
        keys.forEach(k => {
          const r2 = el('div', 'insp-var');
          r2.append(el('span', 'insp-vn', { text: k }), el('span', 'insp-vv', { text: shortVal(vars[k], 18) }));
          varList.appendChild(r2);
        });
      }
    }

    buildDOMTree(node);
    renderEventsPane(node);
    renderFrameworkPane(node);
    renderLayoutInspectorPane(node, style);
    renderA11yAuditSection(node);
    if (_activeTab === 'mutations') renderMutationPane();

    const getAttr = (a) => node.getAttribute(a) || '—';
    setText(`${PREFIX}_a11y_role`,        node.getAttribute('role') || inferRole(node));
    setText(`${PREFIX}_a11y_label`,       getAttr('aria-label'));
    setText(`${PREFIX}_a11y_labelledby`,  getAttr('aria-labelledby'));
    setText(`${PREFIX}_a11y_describedby`, getAttr('aria-describedby'));
    setText(`${PREFIX}_a11y_hidden`,      getAttr('aria-hidden'));
    setText(`${PREFIX}_a11y_expanded`,    getAttr('aria-expanded'));
    setText(`${PREFIX}_a11y_checked`,     getAttr('aria-checked'));
    setText(`${PREFIX}_a11y_live`,        getAttr('aria-live'));
    setText(`${PREFIX}_a11y_tabindex`,    node.getAttribute('tabindex') ?? '—');
    setText(`${PREFIX}_a11y_focusable`,   isFocusable(node) ? 'yes' : 'no');
    setText(`${PREFIX}_a11y_disabled`,    node.disabled !== undefined ? String(node.disabled) : '—');
    setText(`${PREFIX}_a11y_required`,    node.required  !== undefined ? String(node.required)  : '—');
    const nameEl = document.getElementById(`${PREFIX}_a11y_accname`);
    if (nameEl) nameEl.textContent = getAccessibleName(node);

    const panel = document.getElementById(`${PREFIX}_panel`);
    panel.style.display = 'flex';

    // #1 — position panel relative to element rect
    positionPanel(rect);

    emit('inspect', { element: node, selector: fullSel, xpath });
  }

  function closePanel() {
    const panel = document.getElementById(`${PREFIX}_panel`);
    if (panel) panel.style.display = 'none';
    clearLayers();
    _pinned = null; _current = null;
    emit('close', {});
  }

  // ── TOOLTIP ──
  function showTooltip(text, x, y) {
    const tt = document.getElementById(`${PREFIX}_tooltip`);
    if (!tt) return;
    tt.textContent = text;
    tt.style.cssText = `left:${x+10}px;top:${y-24}px;display:block;`;
    setTimeout(() => { tt.style.display = 'none'; }, 1200);
  }

  // ── LISTENER REGISTRY ──
  function addListener(target, type, fn, options) {
    target.addEventListener(type, fn, options);
    _listeners.push({ target, type, fn, options });
  }

  function removeAllListeners() {
    _listeners.forEach(({ target, type, fn, options }) => target.removeEventListener(type, fn, options));
    _listeners = [];
  }

  // ── GLOBAL EVENTS ──
  function attachGlobalListeners() {
    // v2.4 — Mobile / Touch support
    addListener(document, 'touchstart', (e) => {
      if (!_enabled) return;
      const touch = e.touches[0];
      _touchStartX = touch.clientX;
      _touchStartY = touch.clientY;
    }, { passive: true });

    addListener(document, 'touchmove', (e) => {
      if (!_enabled || _pinned) return;
      const touch = e.touches[0];
      const node  = document.elementFromPoint(touch.clientX, touch.clientY);
      if (!node || isInspectorNode(node)) return;
      _mouseX = touch.clientX; _mouseY = touch.clientY;
      _pendingNode = node;
      if (_hoverTimer) clearTimeout(_hoverTimer);
      _hoverTimer = setTimeout(() => {
        _hoverTimer = null;
        if (!_enabled || !_pendingNode || _pinned) return;
        const n = _pendingNode;
        if (_current !== n) {
          _current = n;
          clearLayers();
          const panel = document.getElementById(`${PREFIX}_panel`);
          if (panel) panel.style.display = 'none';
          renderPanel(n);
        }
      }, HOVER_DEBOUNCE);
    }, { passive: true });

    addListener(document, 'touchend', (e) => {
      if (!_enabled) return;
      const touch = e.changedTouches[0];
      const dx = Math.abs(touch.clientX - _touchStartX);
      const dy = Math.abs(touch.clientY - _touchStartY);
      // Only treat as a tap (not a scroll)
      if (dx > 10 || dy > 10) return;
      const node = document.elementFromPoint(touch.clientX, touch.clientY);
      if (!node || isInspectorNode(node)) return;
      e.preventDefault();
      if (_pinned === node) { _pinned = null; closePanel(); return; }
      if (_hoverTimer) { clearTimeout(_hoverTimer); _hoverTimer = null; }
      _current = node; _pinned = node;
      renderPanel(node);
      const btn = document.getElementById(`${PREFIX}_btn_pin`);
      if (btn) btn.style.opacity = '1';
    }, { passive: false });

    // #12 — requestAnimationFrame throttling for mousemove
    addListener(document, 'mousemove', (e) => {
      _mouseX = e.clientX; _mouseY = e.clientY;

      if (_isDragging) {
        const panel = document.getElementById(`${PREFIX}_panel`);
        if (panel) { panel.style.left=(e.clientX-_dragOffX)+'px'; panel.style.top=(e.clientY-_dragOffY)+'px'; }
        return;
      }
      if (!_enabled) return;
      if (!isTriggerKey(e)) return;
      const node = e.target;
      if (isInspectorNode(node)) return;
      if (_pinned) return;

      // #7 — debounce hover to prevent nested element flickering
      _pendingNode = node;
      if (_hoverTimer) clearTimeout(_hoverTimer);
      _hoverTimer = setTimeout(() => {
        _hoverTimer = null;
        if (!_enabled || !_pendingNode || _pinned) return;
        const n = _pendingNode;
        if (_rafId) return;
        _rafId = requestAnimationFrame(() => {
          _rafId = null;
          if (!_enabled || _pinned) return;
          if (_current !== n) {
            _current = n;
            clearLayers();
            const panel = document.getElementById(`${PREFIX}_panel`);
            if (panel) panel.style.display = 'none';
            renderPanel(n);
          } else if (document.getElementById(`${PREFIX}_panel`)?.style.display === 'flex') {
            // #2 — update position on hover movement
            positionPanel(n.getBoundingClientRect());
          }
        });
      }, HOVER_DEBOUNCE);
    });

    addListener(document, 'mouseup', () => { _isDragging = false; });

    addListener(document, 'mouseleave', () => {
      if (_pinned) return;
      if (_hoverTimer) { clearTimeout(_hoverTimer); _hoverTimer = null; }
      clearTimeout(_timer); _current = null; clearLayers();
      const panel = document.getElementById(`${PREFIX}_panel`);
      if (panel) panel.style.display = 'none';
    });

    // Trigger+click → pin
    addListener(document, 'click', (e) => {
      if (!_enabled) return;
      const shouldPin = _cfg.freezeOnClick ? true : isTriggerKey(e);
      if (!shouldPin) return;
      const node = e.target;
      if (isInspectorNode(node)) return;
      e.preventDefault();
      if (_pinned === node) { _pinned = null; closePanel(); return; }
      if (_hoverTimer) { clearTimeout(_hoverTimer); _hoverTimer = null; }
      clearTimeout(_timer);
      _current = node; _pinned = node;
      renderPanel(node);
      const btn = document.getElementById(`${PREFIX}_btn_pin`);
      if (btn) btn.style.opacity = '1';
    }, true);

    // Keyboard navigation + Escape (#11)
    addListener(document, 'keydown', (e) => {
      if (!_enabled) return;
      const panel = document.getElementById(`${PREFIX}_panel`);
      const visible = panel && panel.style.display === 'flex';

      // #11 — Escape closes inspector
      if (e.key === 'Escape') { closePanel(); return; }
      if (!visible || !_current) return;

      const keyMap = {
        ArrowUp:    () => _current.parentElement,
        ArrowDown:  () => _current.firstElementChild,
        ArrowLeft:  () => _current.previousElementSibling,
        ArrowRight: () => _current.nextElementSibling,
      };
      const next = keyMap[e.key]?.();
      if (next && !isInspectorNode(next)) {
        e.preventDefault();
        _current = next; _pinned = next;
        renderPanel(next);
        const btn = document.getElementById(`${PREFIX}_btn_pin`);
        if (btn) btn.style.opacity = '1';
      }
    });

    // #2, #8 — scroll & resize: recalculate overlay position
    const _onScrollResize = () => {
      const panel = document.getElementById(`${PREFIX}_panel`);
      if (!panel || panel.style.display !== 'flex') return;
      if (!_enabled) return;
      if (!_current) return;

      // Both hover and pinned: recalculate layers to follow the element
      if (_rafId) return;
      _rafId = requestAnimationFrame(() => {
        _rafId = null;
        if (!_current || !_enabled) return;
        const node  = _current;
        const rect  = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        const m  = { t:parseFloat(style.marginTop),       l:parseFloat(style.marginLeft),
                     r:parseFloat(style.marginRight),      b:parseFloat(style.marginBottom) };
        const bo = { t:parseFloat(style.borderTopWidth),  l:parseFloat(style.borderLeftWidth),
                     r:parseFloat(style.borderRightWidth), b:parseFloat(style.borderBottomWidth) };
        const pa = { t:parseFloat(style.paddingTop),      l:parseFloat(style.paddingLeft),
                     r:parseFloat(style.paddingRight),     b:parseFloat(style.paddingBottom) };
        clearLayers();
        makeLayer(rect.left-m.l, rect.top-m.t, rect.width+m.l+m.r, rect.height+m.t+m.b, 'margin');
        makeLayer(rect.left, rect.top, rect.width, rect.height, 'border');
        makeLayer(rect.left+bo.l, rect.top+bo.t, rect.width-bo.l-bo.r, rect.height-bo.t-bo.b, 'padding');
        makeLayer(rect.left+bo.l+pa.l, rect.top+bo.t+pa.t,
          rect.width-bo.l-bo.r-pa.l-pa.r, rect.height-bo.t-bo.b-pa.t-pa.b, 'content');
        makeDimLabel(rect.left, rect.top - 22,
          `${Math.round(rect.width)} × ${parseFloat(rect.height).toFixed(1)}`);
      });
    };
    // Prevent panel's own scroll from triggering overlay recalculation.
    // Must be registered BEFORE _onScrollResize so stopImmediatePropagation takes effect.
    const panelScrollStop = (e) => {
      const panel = document.getElementById(`${PREFIX}_panel`);
      if (panel && panel.contains(e.target)) e.stopImmediatePropagation();
    };
    addListener(window, 'scroll', panelScrollStop, { capture: true });

    // Page scroll: only update overlays, panel stays in place
    addListener(window, 'scroll', _onScrollResize, { passive: true, capture: true });

    // Resize: update overlays AND reposition panel (viewport size changed)
    addListener(window, 'resize', () => {
      _onScrollResize();
      if (!_pinned || !_enabled) return;
      const panel = document.getElementById(`${PREFIX}_panel`);
      if (!panel || panel.style.display !== 'flex') return;
      positionPanel(_pinned.getBoundingClientRect());
    }, { passive: true });
  }

  // ── CSS INJECTION ──
  function injectCSS() {
    const id = `${PREFIX}_styles`;
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id; link.rel = 'stylesheet';
    link.href = _cfg.cssUrl
      || (typeof __INSP_CSS_URL__ !== 'undefined' ? __INSP_CSS_URL__
          : new URL('inspector.css', document.currentScript?.src || location.href).href);
    document.head.appendChild(link);
  }

  // ════════════════════════════════
  // PUBLIC API
  // ════════════════════════════════
  function init(options) {
    if (!isBrowser()) return;

    let enabled;
    if (options === null || options === undefined || typeof options === 'boolean' || typeof options === 'function') {
      enabled = options;
    } else {
      const { enabled: e, theme, ...rest } = options;
      enabled = (e === undefined) ? true : e;
      _cfg = { ...DEFAULTS, ...rest };
      // v2.4 — theme system
      if (theme !== undefined) _theme = theme;
    }

    const active = (typeof enabled === 'function') ? enabled() : Boolean(enabled);
    if (!active) { if (_mounted) destroy(); return; }
    if (_mounted) return;

    _mounted = true;
    _enabled = true;
    injectCSS();
    buildPanel();
    attachGlobalListeners();
    startMutationObserver(); // v2.4
  }

  function enable()  { if (!isBrowser()) return; if (!_mounted) { init(true); return; } _enabled = true; }
  function disable() { if (!isBrowser()) return; _enabled = false; closePanel(); }

  function destroy() {
    if (!isBrowser()) return;
    closePanel();
    removeAllListeners();
    stopMutationObserver(); // v2.4
    [`${PREFIX}_panel`, `${PREFIX}_tooltip`, `${PREFIX}_styles`, `${PREFIX}_custom_theme`]
      .forEach(id => { const n = document.getElementById(id); if (n) n.parentNode.removeChild(n); });
    _mounted = false; _enabled = false;
  }

  function on(name, fn) {
    if (!_handlers[name]) _handlers[name] = [];
    _handlers[name].push(fn);
    return { off: () => off(name, fn) };
  }

  function off(name, fn) {
    _handlers[name] = (_handlers[name] || []).filter(h => h !== fn);
  }

  function exportData(format) {
    if (!isBrowser() || !_current) return null;
    const node  = _current;
    const rect  = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const attrs = {};
    Array.from(node.attributes).forEach(a => { attrs[a.name] = a.value; });
    const styles = {};
    Array.from(style).forEach(p => { styles[p] = style.getPropertyValue(p); });
    const data = {
      selector:  isInShadow(node) ? getShadowSelector(node) : generateStableSelector(node),
      xpath:     getXPath(node),
      tagName:   node.tagName.toLowerCase(),
      width:     Math.round(rect.width),
      height:    Math.round(rect.height),
      attributes: attrs,
      styles,
      a11y: {
        role:           node.getAttribute('role') || inferRole(node),
        accessibleName: getAccessibleName(node),
        focusable:      isFocusable(node),
      },
    };
    if (format === 'html')     return exportAsHTML(data);
    if (format === 'markdown') return exportAsMarkdown(data);
    if (format === 'yaml')     return exportAsYAML(data);
    return data; // default: JSON object
  }

  // v2.4 — setTheme: change theme at runtime
  function setTheme(theme) {
    _theme = theme;
    const panel = document.getElementById(`${PREFIX}_panel`);
    applyTheme(panel, theme);
  }

  // v2.4 — patchAddEventListener: monkey-patches a target's addEventListener
  // so the inspector can track all registered listeners on that target.
  // Call once per element you want full tracking for.
  function patchAddEventListener(target) {
    if (!target || target[`__insp_patched`]) return;
    target[`__insp_patched`] = true;
    const original = target.addEventListener.bind(target);
    const originalRemove = target.removeEventListener.bind(target);

    target.addEventListener = function(type, fn, opts) {
      if (_listenerRegistry) {
        if (!_listenerRegistry.has(target)) _listenerRegistry.set(target, {});
        const map = _listenerRegistry.get(target);
        if (!map[type]) map[type] = [];
        if (!map[type].includes(fn)) map[type].push(fn);
      }
      return original(type, fn, opts);
    };

    target.removeEventListener = function(type, fn, opts) {
      if (_listenerRegistry && _listenerRegistry.has(target)) {
        const map = _listenerRegistry.get(target);
        if (map[type]) map[type] = map[type].filter(h => h !== fn);
      }
      return originalRemove(type, fn, opts);
    };
  }

  // v2.4 — clearMutations: empties the mutation history log
  function clearMutations() {
    _mutationHistory = [];
    if (_activeTab === 'mutations') renderMutationPane();
  }

  // v3.0 — detectFramework: public wrapper for programmatic use
  function detectFramework(node) {
    if (!node || node.nodeType !== 1) return null;
    const react   = detectReact(node);
    const vue     = detectVue(node);
    const angular = detectAngular(node);
    if (react)   return { framework: 'react',   name: react.name,   hooks:  react.hooks };
    if (vue)     return { framework: 'vue',     name: vue.name,     props:  vue.props,   version: vue.version };
    if (angular) return { framework: 'angular', name: angular.name, inputs: angular.inputs, version: angular.version };
    return null;
  }

  // v3.0 — audit: run accessibility audit on any element (or current)
  function audit(node) {
    const target = node || _current;
    if (!target) return [];
    return runA11yAudit(target);
  }

  // v3.0 — Remote Debugging stub
  // Full implementation requires a WebSocket relay server.
  // This stub provides the API surface; wire `_remoteWs` to your relay.
  let _remoteWs   = null;
  let _remoteUrl  = null;
  let _sessionId  = null;

  function connect(url) {
    if (!isBrowser()) return Promise.reject(new Error('SSR'));
    _remoteUrl = url;
    return new Promise((resolve, reject) => {
      try {
        _remoteWs = new WebSocket(url);
        _remoteWs.onopen = () => {
          _remoteWs.send(JSON.stringify({ type: 'inspector:connect', version: '3.0.0' }));
          resolve({ connected: true, url });
        };
        _remoteWs.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            emit('remote:message', msg);
            if (msg.type === 'inspector:select' && msg.selector) {
              const node = document.querySelector(msg.selector);
              if (node) { _pinned = node; _current = node; renderPanel(node); }
            }
          } catch (_) {}
        };
        _remoteWs.onerror  = (err) => { emit('remote:error', err); reject(err); };
        _remoteWs.onclose  = ()    => { _remoteWs = null; emit('remote:disconnect', {}); };
      } catch (err) { reject(err); }
    });
  }

  function disconnect() {
    if (_remoteWs) { _remoteWs.close(); _remoteWs = null; }
  }

  // v3.0 — Collaboration stub
  // Share an inspection session by generating a session ID.
  // A real implementation syncs state via a relay (e.g. WebSocket or BroadcastChannel).
  const _collab = {
    sessionId:   null,
    participants: 0,
    channel:     null,
  };

  function share() {
    if (!isBrowser()) return null;
    // Generate a short human-readable session ID
    const id = Math.random().toString(36).slice(2,5).toUpperCase() + '-' +
               Math.random().toString(36).slice(2,5).toUpperCase() + '-' +
               Math.random().toString(36).slice(2,5).toUpperCase();
    _collab.sessionId = id;

    // Use BroadcastChannel for same-origin tab collaboration
    if (typeof BroadcastChannel !== 'undefined') {
      _collab.channel = new BroadcastChannel(`dom-inspector:${id}`);
      _collab.channel.onmessage = (e) => {
        const msg = e.data;
        emit('collab:message', msg);
        if (msg.type === 'select' && msg.selector) {
          const node = document.querySelector(msg.selector);
          if (node) { _pinned = node; _current = node; renderPanel(node); }
        }
      };
      // Broadcast current selection when it changes
      const origEmit = emit;
      // Broadcast inspect events to collaborators
    }

    emit('collab:start', { sessionId: id });
    return id;
  }

  function joinSession(sessionId) {
    if (!isBrowser() || !sessionId) return false;
    _collab.sessionId = sessionId;
    if (typeof BroadcastChannel !== 'undefined') {
      _collab.channel = new BroadcastChannel(`dom-inspector:${sessionId}`);
      _collab.channel.onmessage = (e) => {
        const msg = e.data;
        emit('collab:message', msg);
        if (msg.type === 'select' && msg.selector) {
          const node = document.querySelector(msg.selector);
          if (node) { _pinned = node; _current = node; renderPanel(node); }
        }
      };
    }
    emit('collab:join', { sessionId });
    return true;
  }

  return {
    init, enable, disable, destroy,
    on, off,
    export: exportData,
    generateStableSelector,
    // v2.4
    setTheme,
    patchAddEventListener,
    clearMutations,
    // v2.5
    detectFramework,
    // v3.0
    audit,
    connect,
    disconnect,
    share,
    joinSession,
  };
}));
