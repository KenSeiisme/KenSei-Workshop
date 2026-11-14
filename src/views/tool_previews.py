from html import escape

from icons import icon

# Each tool gets a small, synthetic example in the catalog.
# Rows contain a visual type and its sample values. No tool script runs here.
PREVIEWS = {
    "image-studio": (
        ("picture", "2.4 MB", "image"),
        ("arrow",),
        ("picture", "480 KB", "image"),
    ),
    "qr-studio": (("qr",), ("lines", "https://", "kensei.example", "PNG · SVG")),
    "pdf-toolkit": (
        ("page", "01", "pdf"),
        ("page", "02", "pdf"),
        ("page", "03", "pdf"),
    ),
    "text-toolkit": (("lines", "A little clarity", "1 line", "16 characters"),),
    "markdown-studio": (
        ("lines", "# Notes", "- A task", "- An idea"),
        ("arrow",),
        ("lines", "Notes", "• A task", "• An idea"),
    ),
    "text-compare": (("diff", "− Hello world", "+ Hello Workshop"),),
    "image-to-text": (
        ("ocr", "HELLO"),
        ("arrow",),
        ("lines", "HELLO", "WORKSHOP"),
    ),
    "focus-timer": (("dial", "25:00", "timer"),),
    "answer-book": (("book", "✦"), ("lines", "One step", "at a time.")),
    "decision-studio": (("wheel",), ("lines", "A", "B", "C")),
    "typing-sprint": (("typing", "Ready to type", "60s", "WPM"),),
    "device-check": (("keys", "W", "A", "S", "D"), ("icon", "monitor")),
    "network-test": (("dial", "120", "gauge"), ("lines", "Mbps", "18 ms")),
    "zip-studio": (
        ("page", ".ZIP", "archive"),
        ("lines", "notes.txt", "cover.png", "data.csv"),
    ),
    "color-studio": (("palette",),),
    "unit-converter": (("lines", "2 km"), ("arrow",), ("lines", "2,000 m")),
    "password-generator": (("secret",), ("icon", "key")),
    "time-studio": (("lines", "KUL", "09:00"), ("lines", "TYO", "10:00")),
    "file-renamer": (
        ("lines", "IMG_407.png"),
        ("arrow",),
        ("lines", "trip_01.png"),
    ),
    "audio-studio": (("wave",),),
    "data-studio": (("table",), ("bars",)),
    "flashcards": (("flash", "3 × 4", "12"),),
    "calculator-studio": (("lines", "(8 + 4) ÷ 2", "= 6"),),
    "file-check": (("hash", "SHA-256", "A3F9…7C2D"),),
    "subtitle-studio": (("video", "00:12", "A new chapter"),),
    "study-planner": (("calendar",),),
    "whiteboard": (("flow",),),
    "screen-recorder": (("record", "00:24"),),
}

QR_ROWS = (
    "111010111",
    "101000101",
    "111010111",
    "000111000",
    "101010101",
    "011101001",
    "111001110",
    "101010011",
    "111101101",
)


def cells(items):
    return "".join(f"<i>{escape(str(item))}</i>" for item in items)


def element(kind, *values):
    if kind == "arrow":
        return icon("arrow")
    if kind == "icon":
        return icon(values[0])
    if kind in {"picture", "page"}:
        body = f"<b>{icon(values[1])}</b><small>{escape(values[0])}</small>"
    elif kind == "qr":
        body = "".join(
            f'<i data-filled="{pixel}"></i>' for row in QR_ROWS for pixel in row
        )
    elif kind == "wave":
        body = "".join(
            f'<i style="--level:{level}%"></i>'
            for level in (20, 33, 54, 32, 73, 94, 60, 40, 86, 65, 44, 73, 51, 24, 38)
        )
    elif kind == "palette":
        body = cells(("",) * 5)
    elif kind == "secret":
        body = "<b>••••••••••••</b>"
    elif kind == "wheel":
        body = "<b></b>"
    elif kind == "table":
        body = cells(("A", "B", "C", "08", "12", "05", "15", "06", "09"))
    elif kind == "bars":
        body = cells(("",) * 3)
    elif kind == "calendar":
        body = cells(range(1, 11))
    elif kind == "flow":
        body = f"<b></b>{icon('arrow')}<b></b>{icon('arrow')}<b></b>"
    elif kind == "record":
        body = f'{icon("monitor")}<b>{escape(values[0])}</b>'
    elif kind == "dial":
        text, style = values
        body = f'<b class="tool-dial-{style}">{escape(text)}</b>'
    else:
        body = cells(values)
    return f'<span class="tool-visual-{kind}">{body}</span>'


def tool_preview(slug):
    art = "".join(element(*part) for part in PREVIEWS[slug])
    return (
        f'<div class="tool-card-preview" data-tool-preview="{slug}" aria-hidden="true">'
        f'<span class="tool-visual-art">{art}</span><small>Example</small></div>'
    )
