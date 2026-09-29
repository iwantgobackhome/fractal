"""Generate the small, original PDF and arXiv-source fixtures without dependencies."""
from pathlib import Path
import io
import tarfile
import gzip

root = Path(__file__).parent

def text(x, y, value, size=12):
    escaped = value.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
    return f"BT /F1 {size} Tf {x} {y} Td ({escaped}) Tj ET\n"

content = ""
content += text(50, 740, "A Small Structure Fixture", 18)
content += text(50, 710, "Prior work [1, 3-4] motivates the model.")
content += "0.1 0.3 0.7 rg 80 495 210 150 re f\n"
content += "0 0 0 rg\n"
content += text(75, 475, "Figure 1: Blue rectangle showing the method.")
content += text(160, 420, "E = mc2", 16)
content += text(490, 420, "(1)")
content += text(75, 365, "Table 1: Scores for the model.")
content += "75 350 m 320 350 l S\n75 310 m 320 310 l S\n"
content += text(90, 330, "Model       Score")
content += text(90, 315, "A           9")
content += text(50, 250, "References", 14)
content += text(50, 225, "[1] A. Author. Example Method. 2020. doi:10.1234/example")
content += text(50, 205, "[2] B. Author. An Earlier Study. 2019.")
content += text(50, 185, "[3] C. Author. Third Study. 2021.")
content += text(50, 165, "[4] D. Author. Fourth Study. 2022.")

objects = [
    b"<< /Type /Catalog /Pages 2 0 R >>",
    b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    f"<< /Length {len(content.encode())} >>\nstream\n{content}endstream".encode(),
]
pdf = bytearray(b"%PDF-1.4\n")
offsets = [0]
for number, obj in enumerate(objects, 1):
    offsets.append(len(pdf))
    pdf.extend(f"{number} 0 obj\n".encode() + obj + b"\nendobj\n")
xref = len(pdf)
pdf.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
for offset in offsets[1:]:
    pdf.extend(f"{offset:010d} 00000 n \n".encode())
pdf.extend(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
(root / "structure.pdf").write_bytes(pdf)

latex = r"""\begin{figure}\caption{Blue rectangle showing the method and key result.}\label{fig:blue}\end{figure}
\begin{equation}E = mc^2\label{eq:energy}\end{equation}
\begin{table}\caption{Scores for the model.}\label{tab:scores}\end{table}
"""
buffer = io.BytesIO()
with tarfile.open(fileobj=buffer, mode="w") as archive:
    data = latex.encode()
    info = tarfile.TarInfo("paper/main.tex")
    info.size = len(data)
    archive.addfile(info, io.BytesIO(data))
(root / "source.tar.gz").write_bytes(gzip.compress(buffer.getvalue()))
