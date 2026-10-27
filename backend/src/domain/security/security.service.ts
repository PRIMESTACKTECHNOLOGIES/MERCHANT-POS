import { db } from "../../config/db";
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import {
  REGULATORY_COMPLIANCE_RA11917,
  PROCESSOR_SECURITY_POLICY,
  HASH_SPECS,
  type ComplianceTrainingCategory,
} from '../../config/crypto.spec';

/**
 * ENTERPRISE SECURITY SERVICE
 * Protects real funds with:
 * - Multi-Factor Authentication (MFA/2FA)
 * - Role-Based Access Control (RBAC)
 * - Audit Logging
 * - Withdrawal Limits
 * - IP Whitelisting
 * - Security Monitoring
 *
 * Regulatory (RA 11917 IRR / final 1.pdf):
 * - Min age: security staff 21, security officer/consultant 25
 * - 18 mandatory training categories (PLTC, SecurityManager, K9, Armored, Crisis, etc.)
 * - Max 1 small-arm firearm per security staff
 * - SDDO (Security Duty Detail Order) max validity: 30 days
 * - Pre-licensing PNP-SOSIA 3-person inspection team required
 * - Dual control + MFA mandatory for crypto admin per PROCESSOR_SECURITY_POLICY
 */

export interface SecurityStaffProfile {
  id?: string;
  fullName?: string;
  age: number;
  role: 'security_staff' | 'security_officer' | 'security_consultant' | 'security_manager' | 'crypto_admin';
  highestDegree?: 'high_school' | 'bachelor' | 'masters' | 'phd';
  yearsExperience?: number;
  completedTraining: readonly ComplianceTrainingCategory[];
  hasLicense?: boolean;
  firearmsAssignedCount?: number;
  mfaEnabled?: boolean;
}

export class SecurityService {

  // ═══════════════════════════════════════════════════════════════════════
  // MULTI-FACTOR AUTHENTICATION (MFA)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Enable MFA for a user
   */
  async enableMFA(userId: string, mfaType: 'TOTP' | 'SMS' = 'TOTP') {
    // Generate secret
    const secret = speakeasy.generateSecret({
      name: `POS System (${userId})`,
      length: 32
    });

    // Generate backup codes
    const backupCodes = this.generateBackupCodes(10);
    const backupCodesHash = backupCodes.map(code => 
      crypto.createHash('sha256').update(code).digest('hex')
    );

    // Store MFA token
    await db.query(`
      INSERT INTO mfa_tokens (id, user_id, mfa_type, secret, backup_codes, verified)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [uuidv4(), userId, mfaType, secret.base32, JSON.stringify(backupCodesHash), 0]);

    // Generate QR code
    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url!);

    await this.logSecurityEvent({
      event_type: 'MFA_ENABLED',
      severity: 'info',
      user_id: userId,
      action: 'Enable MFA',
      status: 'success'
    });

    return {
      secret: secret.base32,
      qrCode: qrCodeUrl,
      backupCodes: backupCodes // Show once, user must save
    };
  }

  /**
   * Verify MFA token
   */
  async verifyMFA(userId: string, token: string): Promise<boolean> {
    const result = await db.query(`
      SELECT * FROM mfa_tokens WHERE user_id = ? AND verified = 1
    `, [userId]);

    if (result.rowCount === 0) {
      return false;
    }

    const mfaToken = result.rows[0] as any;
    
    // Verify TOTP token
    const verified = speakeasy.totp.verify({
      secret: mfaToken.secret,
      encoding: 'base32',
      token: token,
      window: 2 // Allow 2 time steps before/after
    });

    if (verified) {
      // Update last used
      await db.query(`
        UPDATE mfa_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?
      `, [mfaToken.id]);

      await this.logSecurityEvent({
        event_type: 'MFA_VERIFIED',
        severity: 'info',
        user_id: userId,
        action: 'MFA verification',
        status: 'success'
      });

      return true;
    }

    // Check backup codes
    const backupCodes = JSON.parse(mfaToken.backup_codes || '[]');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    
    if (backupCodes.includes(tokenHash)) {
      // Remove used backup code
      const newCodes = backupCodes.filter((c: string) => c !== tokenHash);
      await db.query(`
        UPDATE mfa_tokens SET backup_codes = ? WHERE id = ?
      `, [JSON.stringify(newCodes), mfaToken.id]);

      await this.logSecurityEvent({
        event_type: 'MFA_BACKUP_CODE_USED',
        severity: 'warning',
        user_id: userId,
        action: 'Backup code used',
        status: 'success'
      });

      return true;
    }

    await this.logSecurityEvent({
      event_type: 'MFA_FAILED',
      severity: 'warning',
      user_id: userId,
      action: 'MFA verification',
      status: 'failed'
    });

    return false;
  }

  /**
   * Whether the user has an enrolled (verified) MFA device.
   * Step-up middleware uses this to decide if a challenge must be presented.
   */
  async isMFAEnrolled(userId: string): Promise<boolean> {
    const result = await db.query(
      `SELECT 1 FROM mfa_tokens WHERE user_id = ? AND verified = 1 LIMIT 1`,
      [userId]
    );
    return result.rowCount > 0;
  }

  /**
   * Generate backup codes
   */
  private generateBackupCodes(count: number): string[] {
    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
      const code = crypto.randomBytes(4).toString('hex').toUpperCase();
      codes.push(code);
    }
    return codes;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ROLE-BASED ACCESS CONTROL (RBAC)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Check if user has permission
   */
  async checkPermission(userId: string, permission: string): Promise<boolean> {
    // Get user roles
    const roles = await db.query(`
      SELECT r.* FROM user_roles r
      JOIN user_role_assignments ura ON r.id = ura.role_id
      WHERE ura.user_id = ?
      AND (ura.expires_at IS NULL OR ura.expires_at > datetime('now'))
    `, [userId]);

    if (roles.rowCount === 0) {
      return false;
    }

    // Check permissions
    for (const role of roles.rows as any[]) {
      const permissions = JSON.parse(role.permissions || '[]');
      
      // Super admin has all permissions
      if (permissions.includes('*')) {
        return true;
      }

      // Check exact permission
      if (permissions.includes(permission)) {
        return true;
      }

      // Check wildcard permissions (e.g., transactions.*)
      for (const perm of permissions) {
        if (perm.endsWith('.*')) {
          const prefix = perm.slice(0, -2);
          if (permission.startsWith(prefix + '.')) {
            return true;
          }
        }
      }
    }

    return false;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TRANSACTION APPROVALS (DUAL AUTHORIZATION)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Create approval request for high-value transaction
   */
  async createApprovalRequest(data: {
    transaction_id: string;
    transaction_type: string;
    amount: number;
    currency: string;
    initiated_by: string;
    approval_threshold: number;
    metadata?: any;
  }) {
    const id = uuidv4();
    
    // Set approval deadline (e.g., 24 hours)
    const deadline = new Date();
    deadline.setHours(deadline.getHours() + 24);

    await db.query(`
      INSERT INTO transaction_approvals (
        id, transaction_id, transaction_type, amount, currency,
        initiated_by, approval_threshold, approval_deadline, status, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      data.transaction_id,
      data.transaction_type,
      data.amount,
      data.currency,
      data.initiated_by,
      data.approval_threshold,
      deadline.toISOString(),
      'pending_approval',
      JSON.stringify(data.metadata || {})
    ]);

    await this.logSecurityEvent({
      event_type: 'APPROVAL_REQUESTED',
      severity: 'warning',
      user_id: data.initiated_by,
      action: `Request approval for ${data.transaction_type}`,
      resource_type: 'transaction_approval',
      resource_id: id,
      status: 'success'
    });

    // Create security alert
    await this.createSecurityAlert({
      alert_type: 'approval_required',
      severity: 'high',
      title: `Approval Required: ${data.transaction_type}`,
      message: `Transaction of ${data.currency} ${data.amount.toFixed(2)} requires approval`,
      alert_data: JSON.stringify(data)
    });

    return { approval_id: id };
  }

  /**
   * Approve transaction
   */
  async approveTransaction(approvalId: string, approvedBy: string) {
    // Check if approver is different from initiator
    const approval = await db.query(`
      SELECT * FROM transaction_approvals WHERE id = ?
    `, [approvalId]);

    if (approval.rowCount === 0) {
      throw new Error('Approval request not found');
    }

    const approvalData = approval.rows[0] as any;

    if (approvalData.initiated_by === approvedBy) {
      throw new Error('Cannot approve your own transaction');
    }

    // Check if approver has permission
    const hasPermission = await this.checkPermission(approvedBy, 'transactions.approve');
    if (!hasPermission) {
      throw new Error('User does not have approval permission');
    }

    await db.query(`
      UPDATE transaction_approvals
      SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [approvedBy, approvalId]);

    await this.logSecurityEvent({
      event_type: 'TRANSACTION_APPROVED',
      severity: 'info',
      user_id: approvedBy,
      action: 'Approve transaction',
      resource_type: 'transaction_approval',
      resource_id: approvalId,
      status: 'success'
    });

    return { status: 'approved' };
  }

  /**
   * Reject transaction
   */
  async rejectTransaction(approvalId: string, rejectedBy: string, reason: string) {
    await db.query(`
      UPDATE transaction_approvals
      SET status = 'rejected', rejected_by = ?, rejected_at = CURRENT_TIMESTAMP, rejection_reason = ?
      WHERE id = ?
    `, [rejectedBy, reason, approvalId]);

    await this.logSecurityEvent({
      event_type: 'TRANSACTION_REJECTED',
      severity: 'warning',
      user_id: rejectedBy,
      action: 'Reject transaction',
      resource_type: 'transaction_approval',
      resource_id: approvalId,
      status: 'success',
      metadata: JSON.stringify({ reason })
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // WITHDRAWAL LIMITS & VELOCITY CHECKS
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Check withdrawal limit
   */
  async checkWithdrawalLimit(entityId: string, entityType: string, amount: number, currency: string = 'USD'): Promise<{
    allowed: boolean;
    reason?: string;
    current_usage: number;
    limit_amount: number;
  }> {
    // Get active limits
    const limits = await db.query(`
      SELECT * FROM withdrawal_limits
      WHERE (
        (entity_type = 'merchant' AND merchant_id = ?) OR
        (entity_type = 'customer' AND customer_id = ?) OR
        (entity_type = 'user' AND user_id = ?)
      )
      AND currency = ?
      AND status = 'active'
      AND datetime('now') BETWEEN period_start AND period_end
    `, [entityId, entityId, entityId, currency]);

    if (limits.rowCount === 0) {
      // No limits set = allowed
      return { allowed: true, current_usage: 0, limit_amount: 0 };
    }

    for (const limit of limits.rows as any[]) {
      const newUsage = limit.current_usage + amount;
      
      if (newUsage > limit.limit_amount) {
        await this.createSecurityAlert({
          alert_type: 'withdrawal_limit_exceeded',
          severity: 'high',
          entity_id: entityId,
          title: 'Withdrawal Limit Exceeded',
          message: `Attempted withdrawal of ${currency} ${amount} exceeds ${limit.limit_type} limit of ${currency} ${limit.limit_amount}`,
          alert_data: JSON.stringify({ limit, attempted_amount: amount })
        });

        return {
          allowed: false,
          reason: `Withdrawal exceeds ${limit.limit_type} limit`,
          current_usage: limit.current_usage,
          limit_amount: limit.limit_amount
        };
      }
    }

    return { allowed: true, current_usage: 0, limit_amount: 0 };
  }

  /**
   * Update withdrawal limit usage
   */
  async updateWithdrawalUsage(entityId: string, entityType: string, amount: number, currency: string = 'USD') {
    await db.query(`
      UPDATE withdrawal_limits
      SET current_usage = current_usage + ?, updated_at = CURRENT_TIMESTAMP
      WHERE (
        (entity_type = 'merchant' AND merchant_id = ?) OR
        (entity_type = 'customer' AND customer_id = ?) OR
        (entity_type = 'user' AND user_id = ?)
      )
      AND currency = ?
      AND status = 'active'
      AND datetime('now') BETWEEN period_start AND period_end
    `, [amount, entityId, entityId, entityId, currency]);
  }

  /**
   * Check withdrawal velocity (detect rapid withdrawals)
   */
  async checkWithdrawalVelocity(entityId: string, entityType: string, amount: number): Promise<{
    suspicious: boolean;
    reason?: string;
  }> {
    // Check last 1 hour
    const oneHourAgo = new Date();
    oneHourAgo.setHours(oneHourAgo.getHours() - 1);

    const velocity = await db.query(`
      SELECT * FROM withdrawal_velocity_tracking
      WHERE entity_id = ? AND entity_type = ?
      AND window_end > ?
      AND status = 'active'
    `, [entityId, entityType, oneHourAgo.toISOString()]);

    if (velocity.rowCount === 0) {
      // Create new velocity window
      const windowEnd = new Date();
      windowEnd.setMinutes(windowEnd.getMinutes() + 60);
      
      await db.query(`
        INSERT INTO withdrawal_velocity_tracking (
          id, entity_id, entity_type, time_window_minutes,
          withdrawal_count, total_amount, window_start, window_end
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [uuidv4(), entityId, entityType, 60, 1, amount, new Date().toISOString(), windowEnd.toISOString()]);
      
      return { suspicious: false };
    }

    const vel = velocity.rows[0] as any;
    const newCount = vel.withdrawal_count + 1;
    const newTotal = vel.total_amount + amount;

    // Suspicious if more than 5 withdrawals in 1 hour
    if (newCount > 5) {
      await this.createSecurityAlert({
        alert_type: 'high_velocity_withdrawal',
        severity: 'critical',
        entity_id: entityId,
        title: 'Suspicious Withdrawal Activity',
        message: `${newCount} withdrawals in 1 hour (total: $${newTotal.toFixed(2)})`,
        alert_data: JSON.stringify({ entity_id: entityId, count: newCount, total: newTotal })
      });

      return {
        suspicious: true,
        reason: 'Too many withdrawals in short time period'
      };
    }

    // Update velocity
    await db.query(`
      UPDATE withdrawal_velocity_tracking
      SET withdrawal_count = ?, total_amount = ?
      WHERE id = ?
    `, [newCount, newTotal, vel.id]);

    return { suspicious: false };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // IP WHITELISTING
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Check if IP is whitelisted
   */
  async checkIPWhitelist(userId: string, ipAddress: string): Promise<boolean> {
    const result = await db.query(`
      SELECT * FROM ip_whitelist
      WHERE user_id = ?
      AND (ip_address = ? OR ? LIKE ip_range || '%')
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > datetime('now'))
    `, [userId, ipAddress, ipAddress]);

    if (result.rowCount > 0) {
      // Update last used
      await db.query(`
        UPDATE ip_whitelist SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?
      `, [(result.rows[0] as any).id]);
      return true;
    }

    // Log unauthorized IP
    await this.logSecurityEvent({
      event_type: 'UNAUTHORIZED_IP',
      severity: 'warning',
      user_id: userId,
      ip_address: ipAddress,
      action: 'Access attempt from non-whitelisted IP',
      status: 'blocked'
    });

    return false;
  }

  /**
   * Whether the user has any active IP whitelist entries.
   * When none are configured, IP enforcement is a no-op for that user.
   */
  async hasActiveIPWhitelist(userId: string): Promise<boolean> {
    const result = await db.query(`
      SELECT 1 FROM ip_whitelist
      WHERE user_id = ?
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > datetime('now'))
      LIMIT 1
    `, [userId]);
    return result.rowCount > 0;
  }

  /**
   * Add IP to whitelist
   */
  async addIPToWhitelist(userId: string, ipAddress: string, label: string, addedBy: string, expiresAt?: string) {
    await db.query(`
      INSERT INTO ip_whitelist (id, user_id, ip_address, label, added_by, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [uuidv4(), userId, ipAddress, label, addedBy, expiresAt || null]);

    await this.logSecurityEvent({
      event_type: 'IP_WHITELISTED',
      severity: 'info',
      user_id: addedBy,
      action: `Whitelist IP ${ipAddress} for user ${userId}`,
      status: 'success'
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SECURITY AUDIT LOGGING
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Log security event
   */
  async logSecurityEvent(event: {
    event_type: string;
    severity: 'info' | 'warning' | 'error' | 'critical';
    user_id?: string;
    ip_address?: string;
    user_agent?: string;
    action: string;
    resource_type?: string;
    resource_id?: string;
    old_value?: string;
    new_value?: string;
    status: 'success' | 'failed' | 'blocked';
    error_message?: string;
    metadata?: string;
  }) {
    await db.query(`
      INSERT INTO security_audit_log (
        id, event_type, severity, user_id, ip_address, user_agent,
        action, resource_type, resource_id, old_value, new_value,
        status, error_message, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      uuidv4(),
      event.event_type,
      event.severity,
      event.user_id || null,
      event.ip_address || null,
      event.user_agent || null,
      event.action,
      event.resource_type || null,
      event.resource_id || null,
      event.old_value || null,
      event.new_value || null,
      event.status,
      event.error_message || null,
      event.metadata || null
    ]);
  }

  /**
   * Get security audit log
   */
  async getAuditLog(filters: {
    user_id?: string;
    event_type?: string;
    start_date?: string;
    end_date?: string;
    limit?: number;
  }) {
    let query = 'SELECT * FROM security_audit_log WHERE 1=1';
    const params: any[] = [];

    if (filters.user_id) {
      query += ' AND user_id = ?';
      params.push(filters.user_id);
    }

    if (filters.event_type) {
      query += ' AND event_type = ?';
      params.push(filters.event_type);
    }

    if (filters.start_date) {
      query += ' AND created_at >= ?';
      params.push(filters.start_date);
    }

    if (filters.end_date) {
      query += ' AND created_at <= ?';
      params.push(filters.end_date);
    }

    query += ' ORDER BY created_at DESC';

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }

    const result = await db.query(query, params);
    return result.rows;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SECURITY ALERTS
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Create security alert
   */
  async createSecurityAlert(alert: {
    alert_type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    user_id?: string;
    entity_id?: string;
    title: string;
    message: string;
    alert_data?: string;
  }) {
    await db.query(`
      INSERT INTO security_alerts (
        id, alert_type, severity, user_id, entity_id, title, message, alert_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      uuidv4(),
      alert.alert_type,
      alert.severity,
      alert.user_id || null,
      alert.entity_id || null,
      alert.title,
      alert.message,
      alert.alert_data || null
    ]);

    // TODO: Send notification (email/SMS) based on severity
  }

  /**
   * Get active security alerts
   */
  async getActiveAlerts(filters?: { severity?: string; user_id?: string }) {
    let query = 'SELECT * FROM security_alerts WHERE status = ?';
    const params: any[] = ['active'];

    if (filters?.severity) {
      query += ' AND severity = ?';
      params.push(filters.severity);
    }

    if (filters?.user_id) {
      query += ' AND user_id = ?';
      params.push(filters.user_id);
    }

    query += ' ORDER BY created_at DESC';

    const result = await db.query(query, params);
    return result.rows;
  }

  /**
   * Acknowledge alert
   */
  async acknowledgeAlert(alertId: string, acknowledgedBy: string) {
    await db.query(`
      UPDATE security_alerts
      SET acknowledged_by = ?, acknowledged_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [acknowledgedBy, alertId]);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // REGULATORY COMPLIANCE — RA 11917 IRR (final 1.pdf)
  // ═══════════════════════════════════════════════════════════════════════

  private readonly REQUIRED_STAFF_TRAINING_MIN: readonly ComplianceTrainingCategory[] =
    REGULATORY_COMPLIANCE_RA11917.MANDATORY_TRAINING_CATEGORIES;

  validateStaffCompliance(staff: SecurityStaffProfile): {
    compliant: boolean;
    failures: string[];
    warnings: string[];
  } {
    const failures: string[] = [];
    const warnings: string[] = [];
    const RC = REGULATORY_COMPLIANCE_RA11917;
    const PSP = PROCESSOR_SECURITY_POLICY;

    const minAge =
      staff.role === 'security_consultant' || staff.role === 'security_officer' ||
      staff.role === 'security_manager' || staff.role === 'crypto_admin'
        ? RC.MIN_SECURITY_OFFICER_AGE
        : RC.MIN_SECURITY_STAFF_AGE;
    if (!Number.isFinite(staff.age) || staff.age < minAge) {
      failures.push(`Age ${staff.age} below minimum ${minAge} for role "${staff.role}" (RA 11917)`);
    }

    if (staff.role === 'security_consultant') {
      const degreeOk =
        staff.highestDegree === 'masters' || staff.highestDegree === 'phd' ||
        staff.highestDegree === 'bachelor';
      const yearsOk =
        (staff.highestDegree === 'bachelor' && (staff.yearsExperience || 0) >= RC.MIN_CONSULTANT_EXPERIENCE_YEARS) ||
        (staff.highestDegree === 'masters' || staff.highestDegree === 'phd');
      if (!degreeOk || !yearsOk) {
        failures.push(`Security Consultant requires (Master's degree) OR (Bachelor's + ${RC.MIN_CONSULTANT_EXPERIENCE_YEARS}yr experience) — RA 11917 IRR`);
      }
    }

    if (staff.role === 'security_manager' && !staff.highestDegree && RC.MIN_DEGREE_FOR_SECURITY_MANAGER) {
      warnings.push('Security Manager: degree verification recommended per RA 11917');
    }

    const missingTraining = this.REQUIRED_STAFF_TRAINING_MIN.filter(
      (cat) => !staff.completedTraining.includes(cat)
    );
    if (missingTraining.length > 0) {
      failures.push(`Missing mandatory training categories (RA 11917): ${missingTraining.join(', ')}`);
    }

    if (!staff.hasLicense && RC.PRE_LICENSING_INSPECTION_REQUIRED && staff.role !== 'crypto_admin') {
      warnings.push(`License (I-TO-PSTA → LTO-PSTA via Chief PNP) recommended for role "${staff.role}" — pre-licensing SOSIA inspection required`);
    }

    const firearmRatio = this.validateFirearmCustodyRatio(staff.firearmsAssignedCount || 0, 1);
    if (!firearmRatio.compliant) {
      failures.push(...firearmRatio.failures);
    }

    if (staff.role === 'crypto_admin' && PSP.REQUIRE_MFA_FOR_CRYPTO_ADMIN && !staff.mfaEnabled) {
      failures.push('Crypto Admin requires MFA enabled (PROCESSOR_SECURITY_POLICY.REQUIRE_MFA_FOR_CRYPTO_ADMIN)');
    }

    return {
      compliant: failures.length === 0,
      failures,
      warnings,
    };
  }

  validateSddoValidity(validityDays: number): {
    compliant: boolean;
    failures: string[];
  } {
    const maxDays = REGULATORY_COMPLIANCE_RA11917.SDDO_MAX_VALIDITY_DAYS;
    if (!Number.isFinite(validityDays) || validityDays <= 0) {
      return { compliant: false, failures: [`SDDO validity must be a positive number of days`] };
    }
    if (validityDays > maxDays) {
      return {
        compliant: false,
        failures: [`SDDO validity ${validityDays}d exceeds RA 11917 max of ${maxDays} days`],
      };
    }
    return { compliant: true, failures: [] };
  }

  validateFirearmCustodyRatio(firearmCount: number, staffCount: number): {
    compliant: boolean;
    failures: string[];
  } {
    const failures: string[] = [];
    const maxPerStaff = REGULATORY_COMPLIANCE_RA11917.FIREARMS_PER_SECURITY_STAFF_MAX;
    if (staffCount <= 0 && firearmCount > 0) {
      failures.push(`Cannot assign ${firearmCount} firearms to 0 staff`);
    } else if (staffCount > 0 && firearmCount / staffCount > maxPerStaff) {
      failures.push(
        `Firearm ratio ${firearmCount}:${staffCount} exceeds RA 11917 limit of ${maxPerStaff} per security staff (small arms only)`
      );
    }
    if (REGULATORY_COMPLIANCE_RA11917.SMALL_ARMS_ONLY_FOR_GUARD_FORCES) {
      // Marking only; caliber verification requires firearms registry integration
    }
    return { compliant: failures.length === 0, failures };
  }

  async enforceCryptoAdminMfaRequirement(userId: string): Promise<void> {
    if (!PROCESSOR_SECURITY_POLICY.REQUIRE_MFA_FOR_CRYPTO_ADMIN) return;
    const isCryptoAdmin = await this.checkPermission(userId, 'crypto.admin');
    if (!isCryptoAdmin) return;
    const mfaCheck = await db.query(`
      SELECT 1 FROM mfa_tokens WHERE user_id = ? AND verified = 1 LIMIT 1
    `, [userId]);
    if (mfaCheck.rowCount === 0) {
      throw new Error('SECURITY: crypto.admin role requires verified MFA (PROCESSOR_SECURITY_POLICY.REQUIRE_MFA_FOR_CRYPTO_ADMIN)');
    }
  }

  async validateKeyCeremonyDualControl(initiatorId: string, approverId: string): Promise<{
    compliant: boolean;
    failures: string[];
  }> {
    const failures: string[] = [];
    const PSP = PROCESSOR_SECURITY_POLICY;
    const RC = REGULATORY_COMPLIANCE_RA11917;

    if (PSP.DUAL_CONTROL_FOR_KEY_CEREMONY) {
      if (!initiatorId || !approverId) {
        failures.push('Key ceremony requires both initiator and approver (dual control)');
      } else if (initiatorId === approverId) {
        failures.push('Key ceremony initiator and approver must be different people (dual control / N-of-M: ' + PSP.KEY_SPLIT_N_OF_M + ')');
      } else {
          const initPerm = await this.checkPermission(initiatorId, 'keys.initiate');
          const apprPerm = await this.checkPermission(approverId, 'keys.approve');
          if (!initPerm) failures.push(`Initiator ${initiatorId} lacks keys.initiate permission`);
          if (!apprPerm) failures.push(`Approver ${approverId} lacks keys.approve permission`);
        }
    }

    if (PSP.REQUIRE_MFA_FOR_CRYPTO_ADMIN) {
      const initMfa = await db.query(`SELECT 1 FROM mfa_tokens WHERE user_id = ? AND verified = 1 LIMIT 1`, [initiatorId]);
      const apprMfa = approverId ? await db.query(`SELECT 1 FROM mfa_tokens WHERE user_id = ? AND verified = 1 LIMIT 1`, [approverId]) : { rowCount: 0 };
      if (initiatorId && initMfa.rowCount === 0) failures.push('Key ceremony initiator must have verified MFA');
      if (approverId && apprMfa.rowCount === 0 && PSP.DUAL_CONTROL_FOR_KEY_CEREMONY) failures.push('Key ceremony approver must have verified MFA');
    }

    if (RC.COUNTER_SIGN_CHAIN_OF_CUSTODY && PSP.AUDIT_ALL_KEY_OPERATIONS) {
      // Chain-of-custody countersign requirement is enforced by logSecurityEvent on caller side; no DB assertion here
    }

    return { compliant: failures.length === 0, failures };
  }

  validatePreLicensingInspection(team: {
    leaderRank: string;
    memberCount: number;
    authority: string;
    letterOrderIssued: boolean;
  }): { compliant: boolean; failures: string[] } {
    const RC = REGULATORY_COMPLIANCE_RA11917;
    const failures: string[] = [];
    if (!RC.PRE_LICENSING_INSPECTION_REQUIRED) return { compliant: true, failures: [] };
    if (!team.letterOrderIssued) {
      failures.push('Pre-licensing inspection requires Letter Order by SOSIA Chief (RA 11917 Sec 48)');
    }
    if (team.memberCount < RC.INSPECTION_MIN_MEMBERS) {
      failures.push(`Inspection team must have min ${RC.INSPECTION_MIN_MEMBERS} members (RA 11917 Sec 48)`);
    }
    const authNorm = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, '');
    if (authNorm(team.authority) !== authNorm(RC.INSPECTION_AUTHORITY)) {
      failures.push(`Inspection must be conducted by ${RC.INSPECTION_AUTHORITY} (RA 11917)`);
    }
    const leaderRankOk = /Police Commissioned Officer/i.test(team.leaderRank) || /PCO/i.test(team.leaderRank) || /Commissioned/i.test(team.leaderRank);
    if (!leaderRankOk && RC.INSPECTOR_MIN_RANK) {
      failures.push(`Inspection team leader must be a ${RC.INSPECTOR_MIN_RANK} (RA 11917 Sec 48)`);
    }
    return { compliant: failures.length === 0, failures };
  }

  getRegulatoryComplianceSummary(): Readonly<Record<string, unknown>> {
    const RC = REGULATORY_COMPLIANCE_RA11917;
    const PSP = PROCESSOR_SECURITY_POLICY;
    return Object.freeze({
      regulator: RC.INSPECTION_AUTHORITY,
      licenseType: RC.LICENSE_TYPE,
      licenseValidityYears: RC.LICENSE_VALIDITY_YEARS,
      approverChain: {
        iToPsta: RC.I_TO_PSTA_GRANTING_AUTHORITY,
        ltoPsta: RC.LTO_PSTA_APPROVAL_AUTHORITY,
      },
      minAges: {
        securityStaff: RC.MIN_SECURITY_STAFF_AGE,
        officerOrConsultant: RC.MIN_SECURITY_OFFICER_AGE,
      },
      maxFirearmsPerStaff: RC.FIREARMS_PER_SECURITY_STAFF_MAX,
      sddoMaxDays: RC.SDDO_MAX_VALIDITY_DAYS,
      requiredTrainingCount: RC.MANDATORY_TRAINING_CATEGORIES.length,
      reinspectionIntervalYears: RC.PERIODIC_REINSPECTION_INTERVAL_YEARS,
      cryptoAdminRequiresMfa: PSP.REQUIRE_MFA_FOR_CRYPTO_ADMIN,
      dualControlForKeyCeremony: PSP.DUAL_CONTROL_FOR_KEY_CEREMONY,
      keySplitNofM: PSP.KEY_SPLIT_N_OF_M,
      storageRequirement: RC.STORAGE_REQUIREMENTS_FOR_CRYPTO,
      hashAuditTrailRequired: RC.COUNTER_SIGN_CHAIN_OF_CUSTODY,
    });
  }

  async assignRole(userId: string, roleId: string, assignedBy: string, expiresAt?: string) {
    if (roleId.toLowerCase().includes('crypto') || roleId.toLowerCase().includes('admin')) {
      const result = await db.query(`SELECT permissions FROM user_roles WHERE id = ? LIMIT 1`, [roleId]);
      if (result.rowCount > 0) {
        const perms = JSON.parse((result.rows[0] as any).permissions || '[]') as string[];
        if (perms.includes('crypto.admin') || perms.includes('*')) {
          const mfaOk = await db.query(`SELECT 1 FROM mfa_tokens WHERE user_id = ? AND verified = 1 LIMIT 1`, [userId]);
          if (mfaOk.rowCount === 0 && PROCESSOR_SECURITY_POLICY.REQUIRE_MFA_FOR_CRYPTO_ADMIN) {
            throw new Error('Cannot assign crypto/admin role: user must have verified MFA first (PROCESSOR_SECURITY_POLICY.REQUIRE_MFA_FOR_CRYPTO_ADMIN)');
          }
        }
      }
    }
    return this.assignRoleCore(userId, roleId, assignedBy, expiresAt);
  }

  private async assignRoleCore(userId: string, roleId: string, assignedBy: string, expiresAt?: string) {
    // Check if already assigned
    const existing = await db.query(`
      SELECT * FROM user_role_assignments WHERE user_id = ? AND role_id = ?
    `, [userId, roleId]);

    if (existing.rowCount > 0) {
      throw new Error('Role already assigned to user');
    }

    await db.query(`
      INSERT INTO user_role_assignments (id, user_id, role_id, assigned_by, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `, [uuidv4(), userId, roleId, assignedBy, expiresAt || null]);

    await this.logSecurityEvent({
      event_type: 'ROLE_ASSIGNED',
      severity: 'info',
      user_id: assignedBy,
      action: `Assign role ${roleId} to user ${userId}`,
      resource_type: 'user_role',
      resource_id: userId,
      status: 'success'
    });
  }

  hashAuditRecord(recordId: string, recordJson: string): string {
    return crypto
      .createHash(PROCESSOR_SECURITY_POLICY.HASH_MIN_APPROVED)
      .update(recordId + '|' + recordJson)
      .digest('hex');
  }
}

export const securityService = new SecurityService();
