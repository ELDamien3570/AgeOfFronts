import { createServer } from 'vite';
const server = await createServer({
  configFile: 'vite.skirmish.config.ts',
  server: {
    host: '127.0.0.1', port: 9000, strictPort: true,
    watch: { usePolling: true, interval: 1000, ignored: ['**/Art/**', '**/outputs/**', '**/tmp/**', '**/HeightMaps/**'] },
  },
});
await server.listen();
server.printUrls();
