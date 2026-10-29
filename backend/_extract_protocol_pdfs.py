import sys
import os
import json
import re

PDF_FILES = [
    r"f:\POS ORGINAL\backend\98298238a46ef84f.pdf",
    r"f:\POS ORGINAL\backend\Union pay.pdf",
    r"f:\POS ORGINAL\backend\33aec82274536a26.pdf",
    r"f:\POS ORGINAL\backend\9ba0e51e956b42f3.pdf",
    r"f:\POS ORGINAL\backend\f7762a7ac78d7f48.pdf",
    r"f:\POS ORGINAL\backend\main.pdf",
]

KEYWORDS = [
    "MTI", "0100", "0110", "0200", "0210", "0400", "0410", "0420", "0430", "0500", "0510", "0520", "0530",
    "DE ", "DE-", "BIT MAP", "BITMAP", "FIELD ", "FIELDNO", "TAG",
    "Processing Code", "Function Code", "Response Code", "Reason Code", "Authorization",
    "POS Entry Mode", "Card Acceptance", "Terminal", "Merchant",
    "ISO 8583", "ISO8583", "1987", "1993", "2003",
    "EMV", "Chip", "Contactless", "Magnetic Stripe", "CVV", "CVC", "PIN",
    "Visa", "Mastercard", "MasterCard", "UnionPay", "Amex", "Discover",
    "Settlement", "Clearing", "Reversal", "Chargeback", "Refund", "Void",
    "Pre-Auth", "Preauth", "Completion", "Capture", "Sale",
    "BIN", "PAN", "Account Number", "Expiry", "Track 2", "Track II",
    "MAC", "PIN Block", "Key", "HSM",
    "Currency", "Amount", "Settlement Amount", "Transaction Amount",
    "STAN", "RRN", "Retrieval Reference", "Authorization Code", "Approval Code",
    "AID", "TVR", "TSI", "CVM", "ARQC", "ARPC", "TC", "AAC",
    "Protocol", "Procedure", "Flow", "Lifecycle", "State",
    "101.1", "101.6", "201.3",
]

results = {}

for pdf_path in PDF_FILES:
    fname = os.path.basename(pdf_path)
    print(f"\n{'='*80}")
    print(f"FILE: {fname}")
    print(f"EXISTS: {os.path.exists(pdf_path)}")
    if not os.path.exists(pdf_path):
        continue
    print(f"SIZE: {os.path.getsize(pdf_path)} bytes")
    results[fname] = {"pages": [], "tables": [], "keywords": {}}

    extracted = False

    # 1) Try pdfplumber
    try:
        import pdfplumber
        print(f"TOOL: pdfplumber")
        with pdfplumber.open(pdf_path) as pdf:
            for i, p in enumerate(pdf.pages):
                text = p.extract_text() or ""
                if text:
                    results[fname]["pages"].append({"page": i+1, "text": text})
                tables = p.extract_tables() or []
                for j, tbl in enumerate(tables):
                    rows = []
                    for row in tbl:
                        rows.append([str(c) if c is not None else "" for c in row])
                    if rows:
                        results[fname]["tables"].append({"page": i+1, "table_index": j+1, "rows": rows})
        extracted = True
    except ImportError:
        print("SKIP pdfplumber (not installed)")
    except Exception as e:
        print(f"pdfplumber ERR: {type(e).__name__}: {e}")

    # 2) Try PyPDF2 if pdfplumber failed
    if not extracted:
        try:
            from PyPDF2 import PdfReader
            print(f"TOOL: PyPDF2")
            r = PdfReader(pdf_path)
            for i, p in enumerate(r.pages):
                try:
                    text = p.extract_text() or ""
                    if text:
                        results[fname]["pages"].append({"page": i+1, "text": text})
                except Exception as e:
                    print(f"  Page {i+1} err: {e}")
            extracted = True
        except ImportError:
            print("SKIP PyPDF2 (not installed)")
        except Exception as e:
            print(f"PyPDF2 ERR: {type(e).__name__}: {e}")

    # 3) Fallback: raw strings search
    if not results[fname]["pages"]:
        print(f"TOOL: raw strings fallback")
        try:
            data = open(pdf_path, "rb").read()
            text_found = []
            seen = set()
            # Try to decode as latin-1 and extract readable chunks
            decoded = data.decode("latin-1", errors="ignore")
            # Find chunks of printable text
            for m in re.finditer(r"[\x20-\x7e\n\r\t]{4,}", decoded):
                chunk = m.group(0).strip()
                if len(chunk) > 10 and chunk not in seen:
                    seen.add(chunk)
                    text_found.append(chunk)
            if text_found:
                results[fname]["pages"].append({"page": 0, "text": "\n".join(text_found)})
        except Exception as e:
            print(f"Raw strings ERR: {type(e).__name__}: {e}")

    # Keyword scan
    all_text = "\n".join([p["text"] for p in results[fname]["pages"]])
    all_text_upper = all_text.upper()
    for kw in KEYWORDS:
        kw_upper = kw.upper()
        count = all_text_upper.count(kw_upper)
        if count > 0:
            results[fname]["keywords"][kw] = count
            # Show context
            positions = [m.start() for m in re.finditer(re.escape(kw_upper), all_text_upper)]
            for pos in positions[:5]:
                start = max(0, pos - 60)
                end = min(len(all_text), pos + len(kw) + 60)
                ctx = all_text[start:end].replace("\n", " ").strip()
                print(f"  KW[{kw}] page-ctx: ...{ctx}...")

# Save to JSON for further processing
out_path = r"f:\POS ORGINAL\backend\_pdf_extracted.json"
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(results, f, indent=2, ensure_ascii=False)
print(f"\nSaved extraction to: {out_path}")
print(f"Files extracted: {len(results)}")
