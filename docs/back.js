// Closes this tab so the user lands back on the welcome page.
document.getElementById('back').addEventListener('click', async () => {
  const tab = await chrome.tabs.getCurrent();
  if (tab) chrome.tabs.remove(tab.id);
  else window.close();
});
