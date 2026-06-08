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
  function getSimpleSelector(node) {
    let s = node.tagName.toLowerCase();
    if (node.id && !node.id.startsWith(PREFIX)) return s + '#' + node.id;
    if (node.className && typeof node.className === 'string') {
      const cls = node.className.trim().split(/\s+/)
        .filter(c => !c.startsWith(PREFIX) && c !== '');
      if (cls.length) s += '.' + cls.slice(0, 2).join('.');
    }
    return s;
  }

  function getFullSelector(node) {
    const parts = [];
    let cur = node;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      let seg = cur.tagName.toLowerCase();
      if (cur.id && !cur.id.startsWith(PREFIX)) {
        seg += '#' + cur.id;
        parts.unshift(seg);
        break;
      }
      if (cur.className && typeof cur.className === 'string') {
        const cls = cur.className.trim().split(/\s+/)
          .filter(c => !c.startsWith(PREFIX) && c !== '');
        if (cls.length) seg += '.' + cls.slice(0, 2).join('.');
      }
      let idx = 1;
      let sib = cur.previousElementSibling;
      while (sib) { if (sib.tagName === cur.tagName) idx++; sib = sib.previousElementSibling; }
      if (idx > 1) seg += `:nth-of-type(${idx})`;
      parts.unshift(seg);
      cur = cur.parentElement;
      if (parts.length > 6) break;
    }
    return parts.join(' > ');
  }

  function getXPath(node) {
    if (node === document.body) return '/html/body';
    const parts = [];
    let cur = node;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      let idx = 1;
      let sib = cur.previousElementSibling;
      while (sib) { if (sib.tagName === cur.tagName) idx++; sib = sib.previousElementSibling; }
      parts.unshift(cur.tagName.toLowerCase() + (idx > 1 ? `[${idx}]` : ''));
      cur = cur.parentElement;
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

  // ── EVENT EMITTER ──
  function emit(name, detail) {
    (_handlers[name] || []).forEach(fn => { try { fn(detail); } catch(_) {} });
    if (isBrowser()) {
      document.dispatchEvent(new CustomEvent(`dom-inspector:${name}`, { detail }));
    }
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

    const panel = el('div', 'insp-dark', { id: `${PREFIX}_panel` });

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

    return p;
  }

  function buildDOMTreePane() {
    const p = el('div', 'insp-pane', { id: `${PREFIX}_pane_dom` });
    p.appendChild(el('div', '', { id: `${PREFIX}_dom_tree` }));
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
      _isDark = !_isDark;
      panel.classList.toggle('insp-dark',  _isDark);
      panel.classList.toggle('insp-light', !_isDark);
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

    const hasChildren = n.children && n.children.length > 0;
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
    label.textContent = txt;
    item.appendChild(label);
    container.appendChild(item);

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      _pinned = n; _current = n; renderPanel(n);
    });

    if (hasChildren && depth < maxDepth) {
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

    const fullSel = getFullSelector(node);
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

    // #2, #8 — scroll & resize: recalculate overlay position for pinned element
    const _onScrollResize = () => {
      if (!_pinned || !_enabled) return;
      const panel = document.getElementById(`${PREFIX}_panel`);
      if (!panel || panel.style.display !== 'flex') return;

      // #12 — use rAF for scroll/resize too
      if (_rafId) return;
      _rafId = requestAnimationFrame(() => {
        _rafId = null;
        if (!_pinned || !_enabled) return;
        // #9 — getBoundingClientRect handles fixed/sticky/transformed elements
        const rect  = _pinned.getBoundingClientRect();
        const style = getComputedStyle(_pinned);
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
        // #1, #2 — reposition panel relative to element after scroll/resize
        positionPanel(rect);
      });
    };
    addListener(window, 'scroll', _onScrollResize, { passive: true, capture: true });
    addListener(window, 'resize', _onScrollResize, { passive: true });
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
      const { enabled: e, ...rest } = options;
      enabled = (e === undefined) ? true : e;
      _cfg = { ...DEFAULTS, ...rest };
    }

    const active = (typeof enabled === 'function') ? enabled() : Boolean(enabled);
    if (!active) { if (_mounted) destroy(); return; }
    if (_mounted) return;

    _mounted = true;
    _enabled = true;
    injectCSS();
    buildPanel();
    attachGlobalListeners();
  }

  function enable()  { if (!isBrowser()) return; if (!_mounted) { init(true); return; } _enabled = true; }
  function disable() { if (!isBrowser()) return; _enabled = false; closePanel(); }

  function destroy() {
    if (!isBrowser()) return;
    closePanel();
    removeAllListeners();
    [`${PREFIX}_panel`, `${PREFIX}_tooltip`, `${PREFIX}_styles`]
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

  function exportData() {
    if (!isBrowser() || !_current) return null;
    const node  = _current;
    const rect  = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const attrs = {};
    Array.from(node.attributes).forEach(a => { attrs[a.name] = a.value; });
    const styles = {};
    Array.from(style).forEach(p => { styles[p] = style.getPropertyValue(p); });
    return {
      selector:  getFullSelector(node),
      xpath:     getXPath(node),
      tagName:   node.tagName.toLowerCase(),
      width:     Math.round(rect.width),
      height:    Math.round(rect.height),
      attributes: attrs,
      styles,
      a11y: {
        role:          node.getAttribute('role') || inferRole(node),
        accessibleName: getAccessibleName(node),
        focusable:     isFocusable(node),
      },
    };
  }

  return { init, enable, disable, destroy, on, off, export: exportData };
}));
