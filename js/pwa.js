(() => {
  'use strict';
  if ('serviceWorker' in navigator)
    window.addEventListener('load', () =>
      navigator.serviceWorker
        .register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .catch(() => {})
    );
  let installEvent = null;
  const standalone = () =>
    window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pwa-install';
  button.textContent = 'Install App';
  button.hidden = true;
  document.body.append(button);
  const style = document.createElement('style');
  style.textContent =
    '.pwa-install{position:fixed;right:18px;bottom:18px;z-index:90;background:#1e4fd6;color:white;border:1px solid white;border-radius:10px;padding:12px 18px;font:600 14px system-ui,sans-serif;box-shadow:0 4px 20px #14318f30;cursor:pointer}.pwa-install[hidden]{display:none}.pwa-install:focus-visible{outline:3px solid #8caeff;outline-offset:3px}.pwa-help{margin:auto;max-width:420px;width:calc(100% - 32px);padding:28px;border:0;border-radius:16px;font:15px/1.7 system-ui,sans-serif;color:#243550}.pwa-help::backdrop{background:#12234380}.pwa-help button{padding:10px 16px;background:#1e4fd6;color:white;border:0;border-radius:7px}';
  document.head.append(style);
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e;
    if (!standalone()) button.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    button.hidden = true;
    installEvent = null;
  });
  const ios =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios && !standalone()) button.hidden = false;
  button.onclick = async () => {
    if (installEvent) {
      await installEvent.prompt();
      const result = await installEvent.userChoice;
      installEvent = null;
      button.hidden = true;
      return;
    }
    if (ios) {
      const dialog = document.createElement('dialog');
      dialog.className = 'pwa-help';
      dialog.innerHTML =
        '<h2>Install Radhika Agencies</h2><p>In Safari, tap <strong>Share</strong>, then <strong>Add to Home Screen</strong> and tap <strong>Add</strong>.</p><button type="button">Close</button>';
      dialog.querySelector('button').onclick = () => {
        dialog.close();
        dialog.remove();
      };
      document.body.append(dialog);
      dialog.showModal();
    }
  };
})();
