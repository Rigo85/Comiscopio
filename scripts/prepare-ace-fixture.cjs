// Download a public interoperability sample without redistributing it in Git.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const destination = path.resolve(__dirname, '../.cache/fixtures/abydos.cba');
const url = 'https://sembiance.com/fileFormatSamples/archive/ace/abydos.cba';
const sha256 = '146486d4460f6223463bc10c5055447d8eb0fa7b4e53175a83fb9b82d66ccb9e';
const valid = data => createHash('sha256').update(data).digest('hex') === sha256;

(async () => {
  if (fs.existsSync(destination) && valid(fs.readFileSync(destination))) {
    console.log('ACE fixture already verified');
    return;
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`ACE fixture download: HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (!valid(data)) throw new Error('ACE fixture SHA-256 mismatch');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, data);
  console.log('ACE fixture downloaded and verified');
})().catch(error => { console.error(error); process.exitCode = 1; });
