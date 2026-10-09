import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import dotenv from 'dotenv';
import express from 'express';
import { createApiApp } from './server/app.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(ROOT, '.env.local'), quiet: true });
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });
const development = process.argv.includes('--dev');
const PORT = Number(process.env.PORT || (development ? '5174' : '3001'));
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('PORT는 1~65535 사이의 정수여야 합니다.');
const HOST = '127.0.0.1';
const MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1';
const app = createApiApp({ development, port: PORT });
const server = createHttpServer(app);

let vite;
if (development) {
  const { createServer } = await import('vite');
  vite = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  if (!fs.existsSync(path.join(ROOT, 'dist/index.html'))) throw new Error('빌드 파일이 없습니다. npm start로 실행하거나 npm run build를 먼저 실행하세요.');
  app.use(express.static(path.join(ROOT, "dist"), { extensions: ["html"], setHeaders: (res, file) => {
    if (file.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
    else if (path.dirname(file) === path.join(ROOT, 'dist/assets')) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  } }));
}

app.use((_request, response) => {
  response.status(404).json({ error: "Not found" });
});
app.use((error, _request, response, _next) => {
  response.status(error.type === 'entity.too.large' ? 413 : 400).json({
    error: error.type === 'entity.too.large' ? '평가 자료의 용량이 너무 큽니다. 짧은 대화로 다시 시도해 주세요.' : '요청 데이터 형식이 올바르지 않습니다.',
  });
});

server.listen(PORT, HOST, () => {
  console.log(`\nHiRing · English conversation ${development ? 'development' : 'MVP'}`);
  console.log(`Open: http://localhost:${PORT}`);
  console.log(`Model: ${MODEL}`);
  console.log(
    process.env.OPENAI_API_KEY?.trim()
      ? "API key: configured"
      : "API key: missing — edit .env.local"
  );
});
server.on("error", error => {
  console.error(error.code === "EADDRINUSE" ? `포트 ${PORT}가 사용 중입니다. 기존 HiRing 서버를 종료하거나 PORT=3002 npm start로 실행하세요.` : error.message);
  void vite?.close();
  process.exitCode = 1;
});

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  server.close();
  server.closeAllConnections();
  void vite?.close();
});
