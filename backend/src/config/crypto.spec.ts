/**
 * Cryptographic Algorithm Specifications
 * =====================================
 * Derived from Processor Application certification documents:
 *   - final 2.pptx: Cryptographic Tools (DES, 3DES, AES, RC4, Modes, Hash, MAC)
 *   - final 3.pptx: Public Key, RSA, Digital Signatures, Randomness
 *   - Table 2.1/2.2 Confirmed Parameters:
 *       DES:       Block=64bit, Key=56bit
 *       TripleDES: Block=64bit, Key=112bit (2-key) OR 168bit (3-key)
 *       AES:       Block=128bit, Key=128/192/256bit
 *
 * Authoritative spec for all Primestack crypto usage.
 * No other module should hard-code cipher sizes / modes / algorithms —
 * reference the constants exported here instead.
 */

export const BLOCK_SIZE = {
  DES: 8,
  TRIPLE_DES: 8,
  AES_128: 16,
  AES_192: 16,
  AES_256: 16,
} as const;

export const KEY_SIZE_BYTES = {
  DES: 7,
  DES_PARITY: 8,
  TRIPLE_DES_2KEY: 16,
  TRIPLE_DES_3KEY: 24,
  AES_128: 16,
  AES_192: 24,
  AES_256: 32,
  RC4_MIN: 5,
  RC4_MAX: 256,
  HMAC_SHA256: 32,
  HMAC_SHA512: 64,
  HMAC_SHA1: 20,
  HMAC_MD5: 16,
  RSA_2048: 256,
  RSA_3072: 384,
  RSA_4096: 512,
} as const;

export const IV_SIZE_BYTES = {
  DES_CBC: 8,
  TRIPLE_DES_CBC: 8,
  AES_CBC: 16,
  AES_CTR: 16,
  AES_GCM: 12,
} as const;

export type SymmetricCipher =
  | 'DES-ECB'
  | 'DES-CBC'
  | '3DES-ECB-2KEY'
  | '3DES-ECB-3KEY'
  | '3DES-CBC-2KEY'
  | '3DES-CBC-3KEY'
  | 'AES-128-ECB'
  | 'AES-128-CBC'
  | 'AES-192-ECB'
  | 'AES-192-CBC'
  | 'AES-256-ECB'
  | 'AES-256-CBC'
  | 'AES-256-GCM'
  | 'AES-256-CTR'
  | 'RC4';

export type HashAlgorithm =
  | 'md5'
  | 'sha1'
  | 'sha256'
  | 'sha384'
  | 'sha512';

export type MacAlgorithm =
  | 'retail-mac-3des'
  | 'cbc-mac-3des'
  | 'cbc-mac-aes'
  | 'hmac-md5'
  | 'hmac-sha1'
  | 'hmac-sha256'
  | 'hmac-sha512';

export type AsymmetricAlgorithm =
  | 'rsa-2048-oaep-sha256'
  | 'rsa-3072-oaep-sha384'
  | 'rsa-4096-oaep-sha512'
  | 'rsa-2048-pss-sha256'
  | 'rsa-3072-pss-sha384'
  | 'rsa-4096-pss-sha512'
  | 'ec-p256-ecdsa-sha256'
  | 'ec-p384-ecdsa-sha384';

export interface CipherSpec {
  cipher: SymmetricCipher;
  nodeCryptoName: string;
  blockBytes: number;
  keyBytes: number;
  ivBytes: number;
  fipsApproved: boolean;
}

export const CIPHER_SPECS: Record<SymmetricCipher, CipherSpec> = {
  'DES-ECB':        { cipher: 'DES-ECB',        nodeCryptoName: 'des-ecb',       blockBytes: 8,  keyBytes: 8,  ivBytes: 0,  fipsApproved: false },
  'DES-CBC':        { cipher: 'DES-CBC',        nodeCryptoName: 'des-cbc',       blockBytes: 8,  keyBytes: 8,  ivBytes: 8,  fipsApproved: false },
  '3DES-ECB-2KEY':  { cipher: '3DES-ECB-2KEY',  nodeCryptoName: 'des-ede3-ecb',  blockBytes: 8,  keyBytes: 16, ivBytes: 0,  fipsApproved: true  },
  '3DES-ECB-3KEY':  { cipher: '3DES-ECB-3KEY',  nodeCryptoName: 'des-ede3-ecb',  blockBytes: 8,  keyBytes: 24, ivBytes: 0,  fipsApproved: true  },
  '3DES-CBC-2KEY':  { cipher: '3DES-CBC-2KEY',  nodeCryptoName: 'des-ede3-cbc',  blockBytes: 8,  keyBytes: 16, ivBytes: 8,  fipsApproved: true  },
  '3DES-CBC-3KEY':  { cipher: '3DES-CBC-3KEY',  nodeCryptoName: 'des-ede3-cbc',  blockBytes: 8,  keyBytes: 24, ivBytes: 8,  fipsApproved: true  },
  'AES-128-ECB':    { cipher: 'AES-128-ECB',    nodeCryptoName: 'aes-128-ecb',    blockBytes: 16, keyBytes: 16, ivBytes: 0,  fipsApproved: true  },
  'AES-128-CBC':    { cipher: 'AES-128-CBC',    nodeCryptoName: 'aes-128-cbc',    blockBytes: 16, keyBytes: 16, ivBytes: 16, fipsApproved: true  },
  'AES-192-ECB':    { cipher: 'AES-192-ECB',    nodeCryptoName: 'aes-192-ecb',    blockBytes: 16, keyBytes: 24, ivBytes: 0,  fipsApproved: true  },
  'AES-192-CBC':    { cipher: 'AES-192-CBC',    nodeCryptoName: 'aes-192-cbc',    blockBytes: 16, keyBytes: 24, ivBytes: 16, fipsApproved: true  },
  'AES-256-ECB':    { cipher: 'AES-256-ECB',    nodeCryptoName: 'aes-256-ecb',    blockBytes: 16, keyBytes: 32, ivBytes: 0,  fipsApproved: true  },
  'AES-256-CBC':    { cipher: 'AES-256-CBC',    nodeCryptoName: 'aes-256-cbc',    blockBytes: 16, keyBytes: 32, ivBytes: 16, fipsApproved: true  },
  'AES-256-GCM':    { cipher: 'AES-256-GCM',    nodeCryptoName: 'aes-256-gcm',    blockBytes: 16, keyBytes: 32, ivBytes: 12, fipsApproved: true  },
  'AES-256-CTR':    { cipher: 'AES-256-CTR',    nodeCryptoName: 'aes-256-ctr',    blockBytes: 16, keyBytes: 32, ivBytes: 16, fipsApproved: true  },
  'RC4':            { cipher: 'RC4',            nodeCryptoName: 'rc4',           blockBytes: 1,  keyBytes: 16, ivBytes: 0,  fipsApproved: false },
} as const;

export const HASH_SPECS: Record<HashAlgorithm, { bytes: number; hexLength: number; fipsApproved: boolean; }> = {
  md5:    { bytes: 16, hexLength: 32,  fipsApproved: false },
  sha1:   { bytes: 20, hexLength: 40,  fipsApproved: false },
  sha256: { bytes: 32, hexLength: 64,  fipsApproved: true  },
  sha384: { bytes: 48, hexLength: 96,  fipsApproved: true  },
  sha512: { bytes: 64, hexLength: 128, fipsApproved: true  },
};

export const ISO_8583_SECURITY = {
  DEFAULT_MAC_ALGORITHM: 'retail-mac-3des' as MacAlgorithm,
  DEFAULT_MAC_FIELD: 64,
  DEFAULT_MAC_LENGTH_BYTES: 8,
  DEFAULT_MAC_KEY_TYPE: '3DES-ECB-2KEY' as SymmetricCipher,
  DEFAULT_PIN_BLOCK_FORMAT: 'ANSI_X9_8_FORMAT_0',
  DEFAULT_PIN_ENCRYPTION_KEY: '3DES-ECB-2KEY' as SymmetricCipher,
  DEFAULT_MESSAGE_ENCRYPTION: '3DES-CBC-2KEY' as SymmetricCipher,
  DEFAULT_HSM_EXPORT_KEY: '3DES-ECB-3KEY' as SymmetricCipher,
  EMV_ARQC_MAC: 'retail-mac-3des' as MacAlgorithm,
  EMV_ARPC_KEY: '3DES-ECB-2KEY' as SymmetricCipher,
  EMV_SDA_HASH: 'sha1' as HashAlgorithm,
  EMV_DDA_PUBKEY: 'rsa-2048-pss-sha256' as AsymmetricAlgorithm,
  EMV_CDA_HASH: 'sha256' as HashAlgorithm,
  API_SIGNATURE_ALGORITHM: 'hmac-sha256' as MacAlgorithm,
  WEBHOOK_SIGNATURE_ALGORITHM: 'hmac-sha512' as MacAlgorithm,
  AUDIT_LOG_HASH: 'sha256' as HashAlgorithm,
  JWT_SIGNATURE_ALGORITHM: 'rs256',
  JWT_HASH: 'sha256' as HashAlgorithm,
  CVV_HASH_KEY: '3DES-ECB-2KEY' as SymmetricCipher,
  PAN_ENCRYPTION: 'AES-256-GCM' as SymmetricCipher,
  PIN_BLOCK_WORKING_KEY: '3DES-ECB-3KEY' as SymmetricCipher,
};

export const EMV_CRYPTO_DEFAULTS = {
  UDK_DIVERSIFICATION: '3DES-ECB-2KEY' as SymmetricCipher,
  SESSION_KEY_DERIVATION: '3DES-ECB-2KEY' as SymmetricCipher,
  ATC_DIVERSIFICATION_BYTES: 10,
  ARQC_LENGTH_BYTES: 8,
  ARPC_LENGTH_BYTES: 8,
  IAD_LENGTH_MIN: 8,
  IAD_LENGTH_MAX: 32,
  UNPREDICTABLE_NUMBER_BYTES: 4,
  DEFAULT_CVN_VISA: 10,
  DEFAULT_CVN_MASTERCARD: 16,
  DEFAULT_CVN_UNIONPAY: 0x06,
  DEFAULT_TAC_DEFAULT: 'D313840000',
  DEFAULT_TAC_DENIAL: '0010000000',
  DEFAULT_TAC_ONLINE: 'FC4008A000',
  DEFAULT_TVR_ONLINE_FLAGS: 0x02,
  DEFAULT_TSI_FLAGS: 0x0000,
};

export const RANDOMNESS_REQUIREMENTS = {
  UNPREDICTABLE_NUMBER_BYTES: 4,
  IV_RANDOM_BYTES_DES: 8,
  IV_RANDOM_BYTES_AES: 16,
  NONCE_GCM_BYTES: 12,
  SESSION_ID_BYTES: 16,
  CSURF_TOKEN_BYTES: 32,
  TOTP_SECRET_BYTES: 20,
  BACKUP_CODE_BYTES: 4,
  PIN_TRY_COUNTER_MAX: 3,
  JTI_BYTES: 16,
  KSN_INITIAL_COUNTER: 1,
};

export const PROCESSOR_SECURITY_POLICY = {
  SYMMETRIC_MIN_APPROVED: 'AES-128' as SymmetricCipher | '3DES-ECB-2KEY' as SymmetricCipher,
  HASH_MIN_APPROVED: 'sha256' as HashAlgorithm,
  SIGNATURE_MIN_KEY_RSA_BITS: 2048,
  ALLOW_LEGACY_DES: true,
  ALLOW_RC4: false,
  REQUIRE_FIPS_APPROVED_CIPHERS: false,
  AUDIT_ALL_KEY_OPERATIONS: true,
  ROTATE_KEYS_AFTER_DAYS: 365,
  REISSUE_AFTER_COMPROMISE: true,
  PIN_MAX_LENGTH: 12,
  PIN_MIN_LENGTH: 4,
  MIN_PASSWORD_CHARS: 12,
  REQUIRE_MFA_FOR_CRYPTO_ADMIN: true,
  REQUIRE_IP_WHITELIST_FOR_HSM: true,
  DUAL_CONTROL_FOR_KEY_CEREMONY: true,
  KEY_SPLIT_N_OF_M: '2-3',
  PERMITTED_BLOCK_MODES: ['ECB', 'CBC', 'CFB', 'OFB', 'CTR', 'GCM'] as const,
  PERMITTED_HASHES: ['md5', 'sha1', 'sha256', 'sha384', 'sha512'] as const,
  FORBID_ECB_FOR_MESSAGE_DATA: true,
};

export const REGULATORY_COMPLIANCE_RA11917 = {
  MIN_SECURITY_STAFF_AGE: 21,
  MIN_SECURITY_OFFICER_AGE: 25,
  MIN_DEGREE_FOR_SECURITY_MANAGER: true,
  MIN_DEGREE_FOR_CONSULTANT: 'masters' as 'bachelor' | 'masters' | 'phd',
  MIN_CONSULTANT_EXPERIENCE_YEARS: 8,
  LICENSE_TYPE: 'LTO-PSTA',
  LICENSE_VALIDITY_YEARS: 2,
  PRE_LICENSING_INSPECTION_REQUIRED: true,
  INSPECTION_AUTHORITY: 'PNP-SOSIA',
  INSPECTOR_MIN_RANK: 'Police Commissioned Officer',
  INSPECTION_MIN_MEMBERS: 3,
  FIREARMS_PER_SECURITY_STAFF_MAX: 1,
  SMALL_ARMS_ONLY_FOR_GUARD_FORCES: true,
  WEAPONS_TRANSPORT_PERMIT_AUTHORITY: 'FEO-RCSU',
  SDDO_MAX_VALIDITY_DAYS: 30,
  MANDATORY_TRAINING_CATEGORIES: [
    'PLTC_PreLicensingTrainingCourse',
    'SecurityManagerCourse',
    'K9HandlerCourse',
    'BanksAndArmoredGuardCourse',
    'PrivateInvestigatorCourse',
    'SecurityOfficerCourse',
    'SecurityConsultantCourse',
    'RetrainingCourse',
    'SecuritySupervisoryCourse',
    'IntelligenceInvestigatorCourse',
    'CrisisManagementCourse',
    'VIPSecurityCourse',
    'ArmoredCarCrewCourse',
    'BankSecurityCourse',
    'AviationSecuritySpecialistCourse',
    'FirstResponderTraining',
    'BombIdentificationAwareness',
  ] as const,
  STORAGE_REQUIREMENTS_FOR_CRYPTO: 'HSM-equivalent secure storage or FIPS 140-2 Level 3',
  UNIFORM_AND_ID_REQUIRED: true,
  COUNTER_SIGN_CHAIN_OF_CUSTODY: true,
  PERIODIC_REINSPECTION_INTERVAL_YEARS: 2,
  RECERTIFICATION_REQUIRED: true,
  GOVERNMENT_ACCREDITATION_REQUIRED: true,
  FACILITY_SHOOTING_RANGE_FEO: true,
  DRILL_AREA_REQUIRED: true,
  CLASSROOM_PER_60_STUDENTS_SQM: 70,
  CLASSROOM_PER_30_STUDENTS_SQM: 35,
  PRIVATE_CLINIC_MOA_REQUIRED: true,
  NEURO_PSYCH_TEST_CENTER: true,
  REPORTING_PERIODIC_TO_AUTHORITY: true,
  INSPECTION_CHECKLIST_REQUIRED: true,
  I_TO_PSTA_GRANTING_AUTHORITY: 'CHIEF_PNP_VIA_CHIEF_SOSIA',
  LTO_PSTA_APPROVAL_AUTHORITY: 'CHIEF_PNP',
};

export type ComplianceTrainingCategory = typeof REGULATORY_COMPLIANCE_RA11917.MANDATORY_TRAINING_CATEGORIES[number];

export function validateKeyBytes(cipher: SymmetricCipher, key: Buffer): boolean {
  const spec = CIPHER_SPECS[cipher];
  if (!spec) return false;
  if (cipher === '3DES-ECB-2KEY' || cipher === '3DES-CBC-2KEY') {
    return key.length === 16 || key.length === 24;
  }
  return key.length === spec.keyBytes;
}

export function validateIvBytes(cipher: SymmetricCipher, iv: Buffer | null | undefined): boolean {
  const spec = CIPHER_SPECS[cipher];
  if (!spec) return false;
  if (spec.ivBytes === 0) return !iv || iv.length === 0;
  return !!iv && iv.length === spec.ivBytes;
}
