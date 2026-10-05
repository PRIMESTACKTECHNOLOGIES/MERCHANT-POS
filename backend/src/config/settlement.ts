export const settlementConfig = {
  sftpHost: process.env.SETTLEMENT_SFTP_HOST || '',
  sftpPort: Number(process.env.SETTLEMENT_SFTP_PORT || 22),
  sftpUser: process.env.SETTLEMENT_SFTP_USER || '',
  sftpPassword: process.env.SETTLEMENT_SFTP_PASSWORD || '',
  sftpPrivateKey: process.env.SETTLEMENT_SFTP_PRIVATE_KEY || '',
  sftpRemoteDir: process.env.SETTLEMENT_SFTP_REMOTE_DIR || '/settlements',
  localDir: process.env.SETTLEMENT_LOCAL_DIR || 'data/settlements',
  processedDir: process.env.SETTLEMENT_PROCESSED_DIR || 'data/settlements/processed',
  failedDir: process.env.SETTLEMENT_FAILED_DIR || 'data/settlements/failed',
  cronExpr: process.env.SETTLEMENT_CRON || '0 3 * * *',
  merchantId: process.env.SETTLEMENT_MERCHANT_ID || 'MRC-1001',
};