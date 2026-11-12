// Clicking the toolbar icon: Chrome grants Perchly access to THIS tab (activeTab) and then we open the side panel.
// (Chrome's automatic "open panel on click" switch skips that grant, so we handle the click ourselves.)
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// First install only: open the welcome page so the user can read and agree.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome/welcome.html') });
  }
});
