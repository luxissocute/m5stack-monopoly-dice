import { build } from 'esbuild';
await build({ entryPoints: ['server/room-server.ts'], outfile: 'desktop/generated/rooms.cjs',
  bundle: true, platform: 'node', format: 'cjs', target: 'node22',
  external: ['bufferutil', 'utf-8-validate'],
  define: { 'import.meta.url': 'undefined' },
});
