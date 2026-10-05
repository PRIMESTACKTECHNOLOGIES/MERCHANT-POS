import { Router, Request, Response } from 'express';
import { db } from '../config/db';

export const receiptsRouter = Router();

/**
 * GET /api/receipts/:receiptId
 * Get receipt by ID
 */
receiptsRouter.get('/:receiptId', async (req: Request, res: Response) => {
  try {
    const { receiptId } = req.params;

    const result = await db.query(`
      SELECT * FROM receipts WHERE receipt_id = ?
    `, [receiptId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Receipt not found',
      });
    }

    const receipt = result.rows[0];
    const receiptData = JSON.parse(receipt.receipt_data);

    res.json({
      success: true,
      receipt: {
        id: receipt.id,
        receiptId: receipt.receipt_id,
        transactionId: receipt.transaction_id,
        merchantId: receipt.merchant_id,
        generatedAt: receipt.generated_at,
        ...receiptData,
      },
    });
  } catch (error: any) {
    console.error('Error fetching receipt:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch receipt',
      error: error.message,
    });
  }
});

/**
 * GET /api/receipts/transaction/:transactionId
 * Get receipt by transaction ID
 */
receiptsRouter.get('/transaction/:transactionId', async (req: Request, res: Response) => {
  try {
    const { transactionId } = req.params;

    const result = await db.query(`
      SELECT * FROM receipts WHERE transaction_id = ?
    `, [transactionId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Receipt not found for this transaction',
      });
    }

    const receipt = result.rows[0];
    const receiptData = JSON.parse(receipt.receipt_data);

    res.json({
      success: true,
      receipt: {
        id: receipt.id,
        receiptId: receipt.receipt_id,
        transactionId: receipt.transaction_id,
        merchantId: receipt.merchant_id,
        generatedAt: receipt.generated_at,
        ...receiptData,
      },
    });
  } catch (error: any) {
    console.error('Error fetching receipt by transaction:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch receipt',
      error: error.message,
    });
  }
});

/**
 * GET /api/receipts/customer/:customerId
 * Get all receipts for a customer
 */
receiptsRouter.get('/customer/:customerId', async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const result = await db.query(`
      SELECT * FROM receipts 
      WHERE json_extract(receipt_data, '$.customer.id') = ?
      ORDER BY generated_at DESC
      LIMIT ? OFFSET ?
    `, [customerId, limit, offset]);

    const totalResult = await db.query(`
      SELECT COUNT(*) as count FROM receipts 
      WHERE json_extract(receipt_data, '$.customer.id') = ?
    `, [customerId]);

    const formattedReceipts = result.rows.map((r: any) => {
      const receiptData = JSON.parse(r.receipt_data);
      return {
        id: r.id,
        receiptId: r.receipt_id,
        transactionId: r.transaction_id,
        merchantId: r.merchant_id,
        generatedAt: r.generated_at,
        receiptType: receiptData.receiptType,
        amount: receiptData.amount?.total || 0,
        customer: receiptData.customer,
      };
    });

    res.json({
      success: true,
      receipts: formattedReceipts,
      pagination: {
        total: totalResult.rows[0]?.count || 0,
        limit,
        offset,
        hasMore: offset + limit < (totalResult.rows[0]?.count || 0),
      },
    });
  } catch (error: any) {
    console.error('Error fetching customer receipts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch customer receipts',
      error: error.message,
    });
  }
});

/**
 * GET /api/receipts
 * Get all receipts (admin only - add auth middleware)
 */
receiptsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const result = await db.query(`
      SELECT * FROM receipts 
      WHERE receipt_id LIKE 'RCP-%'
      ORDER BY generated_at DESC
      LIMIT ? OFFSET ?
    `, [limit, offset]);

    const totalResult = await db.query(`
      SELECT COUNT(*) as count FROM receipts 
      WHERE receipt_id LIKE 'RCP-%'
    `);

    const formattedReceipts = result.rows.map((r: any) => {
      const receiptData = JSON.parse(r.receipt_data);
      return {
        id: r.id,
        receiptId: r.receipt_id,
        transactionId: r.transaction_id,
        merchantId: r.merchant_id,
        generatedAt: r.generated_at,
        receiptType: receiptData.receiptType,
        amount: receiptData.amount?.total || 0,
        customer: receiptData.customer,
        status: receiptData.status,
      };
    });

    res.json({
      success: true,
      receipts: formattedReceipts,
      pagination: {
        total: totalResult.rows[0]?.count || 0,
        limit,
        offset,
        hasMore: offset + limit < (totalResult.rows[0]?.count || 0),
      },
    });
  } catch (error: any) {
    console.error('Error fetching receipts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch receipts',
      error: error.message,
    });
  }
});

/**
 * GET /api/receipts/stats
 * Get receipt statistics
 */
receiptsRouter.get('/stats/summary', async (req: Request, res: Response) => {
  try {
    const statsResult = await db.query(`
      SELECT 
        COUNT(*) as total_receipts,
        SUM(CAST(json_extract(receipt_data, '$.amount.total') AS REAL)) as total_amount
      FROM receipts 
      WHERE receipt_id LIKE 'RCP-%'
    `);

    const byTypeResult = await db.query(`
      SELECT 
        json_extract(receipt_data, '$.receiptType') as receipt_type,
        COUNT(*) as count,
        SUM(CAST(json_extract(receipt_data, '$.amount.total') AS REAL)) as amount
      FROM receipts 
      WHERE receipt_id LIKE 'RCP-%'
      GROUP BY json_extract(receipt_data, '$.receiptType')
    `);

    res.json({
      success: true,
      stats: {
        ...statsResult.rows[0],
        byType: byTypeResult.rows,
      },
    });
  } catch (error: any) {
    console.error('Error fetching receipt stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch receipt statistics',
      error: error.message,
    });
  }
});
