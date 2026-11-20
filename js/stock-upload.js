(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let token = '';
  function show() {
    $('login-card').hidden = !!token;
    $('upload-card').hidden = !token;
  }
  function message(text, error = false) {
    $('upload-message').textContent = text;
    $('upload-message').style.color = error ? '#b42318' : '#315bb8';
  }
  show();
  window.addEventListener('pageshow', () => {
    token = '';
    $('stock-login').reset();
    $('stock-upload').reset();
    show();
    message('Enter your username and password to upload stock.');
  });
  $('stock-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('login-button').disabled = true;
    message('Checking login…');
    try {
      const fields = new FormData(e.target);
      const r = await fetch('/api/stock/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: fields.get('user'), password: fields.get('pass') }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.message || 'Login failed.');
      token = data.token;
      e.target.reset();
      show();
      message('Upload unlocked. Choose a stock file to publish.');
    } catch (err) {
      message(err.message, true);
    } finally {
      $('login-button').disabled = false;
    }
  });
  $('logout').onclick = () => {
    token = '';
    show();
    message('Upload locked.');
  };
  $('stock-upload').addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = $('stock-file').files[0];
    if (!file || !/^.*\.(xlsx|csv)$/i.test(file.name) || file.size > 20 * 1024 * 1024) {
      message('Choose an .xlsx or CSV file up to 20 MB.', true);
      return;
    }
    if (!$('replace-confirm').checked) return;
    $('upload-button').disabled = true;
    message('Checking and uploading stock…');
    try {
      const post = async (path, body) => {
        const r = await fetch('/api/admin/stock/upload/' + path, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        let data;
        try {
          data = await r.json();
        } catch {
          throw new Error('Upload service did not respond. Please try again.');
        }
        if (r.status === 401) {
          token = '';
          show();
          throw new Error('Access expired. Please enter your username and password again.');
        }
        if (!r.ok || !data.ok) throw new Error(data.message || 'Stock could not be uploaded.');
        return data;
      };
      const started = await post('start', { name: file.name, size: file.size });
      for (let offset = 0, part = 0; offset < file.size; offset += started.chunkSize, part++) {
        const data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = () => reject(new Error('File could not be read.'));
          reader.readAsDataURL(file.slice(offset, offset + started.chunkSize));
        });
        await post('part', { uploadId: started.uploadId, part, data });
        message(
          'Uploading stock… ' +
            Math.round((Math.min(file.size, offset + started.chunkSize) / file.size) * 100) +
            '%'
        );
      }
      message('Validating and publishing stock…');
      await post('finish', { uploadId: started.uploadId });
      e.target.reset();
      window.location.assign('stock.html');
    } catch (err) {
      message(err.message || 'Upload failed. Please try again.', true);
    } finally {
      $('upload-button').disabled = false;
    }
  });
})();
