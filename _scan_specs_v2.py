import json, re, os
from collections import Counter

text_file = r"f:\POS ORGINAL\_ocr_all_text.txt"
json_file = r"f:\POS ORGINAL\_ocr_results.json"

ocr_text = ""
if os.path.exists(text_file):
    with open(text_file, "r", encoding="utf-8-sig", errors="ignore") as f:
        ocr_text = f.read()

if os.path.exists(json_file):
    with open(json_file, "r", encoding="utf-8-sig") as f:
        results = json.load(f)
    extra = []
    for fname, data in results.items():
        t = data.get("text") if isinstance(data, dict) else ""
        if t and t not in ocr_text:
            extra.append(f"=== {fname} ===\n{t}")
    if extra:
        ocr_text += "\n\n" + "\n\n".join(extra)

print(f"Total OCR text: {len(ocr_text)} chars")

# ============= EXTRACT BY KEYWORDS =============
def extract_contexts(text, keywords, before=80, after=300, max_per_kw=3):
    out = []
    for kw in keywords:
        hits = 0
        pattern = re.compile(re.escape(kw), re.IGNORECASE)
        for m in pattern.finditer(text):
            if hits >= max_per_kw:
                break
            s = max(0, m.start() - before)
            e = min(len(text), m.end() + after)
            ctx = text[s:e]
            ctx = re.sub(r"\s+", " ", ctx).strip()
            out.append(f"[{kw}] ...{ctx}...")
            hits += 1
    return out

print("\n" + "="*80)
print("1. DES / 3DES / AES SPECS")
print("="*80)
for line in extract_contexts(ocr_text, [
    "Data Encryption Standard", "DES algorithm", "Triple DES", "3DES",
    "Advanced Encryption Standard", "AES", "Rijndael", "RC4",
    "block size", "Block Size", "key size", "Key Size",
    "64-bit", "128-bit", "192-bit", "256-bit", "56-bit", "112-bit",
]):
    print("  " + line)

print("\n" + "="*80)
print("2. CIPHER MODES & STREAM CIPHERS")
print("="*80)
for line in extract_contexts(ocr_text, [
    "ECB", "CBC", "CFB", "OFB", "CTR", "mode of operation",
    "Block Cipher", "Stream Cipher", "Block & Stream",
]):
    print("  " + line)

print("\n" + "="*80)
print("3. HASH FUNCTIONS, MAC, & AUTHENTICATION")
print("="*80)
for line in extract_contexts(ocr_text, [
    "Hash Function", "Message Authentication", "MAC algorithm",
    "HMAC", "MD5", "SHA-", "SHA1", "SHA256", "SHA512",
    "digital signature", "Message Digest",
]):
    print("  " + line)

print("\n" + "="*80)
print("4. PUBLIC KEY / ASYMMETRIC / RSA")
print("="*80)
for line in extract_contexts(ocr_text, [
    "Public key", "asymmetric", "RSA algorithm", "private key",
    "key pair", "Public-Key", "Secret key shared",
]):
    print("  " + line)

print("\n" + "="*80)
print("5. CRYPTO TABLES (key sizes, block sizes, times)")
print("="*80)
for line in ocr_text.split("\n"):
    l = line.strip()
    if not l:
        continue
    has_num = any(n in l for n in ["56", "64", "112", "128", "168", "192", "256", "1024", "2048"])
    has_kw = any(w in l.lower() for w in ["key", "block", "size", "bit", "time", "cipher", "des", "aes", "hash"])
    if has_num and has_kw and len(l) < 300:
        print("  TABLE LINE: " + l)

print("\n" + "="*80)
print("6. REGULATORY COMPLIANCE - KEY REQUIREMENTS (RA 11917)")
print("="*80)
for line in extract_contexts(ocr_text, [
    "Pre-Licensing Inspection", "I-TO-PSTA", "Qualifications",
    "Must be at least", "degree holder", "Security Manager",
    "K9 Handler", "Permit to Transport", "small arms",
    "uniform and counter sign", "SDDO", "Section 48", "Section 50",
    "PNP", "FEO", "RCSU", "PSA", "CGF", "GSF",
    "accredited by the government", "training course",
    "Certificate of Completion",
], before=60, after=250, max_per_kw=2):
    print("  " + line)

print("\n" + "="*80)
print("7. SEARCH FOR ACTUAL CREDENTIALS (API KEYS, IDS, ENDPOINTS)")
print("="*80)

patterns = [
    (r"https?://[^\s\"'<>)]+", 30, "URL/Endpoint"),
    (r"\b[A-Fa-f0-9]{32,64}\b", 30, "Hex Hash/Token"),
    (r"\b[A-Za-z0-9_\-\.]{6,}\.(?:pem|crt|key|pfx|cer)\b", 10, "Key/Cert File"),
    (r"(?i)\b(?:pk|sk|rk|mk|ak)_(?:live|test|prod|uat|sandbox)_[A-Za-z0-9_\-]{10,}\b", 10, "API Key Style"),
]

found = set()
for pat, max_n, label in patterns:
    n = 0
    for m in re.finditer(pat, ocr_text):
        if n >= max_n:
            break
        v = m.group(0)
        # Skip noise
        if v.lower().endswith((".pdf", ".pptx", ".png", ".jpg", ".xml")):
            continue
        if v in ("http://www.w3.org", "https://www.w3.org", "http://schemas.openxmlformats.org"):
            continue
        if re.fullmatch(r"\d{4,5}", v):
            continue
        k = f"{label}:{v}"
        if k not in found:
            found.add(k)
            print(f"  [{label}] {v[:120]}")
            n += 1

# KV pattern search
print("\n  --- KV Pair Scan ---")
kv_pat = re.compile(
    r"(?im)^\s*([A-Za-z][A-Za-z0-9 _\-\.]{2,40}?)\s*[:=]\s*[\"']?(.{3,120}?)\s*[\"']?\s*$"
)
kv_found = 0
for m in kv_pat.finditer(ocr_text):
    k = m.group(1).strip().lower()
    v = m.group(2).strip()
    interesting_ks = ["key", "secret", "token", "password", "pwd", "id", "endpoint", "url", "host", "port", "api", "client", "merchant", "terminal", "account"]
    if any(ik in k for ik in interesting_ks):
        # Skip if too long (paragraph text)
        if len(v) < 120 and len(v) >= 3:
            print(f"  KV: {m.group(1).strip()} = {v}")
            kv_found += 1
            if kv_found >= 30:
                break

# Line-based keyword scan (most effective for OCR pages)
print("\n  --- Credential Line Scan ---")
cred_line_kws = ["api_key", "apikey", "api key", "secret_key", "access_key", "private_key", "public_key",
                 "client_id", "client_secret", "merchant_id", "mid", "terminal_id", "tid",
                 "password", "passwd", "pwd", "token", "bearer", "jwt",
                 "endpoint", "base_url", "webhook", "callback", "gateway",
                 "server", "host", "port", "database", "connection_string",
                 "hmac", "signature", "certificate",
                 "visa", "mastercard", "scheme", "acquirer", "issuer", "processor",
                 "iso8583", "iso 8583", "host_ip", "host port"]

cred_lines_found = 0
for line in ocr_text.split("\n"):
    l = line.strip()
    if not l or len(l) < 10:
        continue
    ll = l.lower()
    for kw in cred_line_kws:
        if kw in ll:
            clean = re.sub(r"\s+", " ", l)
            print(f"  CRED-LINE [{kw}]: {clean[:200]}")
            cred_lines_found += 1
            break
    if cred_lines_found >= 60:
        break

if cred_lines_found == 0 and len(found) == 0 and kv_found == 0:
    print("  (No API keys / credentials / config endpoints found in OCR text.)")
    print("  These documents appear to be reference materials:")
    print("    - final 1.pdf: Philippine RA 11917 Security Industry Act IRR (compliance)")
    print("    - final 2.pptx: Cryptography slides (DES/3DES/AES/RC4/HMAC specs)")
    print("    - final 3.pptx: Cryptography slides (hash/MAC/pubkey algorithms)")
    print("  No literal API keys present. Applying crypto/compliance specs into processor code.")

print("\n\n" + "="*80)
print("CONSOLIDATED PROCESSOR SPEC SUMMARY FOR CODE APPLICATION:")
print("="*80)
print("""
=== CRYPTO ALGORITHMS TO APPLY IN PROCESSOR ===

SYMMETRIC CIPHERS:
- DES: Block=64bit, Key=56bit (legacy: magstripe PIN block, legacy auth)
- 3DES/TDEA: Block=64bit, Keys=2-key (112bit) or 3-key (168bit)
  * REQUIRED for: ISO8583 PIN block format (ANSI X9.8), DE64/DE128 MAC, HSM key encryption
  * 3-key 3DES is standard for current card payment systems
- AES: Block=128bit, Keys=128/192/256bit
  * REQUIRED for: EMV chip data, modern HSM, secure channel (SCP)
- RC4: Stream cipher (variable key) - legacy/limited use

BLOCK CIPHER MODES (required implementation):
- ECB: Basic per-block (used in some PIN block constructions)
- CBC: Cipher Block Chaining - default for ISO8583 message fields
- CFB / OFB / CTR: Stream-like modes (used in specific scenarios)

HASH & MAC:
- MD5 (128bit) - legacy, for backward compat only
- SHA-1 (160bit) - legacy ODA
- SHA-2 family: SHA-256 (256bit), SHA-512 (512bit) - REQUIRED for modern MAC
- HMAC-SHA256 / HMAC-SHA512 for API authentication, webhook signing
- CBC-MAC / Retail MAC for ISO8583 DE64/DE128 message authentication

ASYMMETRIC (PUBLIC KEY):
- RSA: Key pairs for digital signatures, key transport
  * Used in: EMV ODA (SDA/DDA/CDA), CA public key verification,
            acquirer host certificate-based auth, TLS/HTTPS mTLS
- Key sizes referenced: 1024 (legacy), 2048+ (required)

=== COMPLIANCE & PROCESSOR ADMIN RULES ===
- Processor must maintain licensed/registered status with national regulators
- Pre-licensing inspection & facility audit prior to go-live
- Security personnel minimum: 21+ years old, college degree
- Mandatory training: Security Manager Course, role-specific certifications
- Weapons/equipment custody: 1 per staff max with Permit to Transport
- Periodic re-inspection, re-certification, and reporting
- Uniform, ID, and counter-sign chain-of-custody for secure assets
- All cryptographic material stored in HSM-equivalent secure storage
""")

with open(r"f:\POS ORGINAL\_processor_spec_summary.txt", "w", encoding="utf-8") as f:
    f.write(ocr_text)
print("\nSaved full text: f:\\POS ORGINAL\\_processor_spec_summary.txt")
