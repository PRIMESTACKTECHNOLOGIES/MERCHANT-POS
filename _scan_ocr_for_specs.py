import json, re, os

text_file = r"f:\POS ORGINAL\_ocr_all_text.txt"
json_file = r"f:\POS ORGINAL\_ocr_results.json"

results = {}
ocr_text = ""

if os.path.exists(json_file):
    with open(json_file, "r", encoding="utf-8-sig") as f:
        results = json.load(f)
    all_texts = []
    for fname, data in results.items():
        if isinstance(data, dict) and data.get("text"):
            all_texts.append(f"=== {fname} ===\n{data['text']}")
    ocr_text = "\n\n".join(all_texts)

if os.path.exists(text_file):
    with open(text_file, "r", encoding="utf-8") as f:
        raw = f.read()
    if len(raw) > len(ocr_text):
        ocr_text = raw

print(f"Total OCR text length: {len(ocr_text)} chars")
print(f"Files with results: {len(results)}")

# ============ CRYPTO SPEC EXTRACTION ============
print("\n" + "="*80)
print("CRYPTOGRAPHIC SPECIFICATIONS EXTRACTED:")
print("="*80)

crypto_specs = {}

# DES specs
def find_section(text, start_keywords, end_keywords, max_chars=5000):
    positions = []
    for kw in start_keywords:
        idx = 0
        while True:
            pos = text.lower().find(kw.lower(), idx)
            if pos == -1:
                break
            positions.append(pos)
            idx = pos + 1
    sections = []
    for pos in sorted(set(positions)):
        section = text[pos:pos+max_chars]
        sections.append(section)
    return sections

# 1. DES
print("\n--- 1. Data Encryption Standard (DES) ---")
des_sections = find_section(ocr_text, ["Data Encryption Standard", "\bDES\b", "DES algorithm"])
for s in des_sections[:3]:
    lines = [l.strip() for l in s.split("\n") if l.strip()][:15]
    if any("DES" in l or "64-bit" in l or "56-bit" in l or "key" in l.lower() for l in lines):
        print("\n".join(lines))
        print("---")

# 2. Triple DES (3DES)
print("\n--- 2. Triple DES (3DES) ---")
tdes_sections = find_section(ocr_text, ["Triple DES", "3DES", "TDEA"])
for s in tdes_sections[:3]:
    lines = [l.strip() for l in s.split("\n") if l.strip()][:15]
    if any("3DES" in l or "Triple" in l or "three" in l.lower() or "two or three" in l.lower() or "unique keys" in l.lower() for l in lines):
        print("\n".join(lines))
        print("---")

# 3. AES
print("\n--- 3. Advanced Encryption Standard (AES) ---")
aes_sections = find_section(ocr_text, ["Advanced Encryption Standard", "\bAES\b", "Rijndael"])
for s in aes_sections[:3]:
    lines = [l.strip() for l in s.split("\n") if l.strip()][:15]
    if any("AES" in l or "128" in l or "192" in l or "256" in l or "Rijndael" in l for l in lines):
        print("\n".join(lines))
        print("---")

# 4. Key sizes tables
print("\n--- 4. Key Size Tables ---")
for line in ocr_text.split("\n"):
    l = line.strip()
    if any(k in l for k in ["Key Size", "key size", "Key Length", "bits"]) and (
        any(n in l for n in ["56", "64", "112", "128", "168", "192", "256"])
    ):
        print(l)

# 5. Block sizes
print("\n--- 5. Block Size Tables ---")
for line in ocr_text.split("\n"):
    l = line.strip()
    if ("block size" in l.lower() or "Plaintext block" in l or "Ciphertext block" in l) and any(n in l for n in ["64", "128"]):
        print(l)

# 6. RC4 Stream Cipher
print("\n--- 6. RC4 Stream Cipher ---")
rc4_sections = find_section(ocr_text, ["RC4", "Rivest", "stream cipher"])
for s in rc4_sections[:2]:
    lines = [l.strip() for l in s.split("\n") if l.strip()][:12]
    if any("RC4" in l or "Ron Rivest" in l or "RSA Security" in l or "stream cipher" in l.lower() for l in lines):
        print("\n".join(lines))
        print("---")

# 7. Hash Functions
print("\n--- 7. Hash Functions & Requirements ---")
hash_sections = find_section(ocr_text, ["Hash Function", "Message Authentication Code", "\bMAC\b", "MD5", "SHA-", "SHA1", "SHA256", "SHA512"])
for s in hash_sections[:4]:
    lines = [l.strip() for l in s.split("\n") if l.strip()][:12]
    if any(w in l.lower() for l in lines for w in ["hash", "mac", "md5", "sha", "digest", "authentication", "requirement"]):
        print("\n".join(lines))
        print("---")

# 8. Modes of Operation
print("\n--- 8. Block Cipher Modes of Operation ---")
mode_sections = find_section(ocr_text, ["mode of operation", "Modes o Operation", "ECB", "CBC", "CFB", "OFB", "CTR"])
for s in mode_sections[:2]:
    lines = [l.strip() for l in s.split("\n") if l.strip()][:12]
    if any(m in l for l in lines for m in ["ECB", "CBC", "CFB", "OFB", "CTR", "mode"]):
        print("\n".join(lines))
        print("---")

# 9. Public Key / Asymmetric
print("\n--- 9. Public Key / Asymmetric Encryption ---")
pk_sections = find_section(ocr_text, ["Public key", "asymmetric", "RSA", "private key", "digital signature"])
for s in pk_sections[:3]:
    lines = [l.strip() for l in s.split("\n") if l.strip()][:12]
    if any(w in l.lower() for l in lines for w in ["public", "asymmetric", "rsa", "private", "signature", "key pair"]):
        print("\n".join(lines))
        print("---")

# 10. Block vs Stream Ciphers
print("\n--- 10. Block Cipher vs Stream Cipher ---")
bs_sections = find_section(ocr_text, ["Block Cipher", "Stream Cipher", "Block & Stream"])
for s in bs_sections[:2]:
    lines = [l.strip() for l in s.split("\n") if l.strip()][:12]
    if any(w in l.lower() for l in lines for w in ["block", "stream", "cipher"]):
        print("\n".join(lines))
        print("---")

# ============ COMPLIANCE / REGULATORY EXTRACTION ============
print("\n\n" + "="*80)
print("REGULATORY & COMPLIANCE REQUIREMENTS (RA 11917):")
print("="*80)

# Key sections from the security act
key_topics = [
    "license", "permit", "certificate", "accreditation", "registration",
    "compliance", "inspection", "requirement", "qualification",
    "security personnel", "training", "firearm", "weapon",
    "uniform", "identification", "reporting", "audit",
    "Section 1", "Section 2", "Section 3", "Section 4", "Section 5",
    "I-TO-PSTA", "PNP", "FEO", "RCSU", "PSA", "CGF", "GSF",
]

found_sections = []
for topic in key_topics:
    idx = 0
    count = 0
    while count < 3:
        pos = ocr_text.lower().find(topic.lower(), idx)
        if pos == -1:
            break
        found_sections.append((topic, pos))
        idx = pos + len(topic)
        count += 1

print("\n--- Key Regulatory Terms Found ---")
from collections import Counter
term_counts = Counter()
for term in key_topics:
    c = ocr_text.lower().count(term.lower())
    if c > 0:
        term_counts[term] = c
for term, cnt in term_counts.most_common(30):
    print(f"  {term}: {cnt}x")

# Extract specific sections with content
print("\n--- Extracted Regulation Snippets ---")
extracted_rules = []
keywords_with_context = [
    "Pre-Licensing Inspection", "Inspection Report", "I-TO-PSTA",
    "Qualifications", "Must be at least", "degree holder",
    "Training Course", "Security Manager", "K9 Handler",
    "Permit to Transport", "small arms", "firearm",
    "uniform and counter sign", "SDDO", "escort service",
    "Secret Key", "Public Key", "Shared Key",
]

for kw in keywords_with_context:
    for m in re.finditer(re.escape(kw), ocr_text, re.IGNORECASE):
        start = max(0, m.start() - 50)
        end = min(len(ocr_text), m.end() + 200)
        ctx = ocr_text[start:end].replace("\n", " ").strip()
        # Clean up
        ctx = re.sub(r"\s+", " ", ctx)
        extracted_rules.append(f"[{kw}] ...{ctx}...")
        break

for rule in extracted_rules[:25]:
    print(f"\n  {rule}")

# ============ ANY CREDENTIALS (API KEYS, TOKENS, IDS) ============
print("\n\n" + "="*80)
print("POTENTIAL CREDENTIALS / CONFIG VALUES:")
print("="*80)

cred_patterns = [
    (r"https?://[^\s\"'<>)]+", "URL/Endpoint"),
    (r"\b[A-Fa-f0-9]{32,64}\b", "Hex Hash/Key"),
    (r"\b(?:pk|sk|rk)_(?:live|test)_[A-Za-z0-9_]{10,}\b", "API Key Style"),
    (r"(?i)(?:key|token|secret|password|pwd)\s*[:=]\s*[\"']?([A-Za-z0-9_\-]{6,})[\"']?", "K=V Credential"),
    (r"(?i)(?:client[_ -]?id|merchant[_ -]?id|mid|tid|account[_ -]?id)\s*[:=]\s*[\"']?([A-Za-z0-9_]{3,})[\"']?", "ID Value"),
    (r"\b\d{9,18}\b", "Long Numeric (Account/ID/Card)"),
    (r"\b[A-Z]{2,6}[_-][A-Z0-9]{4,}\b", "Env Variable Style"),
]

found_creds = set()
for pat, label in cred_patterns:
    for m in re.finditer(pat, ocr_text, re.IGNORECASE):
        val = m.group(0)
        # Filter obvious noise
        if len(val) <= 3:
            continue
        if val in ["http://www.w3.org", "https://www.w3.org"]:
            continue
        if re.fullmatch(r"\d{4,5}", val):
            continue  # just page numbers
        key = f"{label}|{val[:80]}"
        if key not in found_creds:
            found_creds.add(key)
            print(f"  [{label}] {val[:120]}")

# Summary for processor application
print("\n\n" + "="*80)
print("SUMMARY FOR PROCESSOR APPLICATION:")
print("="*80)
print("""
REQUIRED CRYPTO ALGORITHMS FOR PROCESSOR (from slides):
1. Symmetric Ciphers:
   - DES (64-bit block, 56-bit key) - Legacy card systems
   - 3DES / TDEA (2 or 3 unique keys) - ISO8583 PIN block, message encryption
   - AES (128/192/256-bit keys, 128-bit block) - Modern, EMV/HSM
   - RC4 (Stream cipher, variable key) - Legacy/obsolete but referenced

2. Block Cipher Modes (required for ISO8583/EMV):
   - ECB (simple block-by-block)
   - CBC (Cipher Block Chaining - for message encryption)
   - CFB, OFB, CTR (stream-like modes)

3. Hash Functions:
   - MD5 (legacy)
   - SHA-1 / SHA-2 family (SHA-256, SHA-512)
   - Used for MAC, file integrity, digital signatures

4. Message Authentication Codes (MAC):
   - DE64/DE128 in ISO8583 require MAC algorithms
   - HMAC construction with hash functions
   - CBC-MAC for block cipher-based MAC

5. Public Key / Asymmetric:
   - RSA (key pairs for digital signatures, key exchange)
   - Used for EMV ODA (Offline Data Authentication), CA public keys
   - Used for certificate-based auth with acquirers

REGULATORY COMPLIANCE ITEMS (from RA 11917 IRR):
- Processor licensing through PNP / regulatory bodies
- Pre-licensing inspection requirements
- Security personnel qualifications (age 21+, degree holder)
- Training certifications (Security Manager Course, K9 Handler, etc.)
- Firearms/weapons possession limits (1 per security personnel)
- Permit to Transport for equipment movement
- Uniform and identification requirements
- Periodic inspection and reporting compliance
""")

out_summary = r"f:\POS ORGINAL\_processor_specs_extracted.txt"
with open(out_summary, "w", encoding="utf-8") as f:
    f.write("CRYPTO SPECS + REGULATORY REQUIREMENTS EXTRACTED\n")
    f.write("="*80 + "\n\n")
    f.write(ocr_text)
print(f"\nFull OCR+analysis saved to: {out_summary}")
