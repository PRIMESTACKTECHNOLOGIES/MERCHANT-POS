import { Router, Request, Response } from 'express';
import { db } from '../config/db';
import { v4 as uuidv4 } from 'uuid';

export const walletTransferRouter = Router();

  /**
   * GET /api/wallet-transfer/customers
   * Get all customers with their wallet info
   */
  walletTransferRouter.get('/customers', async (req: Request, res: Response) => {
    try {
      const result = await db.query(`
        SELECT 
          c.id,
          c.name,
          c.email,
          c.phone,
          cw.balance,
          cw.currency,
          cw.wallet_code,
          cw.status as wallet_status
        FROM customers c
        LEFT JOIN customer_wallets cw ON c.id = cw.customer_id
        WHERE cw.status = 'active'
        ORDER BY cw.balance DESC
      `);

      res.json({
        success: true,
        customers: result.rows,
      });
    } catch (error: any) {
      console.error('Error fetching customers:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch customers',
        error: error.message,
      });
    }
  });

  /**
   * POST /api/wallet-transfer/transfer
   * Transfer funds between customer wallets
   */
  walletTransferRouter.post('/transfer', async (req: Request, res: Response) => {
    try {
      const { senderCustomerId, receiverCustomerId, amount, note } = req.body;

      // Validation
      if (!senderCustomerId || !receiverCustomerId || !amount) {
        return res.status(400).json({
          success: false,
          message: 'Sender, receiver, and amount are required',
        });
      }

      if (senderCustomerId === receiverCustomerId) {
        return res.status(400).json({
          success: false,
          message: 'Cannot transfer to the same wallet',
        });
      }

      const transferAmount = parseFloat(amount);
      if (transferAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Transfer amount must be greater than 0',
        });
      }

      // Get sender wallet
      const senderResult = await db.query(`
        SELECT * FROM customer_wallets WHERE customer_id = ? AND status = 'active'
      `, [senderCustomerId]);

      if (senderResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Sender wallet not found',
        });
      }

      const senderWallet = senderResult.rows[0];

      // Check balance
      if (senderWallet.balance < transferAmount) {
        return res.status(400).json({
          success: false,
          message: `Insufficient balance. Available: $${senderWallet.balance.toFixed(2)}`,
        });
      }

      // Get receiver wallet
      const receiverResult = await db.query(`
        SELECT * FROM customer_wallets WHERE customer_id = ? AND status = 'active'
      `, [receiverCustomerId]);

      if (receiverResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Receiver wallet not found',
        });
      }

      // Deduct from sender
      await db.query(`
        UPDATE customer_wallets 
        SET balance = balance - ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE customer_id = ?
      `, [transferAmount, senderCustomerId]);

      // Add to receiver
      await db.query(`
        UPDATE customer_wallets 
        SET balance = balance + ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE customer_id = ?
      `, [transferAmount, receiverCustomerId]);

      // Record transfer
      const transferId = uuidv4();
      await db.query(`
        INSERT INTO wallet_transfers (
          id, sender_customer_id, receiver_customer_id, 
          amount, currency, note, status, fee, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 'COMPLETED', 0.00, CURRENT_TIMESTAMP)
      `, [transferId, senderCustomerId, receiverCustomerId, transferAmount, 'USD', note || null]);

      // Get customer names for response
      const senderNameResult = await db.query(`SELECT name FROM customers WHERE id = ?`, [senderCustomerId]);
      const receiverNameResult = await db.query(`SELECT name FROM customers WHERE id = ?`, [receiverCustomerId]);

      const result = {
        transferId,
        sender: senderNameResult.rows[0]?.name || 'Unknown',
        receiver: receiverNameResult.rows[0]?.name || 'Unknown',
        amount: transferAmount,
        currency: 'USD',
        note: note || '',
      };

      res.json({
        success: true,
        message: 'Transfer completed successfully',
        transfer: result,
      });
    } catch (error: any) {
      console.error('Error processing transfer:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to process transfer',
        error: error.message,
      });
    }
  });

  /**
   * GET /api/wallet-transfer/history
   * Get all wallet transfers with customer details
   */
  walletTransferRouter.get('/history', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;

      const result = await db.query(`
        SELECT 
          wt.id,
          wt.sender_customer_id,
          wt.receiver_customer_id,
          wt.amount,
          wt.currency,
          wt.note,
          wt.status,
          wt.fee,
          wt.created_at,
          sender.name as sender_name,
          receiver.name as receiver_name
        FROM wallet_transfers wt
        JOIN customers sender ON wt.sender_customer_id = sender.id
        JOIN customers receiver ON wt.receiver_customer_id = receiver.id
        ORDER BY wt.created_at DESC
        LIMIT ? OFFSET ?
      `, [limit, offset]);

      const totalResult = await db.query(`
        SELECT COUNT(*) as count FROM wallet_transfers
      `);

      res.json({
        success: true,
        transfers: result.rows,
        pagination: {
          total: totalResult.rows[0]?.count || 0,
          limit,
          offset,
          hasMore: offset + limit < (totalResult.rows[0]?.count || 0),
        },
      });
    } catch (error: any) {
      console.error('Error fetching transfer history:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch transfer history',
        error: error.message,
      });
    }
  });

  /**
   * GET /api/wallet-transfer/history/:customerId
   * Get transfer history for a specific customer
   */
  walletTransferRouter.get('/history/:customerId', async (req: Request, res: Response) => {
    try {
      const { customerId } = req.params;
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;

      const result = await db.query(`
        SELECT 
          wt.id,
          wt.sender_customer_id,
          wt.receiver_customer_id,
          wt.amount,
          wt.currency,
          wt.note,
          wt.status,
          wt.fee,
          wt.created_at,
          sender.name as sender_name,
          receiver.name as receiver_name,
          CASE 
            WHEN wt.sender_customer_id = ? THEN 'SENT'
            WHEN wt.receiver_customer_id = ? THEN 'RECEIVED'
          END as direction
        FROM wallet_transfers wt
        JOIN customers sender ON wt.sender_customer_id = sender.id
        JOIN customers receiver ON wt.receiver_customer_id = receiver.id
        WHERE wt.sender_customer_id = ? OR wt.receiver_customer_id = ?
        ORDER BY wt.created_at DESC
        LIMIT ? OFFSET ?
      `, [customerId, customerId, customerId, customerId, limit, offset]);

      const totalResult = await db.query(`
        SELECT COUNT(*) as count FROM wallet_transfers
        WHERE sender_customer_id = ? OR receiver_customer_id = ?
      `, [customerId, customerId]);

      res.json({
        success: true,
        transfers: result.rows,
        pagination: {
          total: totalResult.rows[0]?.count || 0,
          limit,
          offset,
          hasMore: offset + limit < (totalResult.rows[0]?.count || 0),
        },
      });
    } catch (error: any) {
      console.error('Error fetching customer transfer history:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch customer transfer history',
        error: error.message,
      });
    }
  });

  /**
   * GET /api/wallet-transfer/stats
   * Get transfer statistics
   */
  walletTransferRouter.get('/stats', async (req: Request, res: Response) => {
    try {
      const statsResult = await db.query(`
        SELECT 
          COUNT(*) as total_transfers,
          SUM(amount) as total_volume,
          AVG(amount) as average_amount,
          MIN(amount) as min_amount,
          MAX(amount) as max_amount
        FROM wallet_transfers
        WHERE status = 'COMPLETED'
      `);

      const recentResult = await db.query(`
        SELECT 
          wt.amount,
          wt.created_at,
          sender.name as sender_name,
          receiver.name as receiver_name
        FROM wallet_transfers wt
        JOIN customers sender ON wt.sender_customer_id = sender.id
        JOIN customers receiver ON wt.receiver_customer_id = receiver.id
        ORDER BY wt.created_at DESC
        LIMIT 10
      `);

      res.json({
        success: true,
        stats: {
          ...statsResult.rows[0],
          recentTransfers: recentResult.rows,
        },
      });
    } catch (error: any) {
      console.error('Error fetching transfer stats:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch transfer statistics',
        error: error.message,
      });
    }
  });
