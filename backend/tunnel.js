const localtunnel = require('localtunnel');

function start() {
  const tunnel = localtunnel({ port: 3000, subdomain: undefined }, (err, t) => {
    if (err) {
      console.error('[tunnel] error:', err.message);
      setTimeout(start, 3000);
      return;
    }
    console.log('[tunnel] your preview url is: ' + t.url);
    t.on('close', () => {
      console.log('[tunnel] closed, reconnecting…');
      setTimeout(start, 2000);
    });
  });
  tunnel.on('error', (e) => {
    console.error('[tunnel] tunnel error:', e.message);
    setTimeout(start, 3000);
  });
}

start();
setInterval(() => {}, 1 << 30); // keep process alive
