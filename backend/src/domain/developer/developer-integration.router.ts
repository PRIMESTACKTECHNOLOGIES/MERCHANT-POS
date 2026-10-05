import { Router } from 'express';
import { validateIntegrationEndpoint } from './developer-integration.controller';

const router = Router();

router.post('/integration/validate', validateIntegrationEndpoint);

export default router;
