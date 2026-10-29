import sys
import os
import json
import re

DOC_FILES = [
    r"f:\POS ORGINAL\final 1.pdf",
    r"f:\POS ORGINAL\final 2.pptx",
    r"f:\POS ORGINAL\final 3.pptx",
]

CRED_KEYWORDS = [
    "api", "key", "token", "secret", "password", "username", "client", "credential",
    "endpoint", "url", "host", "port", "merchant", "id", "account", "processor",
    "acquirer", "issuer", "terminal", "bin", "mid", "tid", "card", "network",
    "visa", "mastercard", "unionpay", "amex", "scheme",
    "iso8583", "mti", "processing", "code", "field", "de",
    "hmac", "signature", "certificate", "pem", "crt", "ssl", "tls",
    "ftp", "sftp", "ssh", "vpn", "gateway", "webhook", "callback",
    "staging", "sandbox", "production", "live", "uat", "test",
    "settlement", "clearing", "routing", "bank", "swift", "iban", "ach", "wire",
    "configuration", "config", "settings", "environment",
    "private", "public", "rsa", "aes", "3des", "des", "encryption",
    "pin", "cvv", "cvc", "expiry", "track", "pan",
    "authorization", "capture", "refund", "reversal", "void",
    "protocol", "101.1", "101.6", "201.3", "pos",
]

results = {}

def keyword_scan(all_text, doc_key):
    all_text_upper = all_text.upper()
    findings = {}
    for kw in CRED_KEYWORDS:
        kw_upper = kw.upper()
        count = all_text_upper.count(kw_upper)
        if count > 0:
            positions = [m.start() for m in re.finditer(re.escape(kw_upper), all_text_upper)]
            contexts = []
            for pos in positions[:10]:
                start = max(0, pos - 80)
                end = min(len(all_text), pos + len(kw) + 80)
                ctx = all_text[start:end].replace("\n", " ").replace("\r", " ").replace("\t", " ").strip()
                contexts.append(ctx)
            findings[kw] = {"count": count, "contexts": contexts}
    # Look for key=value patterns
    kv_patterns = [
        r'([A-Za-z_][A-Za-z0-9_\.\-\s]{2,40})\s*[:=]\s*([^\n\r;,"\'\)]{3,100})',
        r'(api[_-]?key|secret|password|token|client[_-]?id|merchant[_-]?id|terminal[_-]?id)\s*[:=]\s*["\']?([A-Za-z0-9_\-\.]{6,100})["\']?',
        r'(https?://[^\s"\'<>]+)',
        r'(\b[A-Fa-f0-9]{32,64}\b)',
        r'(\b\d{13,19}\b)',
        r'(\b[A-Z]{2,6}[_-][A-Z0-9]{4,}\b)',
    ]
    kv_results = []
    for pat in kv_patterns:
        for m in re.finditer(pat, all_text, re.IGNORECASE):
            kv_results.append({"match": m.group(0), "groups": [g for g in m.groups() if g]})
    findings["kv_patterns"] = kv_results[:50]
    results[doc_key]["findings"] = findings

def extract_pptx(path):
    import zipfile
    import xml.etree.ElementTree as ET
    texts = []
    all_text = ""
    ns = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main"}
    try:
        with zipfile.ZipFile(path, "r") as zf:
            slide_files = sorted([n for n in zf.namelist() if n.startswith("ppt/slides/slide") and n.endswith(".xml")])
            for sfile in slide_files:
                try:
                    slide_num = int(re.search(r"slide(\d+)", sfile).group(1))
                except:
                    slide_num = 0
                with zf.open(sfile) as f:
                    tree = ET.parse(f)
                    root = tree.getroot()
                    slide_texts = []
                    for t in root.iter("{%s}t" % ns["a"]):
                        if t.text:
                            slide_texts.append(t.text)
                    slide_content = "\n".join(slide_texts)
                    texts.append({"slide": slide_num, "text": slide_content})
                    all_text += slide_content + "\n\n"
    except Exception as e:
        print(f"PPTX ERR: {type(e).__name__}: {e}")
    return texts, all_text

for doc_path in DOC_FILES:
    fname = os.path.basename(doc_path)
    key = fname
    print(f"\n{'='*80}")
    print(f"FILE: {fname}")
    print(f"EXISTS: {os.path.exists(doc_path)}")
    if not os.path.exists(doc_path):
        continue
    print(f"SIZE: {os.path.getsize(doc_path)} bytes")
    ext = os.path.splitext(fname)[1].lower()
    results[key] = {"type": ext, "extracted": [], "findings": {}}

    all_text = ""

    if ext == ".pdf":
        # Try pdfplumber
        try:
            import pdfplumber
            print(f"TOOL: pdfplumber")
            with pdfplumber.open(doc_path) as pdf:
                print(f"  Pages: {len(pdf.pages)}")
                for i, p in enumerate(pdf.pages):
                    text = p.extract_text() or ""
                    if text:
                        results[key]["extracted"].append({"page": i+1, "text": text})
                        all_text += text + "\n\n"
                    tables = p.extract_tables() or []
                    for j, tbl in enumerate(tables):
                        rows = []
                        for row in tbl:
                            rows.append([str(c) if c is not None else "" for c in row])
                        if rows:
                            results[key]["extracted"].append({"page": i+1, "table_index": j+1, "table": rows})
        except ImportError:
            try:
                from PyPDF2 import PdfReader
                print(f"TOOL: PyPDF2")
                r = PdfReader(doc_path)
                print(f"  Pages: {len(r.pages)}")
                for i, p in enumerate(r.pages):
                    try:
                        text = p.extract_text() or ""
                        if text:
                            results[key]["extracted"].append({"page": i+1, "text": text})
                            all_text += text + "\n\n"
                    except Exception as e:
                        print(f"  Page {i+1} err: {e}")
            except ImportError:
                print("  No PDF libs, trying raw strings")
                data = open(doc_path, "rb").read()
                decoded = data.decode("latin-1", errors="ignore")
                text_found = []
                seen = set()
                for m in re.finditer(r"[\x20-\x7e\n\r\t]{4,}", decoded):
                    chunk = m.group(0).strip()
                    if len(chunk) > 10 and chunk not in seen:
                        seen.add(chunk)
                        text_found.append(chunk)
                all_text = "\n".join(text_found)
                if all_text:
                    results[key]["extracted"].append({"page": 0, "text": all_text})
        except Exception as e:
            print(f"PDF ERR: {type(e).__name__}: {e}")

    elif ext in (".pptx",):
        print(f"TOOL: PPTX extractor")
        slides, all_text = extract_pptx(doc_path)
        print(f"  Slides: {len(slides)}")
        results[key]["extracted"] = slides

    else:
        print(f"  Unknown extension: {ext}")

    # Raw text fallback (always do it)
    if not all_text:
        data = open(doc_path, "rb").read()
        decoded = data.decode("latin-1", errors="ignore")
        chunks = []
        seen = set()
        for m in re.finditer(r"[\x20-\x7e\n\r\t]{4,}", decoded):
            chunk = m.group(0).strip()
            if len(chunk) > 15 and chunk not in seen:
                seen.add(chunk)
                chunks.append(chunk)
        all_text = "\n".join(chunks)

    # Now print full extracted text first
    print(f"\n--- FULL EXTRACTED TEXT ({key}) ---")
    print(all_text[:15000])
    if len(all_text) > 15000:
        print(f"\n... [truncated, total length: {len(all_text)} chars] ...")

    # Keyword / credential scan
    print(f"\n--- KEYWORD / CREDENTIAL SCAN ({key}) ---")
    keyword_scan(all_text, key)

    # Print summary of findings
    findings = results[key].get("findings", {})
    if findings:
        for fk, fv in findings.items():
            if fk == "kv_patterns":
                print(f"\n  KV PATTERNS ({len(fv)} hits):")
                for item in fv[:20]:
                    print(f"    -> {repr(item['match'])}")
            else:
                print(f"\n  KW[{fk}]: {fv.get('count',0)} hits")
                for ctx in fv.get("contexts", [])[:3]:
                    print(f"    ...{ctx}...")

# Save JSON
out_path = r"f:\POS ORGINAL\_final_docs_extracted.json"
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(results, f, indent=2, ensure_ascii=False)
print(f"\n{'='*80}")
print(f"Full extraction saved to: {out_path}")
