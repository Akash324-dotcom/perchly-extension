// Small helpers around chrome.storage.local (Chrome's private storage for this extension).
const store = {
  async getProfile() {
    const { profile } = await chrome.storage.local.get('profile');
    return Object.assign({ resume: '', linkedin: '', githubUser: '', github: null, years: '' }, profile || {});
  },
  async saveProfile(profile) {
    await chrome.storage.local.set({ profile });
  },
};
