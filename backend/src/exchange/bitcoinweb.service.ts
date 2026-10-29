/**
 * Bitcoin (BTC) Hot Wallet Service — native SegWit (BIP-84) via an
 * Esplora-compatible HTTP API. No SDK, no native bitcoin node required.
 *
 * .env / provider-config keys (all optional — the wallet can be created from
 * the Hot Wallet dashboard, which stores the secrets encrypted at rest):
 *   BTC_WALLET_ADDRESS   → hot wallet receive address (tb1q… on testnet)
 *   BTC_WALLET_WIF       → hot wallet private key, WIF-encoded
 *   BTC_WALLET_MNEMONIC  → 24-word BIP-39 recovery phrase
 *   BTC_NETWORK          → testnet (default) | mainnet
 *   BTC_ESPLORA          → Esplora API base
 *
 * WALLET SEGREGATION (same directive as the Tron hot wallet):
 *   The BTC hot wallet is a receive-and-hold address for BTC swept in from
 *   external wallets. The private key never leaves this module unless an
 *   operator explicitly asks for the one-time backup on creation.
 */

import axios from 'axios';
import crypto from 'crypto';

export type BtcNetworkId = 'testnet' | 'mainnet';

const SATS_PER_BTC = 100_000_000;

// BIP-84 native SegWit, account 0, external chain, first address.
// Coin type is part of the path: 1' = testnet, 0' = mainnet. Deriving the
// testnet path on mainnet would produce an unrecoverable address.
export function getBtcDerivationPath(): string {
  return getBtcNetworkId() === 'mainnet' ? "m/84'/0'/0'/0/0" : "m/84'/1'/0'/0/0";
}

export function getBtcNetworkId(): BtcNetworkId {
  const raw = (process.env.BTC_NETWORK || 'testnet').trim().toLowerCase();
  return raw === 'mainnet' || raw === 'bitcoin' || raw === 'main' ? 'mainnet' : 'testnet';
}

function bitcoinLib(): any {
  return require('bitcoinjs-lib');
}

function bitcoinNetwork(): any {
  const bitcoin = bitcoinLib();
  return getBtcNetworkId() === 'mainnet' ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
}

function sha256(data: Buffer): Buffer {
  return crypto.createHash('sha256').update(data).digest();
}

function base58(): any {
  const mod: any = require('bs58');
  return mod?.encode ? mod : mod?.default ?? mod;
}

/** WIF version byte: 0x80 mainnet, 0xef testnet. */
function wifVersionByte(): number {
  return getBtcNetworkId() === 'mainnet' ? 0x80 : 0xef;
}

/**
 * Encode a 32-byte private key as WIF: base58check(version ‖ privkey ‖ 0x01).
 * The trailing 0x01 marks the key compressed, which native SegWit requires.
 * Pure hashing + base58 — deliberately avoids `ecpair`/`tiny-secp256k1`, whose
 * WASM fails to compile on some Node builds and is not needed for WIF.
 */
export function encodeWif(privateKey: Buffer): string {
  const payload = Buffer.concat([Buffer.from([wifVersionByte()]), Buffer.from(privateKey), Buffer.from([0x01])]);
  const checksum = sha256(sha256(payload)).subarray(0, 4);
  return base58().encode(Buffer.concat([payload, checksum]));
}

export interface DecodedWif {
  privateKey: Buffer;
  compressed: boolean;
  network: BtcNetworkId;
}

/** Decode + verify a WIF (checksum included). Throws when malformed. */
export function decodeWif(wif: string): DecodedWif {
  const raw = Buffer.from(base58().decode(wif.trim()));
  if (raw.length !== 38 && raw.length !== 37) throw new Error('Invalid WIF length');
  const payload = raw.subarray(0, raw.length - 4);
  const checksum = raw.subarray(raw.length - 4);
  if (!sha256(sha256(payload)).subarray(0, 4).equals(checksum)) throw new Error('Invalid WIF checksum');

  const version = raw[0];
  if (version !== 0x80 && version !== 0xef) throw new Error('Invalid WIF version byte');

  const compressed = raw.length === 38;
  if (compressed && raw[33] !== 0x01) throw new Error('Invalid WIF compression flag');

  return {
    privateKey: raw.subarray(1, 33),
    compressed,
    network: version === 0x80 ? 'mainnet' : 'testnet',
  };
}

export function getHotWalletAddress(): string {
  return (process.env.BTC_WALLET_ADDRESS || '').trim();
}

export function isHotWalletConfigured(): boolean {
  return Boolean(getHotWalletAddress());
}

export function getEsploraBase(): string {
  const configured = (process.env.BTC_ESPLORA || '').trim();
  if (configured) return configured.replace(/\/+$/, '');
  return getBtcNetworkId() === 'mainnet'
    ? 'https://mempool.space/api'
    : 'https://mempool.space/testnet/api';
}

export function explorerAddressUrl(address: string = getHotWalletAddress()): string {
  const host = getBtcNetworkId() === 'mainnet' ? 'mempool.space' : 'mempool.space/testnet';
  return `https://${host}/address/${address || ''}`;
}

/** Live on-chain balance of the hot wallet, in BTC (0 when unconfigured/unreachable). */
export async function getHotWalletBtcBalance(): Promise<number> {
  const address = getHotWalletAddress();
  if (!address) return 0;
  try {
    const { data } = await axios.get(`${getEsploraBase()}/address/${address}`, { timeout: 12_000 });
    const chain = data?.chain_stats || {};
    const mempool = data?.mempool_stats || {};
    const sats =
      (Number(chain.funded_txo_sum || 0) - Number(chain.spent_txo_sum || 0)) +
      (Number(mempool.funded_txo_sum || 0) - Number(mempool.spent_txo_sum || 0));
    return sats / SATS_PER_BTC;
  } catch (e: any) {
    console.warn('[BTC] balance lookup failed:', e?.message);
    return 0;
  }
}

/** Confirmed + pending received total, in BTC — useful for a "BTC in transit" hint. */
export async function getHotWalletBtcReceived(): Promise<number> {
  const address = getHotWalletAddress();
  if (!address) return 0;
  try {
    const { data } = await axios.get(`${getEsploraBase()}/address/${address}`, { timeout: 12_000 });
    const sats =
      Number(data?.chain_stats?.funded_txo_sum || 0) +
      Number(data?.mempool_stats?.funded_txo_sum || 0);
    return sats / SATS_PER_BTC;
  } catch {
    return 0;
  }
}

export interface BtcHotWalletStatus {
  address: string;
  network: BtcNetworkId;
  configured: boolean;
  esplora: string;
  explorerUrl: string;
  balanceBtc: number;
  derivationPath: string;
  unavailableReason?: string;
}

export async function getHotWalletStatus(): Promise<BtcHotWalletStatus> {
  const address = getHotWalletAddress();
  const network = getBtcNetworkId();
  return {
    address,
    network,
    configured: Boolean(address),
    esplora: getEsploraBase(),
    explorerUrl: explorerAddressUrl(address),
    balanceBtc: await getHotWalletBtcBalance(),
    derivationPath: getBtcDerivationPath(),
    ...(address ? {} : { unavailableReason: 'No BTC hot wallet yet — create one from the Hot Wallet dashboard.' }),
  };
}

export interface GeneratedBtcHotWallet {
  address: string;
  /** WIF-encoded private key. Show ONCE for backup; never log or persist in plaintext. */
  wif: string;
  /** BIP-39 recovery phrase. Show ONCE for backup; never log or persist in plaintext. */
  mnemonic: string;
  network: BtcNetworkId;
  derivationPath: string;
}

/**
 * Derive a BIP-84 native SegWit (tb1q… / bc1q…) address from a BIP-39 seed.
 */
export async function deriveHotWalletFromMnemonic(mnemonic: string): Promise<Omit<GeneratedBtcHotWallet, 'mnemonic'>> {
  const bip39: any = await import('@scure/bip39');
  const { HDKey } = await import('@scure/bip32');

  const seed = bip39.mnemonicToSeedSync(mnemonic.trim());
  const root = HDKey.fromMasterSeed(seed);
  const path = getBtcDerivationPath();
  const child = root.derive(path);
  if (!child.publicKey || !child.privateKey) throw new Error(`BTC key derivation failed at ${path}`);

  const bitcoin = bitcoinLib();
  const network = bitcoinNetwork();
  const address = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(child.publicKey),
    network,
  }).address as string;

  const wif = encodeWif(Buffer.from(child.privateKey));

  return { address, wif, network: getBtcNetworkId(), derivationPath: getBtcDerivationPath() };
}

/**
 * Create a brand-new BTC hot wallet. The caller is responsible for persisting
 * the returned secrets encrypted at rest.
 */
export async function createHotWallet(): Promise<GeneratedBtcHotWallet> {
  const bip39: any = await import('@scure/bip39');
  const wordlistMod: any = await import('@scure/bip39/wordlists/english');
  const wordlist = wordlistMod.wordlist ?? wordlistMod.default ?? wordlistMod;

  const mnemonic = bip39.generateMnemonic(wordlist, 256);
  const derived = await deriveHotWalletFromMnemonic(mnemonic);
  return { ...derived, mnemonic };
}

/**
 * Self-check a freshly created hot wallet: re-derive the address from the
 * recovery phrase and confirm the WIF encodes that exact private key, so a bad
 * backup is caught at creation time rather than at spend time.
 *
 * Uses only hashing, base58 and the already-derived public key — the address
 * comes from `payments.p2wpkh({ pubkey })`, which needs no ECC backend.
 */
export async function verifyHotWalletBackup(mnemonic: string, wif: string, address: string): Promise<boolean> {
  try {
    const bip39: any = await import('@scure/bip39');
    const { HDKey } = await import('@scure/bip32');

    const seed = bip39.mnemonicToSeedSync(mnemonic.trim());
    const child = HDKey.fromMasterSeed(seed).derive(getBtcDerivationPath());
    if (!child.publicKey || !child.privateKey) return false;

    const bitcoin = bitcoinLib();
    const derivedAddress = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(child.publicKey),
      network: bitcoinNetwork(),
    }).address as string;

    const decoded = decodeWif(wif);
    const sameKey = decoded.privateKey.equals(Buffer.from(child.privateKey));

    return derivedAddress === address && sameKey && decoded.compressed;
  } catch {
    return false;
  }
}
