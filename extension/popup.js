/**
 * DOM Inspector Chrome Extension — Popup script
 */

const $ = (id) => document.getElementById(id);

// Load saved settings
chrome.storage.sync.get(['enabled', 'freeze', 'theme', 'triggerKey'], (prefs) => {
  $('toggle-enabled').checked = prefs.enabled !== false;
  $('toggle-freeze').checked  = !!prefs.freeze;
  $('toggle-theme').checked   = prefs.theme !== 'light';
  $('trigger-key').value      = prefs.triggerKey || 'Alt';
  updateStatus(prefs.enabled !== false);
});

function save(key, value) {
  chrome.storage.sync.set({ [key]: value });
}

$('toggle-enabled').addEventListener('change', (e) => {
  const enabled = e.target.checked;
  save('enabled', enabled);
  sendToTab(enabled ? 'enable' : 'disable');
  updateStatus(enabled);
});

$('toggle-freeze').addEventListener('change', (e) => {
  save('freeze', e.target.checked);
  sendToTab('setFreeze', { freeze: e.target.checked });
});

$('toggle-theme').addEventListener('change', (e) => {
  const theme = e.target.checked ? 'dark' : 'light';
  save('theme', theme);
  sendToTab('setTheme', { theme });
});

$('trigger-key').addEventListener('change', (e) => {
  save('triggerKey', e.target.value);
  sendToTab('setTriggerKey', { key: e.target.value });
});

$('btn-enable').addEventListener('click', () => {
  $('toggle-enabled').checked = true;
  save('enabled', true);
  sendToTab('enable');
  updateStatus(true);
});

$('btn-disable').addEventListener('click', () => {
  $('toggle-enabled').checked = false;
  save('enabled', false);
  sendToTab('disable');
  updateStatus(false);
});

function sendToTab(action, data = {}) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { action, ...data })
        .catch(() => {
          // Content script not yet injected — inject it first
          chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            files: ['content.js'],
          }).then(() => {
            chrome.tabs.sendMessage(tabs[0].id, { action, ...data }).catch(() => {});
          });
        });
    }
  });
}

function updateStatus(enabled) {
  $('status-dot').classList.toggle('active', enabled);
  $('status-text').textContent = enabled ? 'Inspector active' : 'Not active';
}
