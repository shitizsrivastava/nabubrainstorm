// Test harness replicating main.js's local server (static files + OBS relay
// routes) so the ?obs=1 overlay can be verified in a plain browser.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SERVE_MIME = {
  '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
  '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.gif':'image/gif', '.webp':'image/webp', '.svg':'image/svg+xml', '.ico':'image/x-icon',
  '.mp4':'video/mp4', '.webm':'video/webm', '.mp3':'audio/mpeg', '.wav':'audio/wav',
  '.pdf':'application/pdf'
};

let obsClients = [];
const obsLast = {};

function handleObsRoutes(req, res, urlPath){
  if (urlPath === '/obs-events'){
    res.writeHead(200, { 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache', 'Connection':'keep-alive' });
    res.write(':ok\n\n');
    obsClients.push(res);
    Object.values(obsLast).forEach(m => res.write(`data: ${m}\n\n`));
    req.on('close', () => { obsClients = obsClients.filter(c => c !== res); });
    return true;
  }
  if (urlPath === '/obs-state' && req.method === 'POST'){
    let body = '';
    req.on('data', c => { body += c; if (body.length > 64e6) req.destroy(); });
    req.on('end', () => {
      try { obsLast[JSON.parse(body).type] = body; } catch(e){ res.writeHead(400); res.end(); return; }
      obsClients.forEach(c => { try { c.write(`data: ${body}\n\n`); } catch(e){} });
      res.writeHead(204); res.end();
    });
    return true;
  }
  if (urlPath === '/media'){
    const p = new URL(req.url, 'http://x').searchParams.get('p') || '';
    const stream = fs.createReadStream(p);
    stream.on('error', () => { res.writeHead(404); res.end(); });
    stream.once('open', () => {
      res.writeHead(200, { 'Content-Type': SERVE_MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
      stream.pipe(res);
    });
    return true;
  }
  return false;
}

const srv = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];
  if (handleObsRoutes(req, res, urlPath)) return;
  if (urlPath === '/') urlPath = '/board.html';
  const filePath = path.resolve(ROOT, '.' + urlPath);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': SERVE_MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});
srv.listen(process.env.PORT || 8934, '127.0.0.1', () => console.log('obs test server on ' + (process.env.PORT || 8934)));
