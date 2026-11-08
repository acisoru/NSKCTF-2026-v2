import { randomBytes } from 'node:crypto';
import { open, chmod, chown } from 'node:fs/promises';
try { const f = await open('/secrets/checker', 'wx', 0o400); await f.writeFile(randomBytes(48).toString('hex')); await f.close(); } catch (error) { if (error.code !== 'EEXIST') throw error; }
await chown('/secrets/checker', 1000, 1000); await chmod('/secrets/checker', 0o400);
