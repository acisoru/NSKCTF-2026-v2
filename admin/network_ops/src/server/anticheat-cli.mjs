import { request } from 'node:http';
import { controlPath } from './anticheat-control.mjs';

const [operation, identity, ...reason] = process.argv.slice(2);
if (!['list', 'events', 'unban'].includes(operation) || operation !== 'list' && !identity || operation === 'unban' && !reason.length) {
  console.error('Usage: node server/anticheat-cli.mjs list | events YANDEX_ID | unban YANDEX_ID REASON'); process.exitCode = 1;
} else {
  try {
    const body = operation === 'unban' ? JSON.stringify({ identity, reason: reason.join(' ') }) : null;
    const result = await new Promise((resolve, reject) => {
      const req = request({ socketPath: controlPath(process.env.DATA_DIR || './data'), path: operation === 'list' ? '/bans' : operation === 'events' ? `/events?identity=${encodeURIComponent(identity)}` : '/unban', method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {} }, res => {
        let data = ''; res.setEncoding('utf8'); res.on('data', chunk => { data += chunk; }); res.on('error', reject);
        res.on('end', () => { try { const value = JSON.parse(data); res.statusCode === 200 ? resolve(value) : reject(new Error(value.error)); } catch (error) { reject(error); } });
      }); req.setTimeout(5000, () => req.destroy(new Error('Control request timed out'))); req.on('error', reject); req.end(body);
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
