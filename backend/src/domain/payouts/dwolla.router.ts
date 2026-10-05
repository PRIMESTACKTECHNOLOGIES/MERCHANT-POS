import { Router } from 'express';
import { authenticateToken } from '../../middleware/auth.middleware';
import { onboardMerchantWithDwolla } from './dwollaOnboarding.service';

const router = Router();

router.post('/onboard/:merchantId', authenticateToken, async (req, res) => {
  try {
    return res.status(201).json(await onboardMerchantWithDwolla(req.params.merchantId, req.body || {}));
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

export default router;
