import { mkdir, readFile, writeFile, rename, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const version = '2026.10.5';
const sha256 = 'db4e4c413612a0916f3e1679d3caaf376f94911952d163028fb726fb2e0516a9';
const folder = new URL('../desktop/vendor/', import.meta.url);
const executable = new URL('cloudflared.exe', folder);
await mkdir(folder, { recursive: true });
async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}
let bytes;
try { bytes = await readFile(executable); } catch { bytes = await download(`https://github.com/cloudflare/cloudflared/releases/download/${version}/cloudflared-windows-amd64.exe`); }
if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error('Cloudflared SHA256 differs from the official 2026.10.5 release.');
try { await access(executable); } catch {
  const temporary = new URL('cloudflared.download', folder);
  await writeFile(temporary, bytes); await rename(temporary, executable);
}
const license = new URL('LICENSE.cloudflared', folder);
try { await access(license); } catch { await writeFile(license, await download(`https://raw.githubusercontent.com/cloudflare/cloudflared/${version}/LICENSE`)); }
console.log(`Cloudflared ${version}: official SHA256 verified.`);
