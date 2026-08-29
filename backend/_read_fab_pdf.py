import sys
import os

pdf_path = r"C:\Users\Public\POS PROJECT\POS OFFLINE SFTWR - Copy\Receipt dania new.pdf"
print("FILE:", pdf_path, os.path.exists(pdf_path), os.path.getsize(pdf_path) if os.path.exists(pdf_path) else "-")

# Try pdfplumber first
try:
    import pdfplumber
    print("TOOL: pdfplumber")
    with pdfplumber.open(pdf_path) as pdf:
        for i, p in enumerate(pdf.pages):
            print(f"\n===== PAGE {i+1} =====")
            t = p.extract_text() or ""
            print(t)
            tables = p.extract_tables() or []
            for j, tbl in enumerate(tables):
                print(f"\n--- TABLE {j+1} ---")
                for row in tbl:
                    print(" | ".join([str(c) if c is not None else "" for c in row]))
    sys.exit(0)
except ImportError:
    print("SKIP pdfplumber (not installed)")
except Exception as e:
    print("pdfplumber ERR", type(e).__name__, e)

# Try PyPDF2
try:
    from PyPDF2 import PdfReader
    print("\nTOOL: PyPDF2")
    r = PdfReader(pdf_path)
    for i, p in enumerate(r.pages):
        print(f"\n===== PAGE {i+1} =====")
        try:
            print(p.extract_text() or "")
        except Exception as e:
            print("(page text error)", e)
    sys.exit(0)
except ImportError:
    print("SKIP PyPDF2 (not installed)")
except Exception as e:
    print("PyPDF2 ERR", type(e).__name__, e)

# Fallback strings
print("\nTOOL: strings fallback on raw bytes")
data = open(pdf_path, "rb").read()
keys = [b"FAB", b"NBAD", b"Beneficiary", b"AED", b"DANIA", b"batch", b"upload", b"UAEFTS",
        b"SWIFT", b"ACH", b"Customer", b"Remittance", b"Payment", b"CIF", b"7120647",
        b"First Abu Dhabi", b"UAE", b"Transfer", b"Salary", b"IBAN", b"account",
        b"Merchant", b"card", b"settlement", b"Visa", b"Mastercard", b"receipt", b"Receipt",
        b"Amount", b"Currency", b"Date", b"Reference", b"Beneficiary Name", b"Ordering Customer"]
seen = set()
lines = data.split(b"\n")
for raw in lines:
    try:
        text = raw.decode("latin-1", errors="ignore").strip()
    except Exception:
        continue
    if not text:
        continue
    low = text.lower()
    for k in keys:
        kd = k.decode("latin-1").lower()
        if kd in low and text not in seen:
            seen.add(text)
            if len(text) > 400:
                text = text[:400] + "..."
            print(text)
            break
