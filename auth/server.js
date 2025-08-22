import http from 'node:http';

const PORT = Number(process.env.PORT || 8080);
const REALM = process.env.AUTH_REALM || 'api';
const SECRET = process.env.PROXY_API_KEY || '';

const sendJSON = (res, status, data, extraHeaders = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders });
  res.end(JSON.stringify(data));
};

const unauthorized = (res, message = 'unauthorized') => {
  sendJSON(res, 401, { error: { message } }, { 'WWW-Authenticate': `Bearer realm=${REALM}` });
};

const server = http.createServer((req, res) => {
  const { url = '', headers = {} } = req;
  if (url === '/healthz') {
    return sendJSON(res, 200, { ok: true });
  }
  if (url.startsWith('/verify')) {
    const auth = headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!SECRET) return unauthorized(res, 'server misconfigured');
    if (!token || token !== SECRET) return unauthorized(res, 'invalid token');
    return sendJSON(res, 200, { ok: true });
  }
  sendJSON(res, 404, { error: { message: 'not found' } });
});

server.listen(PORT, () => {
  console.log(`[auth] listening on :${PORT}`);
});