import { Router, Request, Response } from 'express';
import { PosProtocol } from '../core/PosProtocol';
import { posService } from './posService';
import { executePos1011 } from './pos1011';
import { paxSimulator } from './paxSimulator';
import { pos1011ScalingLock } from './pos1011ScalingLock';
import { processPos1011RealSettlement } from './pos1011RealSettlement';
import { terminalStateMachine, EmvState } from './terminalStateMachine';
import { safEngine } from './safEngine';
import { reversalEngine } from './reversalEngine';

const router = Router();

// POST /api/pos/101.1/real-settlement — call the fund-holding server to move REAL value
router.post('/101.1/real-settlement', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const result = await processPos1011RealSettlement({
      sessionId: String(body.sessionId || ''),
      cardRef: String(body.cardRef || ''),
      amountMinor: Number(body.amountMinor),
      currency: String(body.currency || '').toUpperCase(),
      authCode: String(body.authCode || ''),
      receiverBank: {
        bankName: String(body.receiverBank?.bankName || ''),
        iban: body.receiverBank?.iban ? String(body.receiverBank.iban) : undefined,
        accountNumber: body.receiverBank?.accountNumber ? String(body.receiverBank.accountNumber) : undefined,
        swift: body.receiverBank?.swift ? String(body.receiverBank.swift) : undefined,
      },
    });
    return res.json(result);
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || 'POS 101.1 settlement failed' });
  }
});

// POST /api/pos/101.1/sale — record a POS 101.1 sale
router.post('/101.1/sale', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const result = await posService.processPos1011Sale({
      amountMinor: Number(body.amountMinor),
      currency: String(body.currency || ''),
      card: {
        panToken: String(body.card?.panToken || ''),
        holderName: body.card?.holderName,
        scheme: body.card?.scheme || 'VISA',
        program: body.card?.program,
      },
      terminal: {
        id: String(body.terminal?.id || ''),
        provider: body.terminal?.provider || 'PAX',
        online: body.terminal?.online === true,
        protocol: body.terminal?.protocol || PosProtocol.POS_101_1,
      },
      processor: {
        id: String(body.processor?.id || ''),
        name: String(body.processor?.name || ''),
        supportsProtocol: Array.isArray(body.processor?.supportsProtocol)
          ? body.processor.supportsProtocol
          : [PosProtocol.POS_101_1],
      },
      pin: String(body.pin || ''),
    });
    return res.status(result.status === 'DECLINED' ? 402 : 200).json(result);
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || 'POS 101.1 validation failed' });
  }
});

// POST /api/pos/101.1/execute — run the 101.1 pipeline (scaling lock + EMV kernel)
router.post('/101.1/execute', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const result = await executePos1011({
      amountMinor: Number(body.amountMinor),
      currency: String(body.currency || ''),
      card: body.card,
      terminal: body.terminal,
      processor: body.processor,
      payvoice: body.payvoice,
    });
    return res.status(result.status === 'DECLINED' ? 402 : 200).json(result);
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || 'POS 101.1 execution failed' });
  }
});

// POST /api/pos/101.1/terminal-preview — render the PAX screen preview
router.post('/101.1/terminal-preview', (req: Request, res: Response) => {
  try {
    return res.json(paxSimulator.runScreen(
      Number(req.body?.amountMinor),
      String(req.body?.currency || 'USD'),
      req.body?.card,
    ));
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || 'Unable to build terminal preview' });
  }
});

// POST /api/pos/101.1/scaling/approve — release the scaling lock after reconciliation
router.post('/101.1/scaling/approve', (req: Request, res: Response) => {
  if (String(req.body?.writtenApproval || '').trim().length < 10) {
    return res.status(400).json({ error: 'Written approval reference is required' });
  }
  pos1011ScalingLock.approveScaling();
  return res.json({ approved: true, protocol: 'POS_101_1' });
});

// POST /api/pos/emv/process — run full EMV state machine
router.post('/emv/process', async (req: Request, res: Response) => {
  try {
    const ctx = {
      state: EmvState.INIT,
      ...req.body,
      amountMinor: Number(req.body.amountMinor || 0),
      tvr: 0, tsi: 0, flags: 0,
    };
    const result = await terminalStateMachine.run(ctx);
    return res.json({
      ok:           result.decision === 'APPROVE',
      state:        result.state,
      decision:     result.decision,
      authCode:     result.authCode,
      responseCode: result.responseCode,
      tvrHex:       result.tvr.toString(16).padStart(10, '0'),
      tsiHex:       result.tsi.toString(16).padStart(4, '0'),
      error:        result.error?.toJSON(),
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/pos/saf/store — store offline transaction
router.post('/saf/store', async (req: Request, res: Response) => {
  try {
    const txn = await safEngine.store(req.body);
    return res.json({ ok: true, safId: txn.id, status: txn.status });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/pos/saf/pending — list pending SAF transactions
router.get('/saf/pending', async (_req: Request, res: Response) => {
  try {
    const pending = await safEngine.getPending();
    return res.json({ ok: true, count: pending.length, transactions: pending });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/pos/reversal — reverse a transaction
router.post('/reversal', async (req: Request, res: Response) => {
  try {
    const result = await reversalEngine.reverse(req.body);
    return res.json({ ok: true, ...result });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
