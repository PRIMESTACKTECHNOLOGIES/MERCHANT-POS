/**
 * Acquirer barrel — re-exports createAcquirerClient from the correct
 * protocol-aware implementation so payments.service.ts import works.
 */
export { createAcquirerClient } from './acquirer/index';
