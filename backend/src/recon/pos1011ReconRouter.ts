import { Router } from 'express';
import { pos1011ReconService } from './pos1011ReconService';
import { pos1011BatchManager } from '../settlement/pos1011BatchManager';

const router = Router();
router.get('/101.1/reconciliation', async (_req, res) => res.json({ data: await pos1011ReconService.buildRecon() }));
router.get('/101.1/batches', async (_req, res) => res.json({ data: await pos1011BatchManager.listBatches() }));
router.post('/101.1/batches', async (req, res) => res.status(201).json(await pos1011BatchManager.createBatch(String(req.body?.currency || 'USD'), String(req.body?.asset || 'USDT'))));
router.post('/101.1/batches/:batchId/items', async (req, res) => res.json(await pos1011BatchManager.addToBatch(req.params.batchId, String(req.body?.txId || ''), Number(req.body?.amountMinor))));
router.post('/101.1/batches/:batchId/close', async (req, res) => res.json(await pos1011BatchManager.closeBatch(req.params.batchId)));
router.post('/101.1/batches/:batchId/settle', async (req, res) => res.json(await pos1011BatchManager.settleBatch(req.params.batchId)));
export default router;
