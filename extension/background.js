/**
 * DOM Inspector Chrome Extension — Background service worker (MV3)
 */

// Install: open the options page or show a welcome notification
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.tabs.create({
        url: "https://github.com/sayataleqsanyan/dom-inspector#readme",
    });
  }
});

// Toggle inspector on toolbar icon click (without popup — fallback)
chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { action: 'enable' }).catch(() => {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files:  ['content.js'],
    });
  });
});

// Context menu: "Inspect element with DOM Inspector"
chrome.contextMenus.create({
  id:       'dom-inspector-inspect',
  title:    'Inspect with DOM Inspector',
  contexts: ['all'],
});

chrome.contextMenus.onClicked.addListener(({ menuItemId }, tab) => {
  if (menuItemId === 'dom-inspector-inspect') {
    chrome.tabs.sendMessage(tab.id, { action: 'enable' }).catch(() => {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files:  ['content.js'],
      });
    });
  }
});
