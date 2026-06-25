/**
 * DOM Inspector Chrome Extension — Content script
 * Injected into every page. Loads the inspector and listens for messages from the popup.
 */

(function () {
  'use strict';

  // Avoid double-injection
  if (window.__domInspectorExtLoaded) return;
  window.__domInspectorExtLoaded = true;

  // Load inspector from extension resources
  function loadInspector() {
    return new Promise((resolve, reject) => {
      if (window.DOMInspector) { resolve(window.DOMInspector); return; }
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('inspector.js');
      script.onload  = () => resolve(window.DOMInspector);
      script.onerror = () => reject(new Error('Failed to load inspector.js'));
      (document.head || document.documentElement).appendChild(script);
    });
  }

  // Apply saved preferences on load
  chrome.storage.sync.get(['enabled','freeze','theme','triggerKey'], (prefs) => {
    loadInspector().then((inspector) => {
      if (prefs.enabled !== false) {
        inspector.init({
          enabled:       true,
          freezeOnClick: !!prefs.freeze,
          theme:         prefs.theme || 'dark',
          triggerKey:    prefs.triggerKey || 'Alt',
          // Explicit CSS URL so inspector doesn't guess path in extension context
          cssUrl:        chrome.runtime.getURL('inspector.css'),
        });
      }
    }).catch(console.warn);
  });

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    loadInspector().then((inspector) => {
      switch (msg.action) {
        case 'enable':
          inspector.enable();
          break;
        case 'disable':
          inspector.disable();
          break;
        case 'setTheme':
          inspector.setTheme(msg.theme);
          break;
        case 'setFreeze':
          // Re-init with updated config
          inspector.destroy();
          chrome.storage.sync.get(['theme','triggerKey'], (p) => {
            inspector.init({
              enabled:       true,
              freezeOnClick: msg.freeze,
              theme:         p.theme || 'dark',
              triggerKey:    p.triggerKey || 'Alt',
              cssUrl:        chrome.runtime.getURL('inspector.css'),
            });
          });
          break;
        case 'setTriggerKey':
          inspector.destroy();
          chrome.storage.sync.get(['theme','freeze'], (p) => {
            inspector.init({
              enabled:       true,
              freezeOnClick: !!p.freeze,
              theme:         p.theme || 'dark',
              triggerKey:    msg.key,
              cssUrl:        chrome.runtime.getURL('inspector.css'),
            });
          });
          break;
        case 'export':
          sendResponse({ data: inspector.export(msg.format) });
          break;
        case 'audit':
          sendResponse({ data: inspector.audit() });
          break;
      }
    }).catch(console.warn);
    return true; // keep channel open for async sendResponse
  });
})();
