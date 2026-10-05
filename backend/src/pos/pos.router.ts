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

router.post('/101.1/real-settlement', async (req, res) => {
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

router.post('/101.1/sale', async (req, res) => {
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

    router.post('/101.1/execute', async (req, res) => {
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

    router.post('/101.1/terminal-preview', (req, res) => {
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

    router.post('/101.1/scaling/approve', (req, res) => {
      if (String(req.body?.writtenApproval || '').trim().length < 10) {
        return res.status(400).json({ error: 'Written approval reference is required' });
      }
      pos1011ScalingLock.approveScaling();
      return res.json({ approved: true, protocol: 'POS_101_1' });
    });
    return res.status(result.status === 'DECLINED' ? 402 : 200).json(result);
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || 'POS 101.1 validation failed' });
  }
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


// ── EMV State Machine ─────────────────────────────────────────────────────────
import type { Request as Req, Response as Res } from 'express';

router.post('/emv/process', async (req: Req, res: Res) => {
  try {
    const { terminalStateMachine, EmvState } = await import('./terminalStateMachine');
    const ctx = { state: EmvState.INIT, tvr: 0, tsi: 0, flags: 0, amountMinor: Number(req.body.amountMinor||0), currency: req.body.currency||'USD', merchantId: req.body.merchantId||'', terminalId: req.body.terminalId||'', ...req.body };
    const result = await terminalStateMachine.run(ctx);
    return res.json({ ok: result.decision==='APPROVE', state: result.state, decision: result.decision, authCode: result.authCode, responseCode: result.responseCode, tvrHex: result.tvr.toString(16).padStart(10,'0'), tsiHex: result.tsi.toString(16).padStart(4,'0'), error: result.error?.toJSON() });
  } catch(e:any){ return res.status(500).json({ok:false,error:e.message}); }
});

router.post('/saf/store', async (req: Req, res: Res) => {
  try {
    const { safEngine } = await import('./safEngine');
    const txn = await safEngine.store(req.body);
    return res.json({ ok: true, safId: txn.id, status: txn.status });
  } catch(e:any){ return res.status(500).json({ok:false,error:e.message}); }
});

router.get('/saf/pending', async (_req: Req, res: Res) => {
  try {
    const { safEngine } = await import('./safEngine');
    const pending = await safEngine.getPending();
    return res.json({ ok: true, count: pending.length, transactions: pending });
  } catch(e:any){ return res.status(500).json({ok:false,error:e.message}); }
});

router.post('/reversal', async (req: Req, res: Res) => {
  try {
    const { reversalEngine } = await import('./reversalEngine');
    const result = await reversalEngine.reverse(req.body);
    return res.json({ ok: true, ...result });
  } catch(e:any){ return res.status(500).json({ok:false,error:e.message}); }
});
export default router;

