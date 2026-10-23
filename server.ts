import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { executeColumnarSqlAggregation } from './src/core/engine';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '50mb' }));

  // DuckDB-Compatible Columnar Pre-Aggregation & LTTB Streaming API
  app.get('/api/duckdb/status', (_req, res) => {
    res.json({
      status: 'READY',
      engine: 'Server-Side Columnar Parquet/CSV Scan + Time-Bucket + LTTB Downsampler',
      maxSupportedRows: 5_000_000,
      defaultBucketSec: 10,
      defaultLttbPoints: 240,
    });
  });

  app.post('/api/duckdb/query', (req, res) => {
    try {
      const { sqlQuery, totalRows, bucketSec, targetLttbPoints, tagFilter } = req.body || {};
      const result = executeColumnarSqlAggregation({
        sqlQuery,
        totalRows: Number(totalRows) || 1_000_000,
        bucketSec: Number(bucketSec) || 10,
        targetLttbPoints: Number(targetLttbPoints) || 240,
        tagFilter: tagFilter || 'FC10901',
        engineMode: 'server-express-columnar',
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({
        error: (err as Error).message || 'Failed to execute columnar pre-aggregation query',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SimVsAct LoopBench Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
