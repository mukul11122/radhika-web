(() => {
  const key = 'radhika-kendra-token';
  let profile = null,
    generation = 0;
  function token() {
    try {
      return sessionStorage.getItem(key) || localStorage.getItem(key) || '';
    } catch {
      return '';
    }
  }
  function clear() {
    generation++;
    try {
      sessionStorage.removeItem(key);
      localStorage.removeItem(key);
    } catch {}
    profile = null;
    window.dispatchEvent(new Event('kendra-profile-changed'));
  }
  function save(value, remember) {
    clear();
    try {
      (remember ? localStorage : sessionStorage).setItem(key, value);
    } catch {
      throw Error('Browser storage is unavailable. Please allow storage to remember your profile.');
    }
  }
  async function request(url, options = {}) {
    const epoch = generation;
    const response = await fetch(url, {
      ...options,
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        ...(token() ? { Authorization: 'Bearer ' + token() } : {}),
        ...options.headers,
      },
    });
    const data = await response.json();
    if (epoch !== generation) throw Error('Profile session changed. Please sign in again.');
    if (!response.ok || !data.ok) {
      if (response.status === 401) clear();
      throw Error(data.message || 'Please try again.');
    }
    return data;
  }
  async function refresh() {
    if (!token()) return null;
    const data = await request('/api/kendra/profile');
    profile = data.profile;
    window.dispatchEvent(new Event('kendra-profile-changed'));
    return profile;
  }
  function storeKey(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/^pmbjk0*/, '')
      .replace(/^0+(?=\d)/, '');
  }
  function forOrder(store, mobile) {
    return token() &&
      profile &&
      storeKey(profile.storeCode) === storeKey(store) &&
      profile.mobile === mobile
      ? { profile, token: token() }
      : null;
  }
  window.KendraProfile = { token, clear, save, request, refresh, get: () => profile, forOrder };
})();
