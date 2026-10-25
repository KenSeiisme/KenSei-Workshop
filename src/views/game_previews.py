"""Fixed, presentation-only boards. Never create an engine state or consume RNG."""

from html import escape


def idle_preview(slug):
    def rect(x, y, w, h, fill, radius=4, extra=""):
        return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" fill="{fill}" {extra}/>'

    def text(x, y, value, size=18, fill="#eee6f7"):
        return f'<text x="{x}" y="{y}" fill="{fill}" font-size="{size}" text-anchor="middle" dominant-baseline="central">{escape(str(value))}</text>'

    shapes = []
    w = h = 420
    if slug == "brick-breaker":
        w, h = 640, 480
        for row in range(5):
            for col in range(8):
                shapes.append(
                    rect(
                        27 + col * 74,
                        34 + row * 27,
                        66,
                        19,
                        ["#d6b5ed", "#efbdd9", "#b2dfd3", "#aebff4", "#f2c68c"][row],
                    )
                )
        shapes += [
            rect(260, 432, 120, 12, "#b2dfd3", 6),
            '<circle cx="320" cy="420" r="7" fill="#f3eeff"/>',
        ]
        shapes += [
            text(60, 43, "×3", 11, "#281b32"),
            text(355, 70, "↔", 13, "#281b32"),
            text(505, 97, "¾", 12, "#19362a"),
        ]
    elif slug == "block-drop":
        w, h = 360, 480
        shapes += [
            rect(85, 0, 190, 480, "#101421", 6),
            text(40, 22, "HOLD", 12),
            text(318, 22, "NEXT", 12),
        ]
        for row in range(20):
            for col in range(10):
                shapes.append(
                    rect(87 + col * 18.6, 3 + row * 23.7, 17, 22, "#ffffff07", 1)
                )
        for col, row in [
            (0, 19),
            (1, 19),
            (2, 19),
            (3, 19),
            (4, 19),
            (5, 19),
            (6, 19),
            (8, 19),
            (9, 19),
            (0, 18),
            (1, 18),
            (2, 18),
            (8, 18),
            (9, 18),
            (1, 17),
        ]:
            shapes.append(
                rect(
                    87 + col * 18.6,
                    3 + row * 23.7,
                    17,
                    22,
                    ["#91d9f0", "#d6b5ed", "#efbdd9"][col % 3],
                    2,
                )
            )
        for col, row in [(3, 3), (4, 3), (5, 3), (4, 4)]:
            shapes.append(rect(87 + col * 18.6, 3 + row * 23.7, 17, 22, "#d6b5ed", 2))
        for col, row in [(0, 0), (1, 0), (0, 1), (1, 1)]:
            shapes.append(rect(23 + col * 16, 49 + row * 16, 14, 14, "#f2c68c", 2))
        for i in range(3):
            shapes.append(
                rect(296, 53 + i * 65, 45, 14, ["#91d9f0", "#b2dfd3", "#efbdd9"][i], 2)
            )
    elif slug == "snake":
        for row in range(20):
            for col in range(20):
                shapes.append(rect(col * 21, row * 21, 20, 20, "#ffffff04", 1))
        for i, (col, row) in enumerate(
            [(7, 9), (6, 9), (5, 9), (4, 9), (4, 10), (4, 11), (5, 11)]
        ):
            shapes.append(
                rect(
                    col * 21 + 1,
                    row * 21 + 1,
                    19,
                    19,
                    "#d9fff0" if i == 0 else "#78c3a0",
                    5,
                )
            )
        shapes.append('<circle cx="285" cy="157" r="9" fill="#efbdd9"/>')
    elif slug == "connect-four":
        w, h = 420, 360
        shapes.append(rect(0, 0, w, h, "#33243c", 12))
        for row in range(6):
            for col in range(7):
                fill = (
                    "#f2c68c"
                    if row > 3 and col in (2, 3)
                    else "#d6b5ed" if row == 5 and col in (1, 4) else "#15121d"
                )
                shapes.append(
                    f'<circle cx="{30 + col * 60}" cy="{30 + row * 60}" r="23" fill="{fill}"/>'
                )
    else:
        n = {
            "2048": 4,
            "minesweeper": 9,
            "memory-match": 4,
            "sudoku": 9,
            "nonogram": 10,
            "block-puzzle": 8,
            "reversi": 8,
        }[slug]
        cell = 420 / n
        values = (
            {0: 2, 1: 4, 5: 8, 8: 2, 12: 16, 13: 4}
            if slug == "2048"
            else (
                {0: 5, 3: 7, 8: 2, 12: 6, 20: 9, 30: 8, 53: 4, 64: 3, 79: 1}
                if slug == "sudoku"
                else {}
            )
        )
        for row in range(n):
            for col in range(n):
                i = row * n + col
                fill = "#ffffff08"
                if slug == "2048" and i in values:
                    fill = {2: "#51405f", 4: "#775582", 8: "#b28ac0", 16: "#efbdd9"}[
                        values[i]
                    ]
                if slug == "memory-match":
                    fill = "#3b294b"
                if slug == "nonogram" and (
                    row in (2, 3, 6, 7) and 1 < col < 8 or 3 < row < 6 and col in (2, 7)
                ):
                    fill = "#b2dfd3"
                if (
                    slug == "block-puzzle"
                    and row > 4
                    and (col < 3 or col > 4 and row > 5)
                ):
                    fill = "#bdacee"
                shapes.append(
                    rect(
                        col * cell + 2,
                        row * cell + 2,
                        cell - 4,
                        cell - 4,
                        fill,
                        7 if n == 4 else 2,
                    )
                )
                if i in values:
                    shapes.append(
                        text(
                            (col + 0.5) * cell,
                            (row + 0.5) * cell,
                            values[i],
                            32 if n == 4 else 20,
                        )
                    )
                if slug == "memory-match":
                    shapes.append(
                        text((col + 0.5) * cell, (row + 0.5) * cell, "✦", 26, "#d6b5ed")
                    )
                if slug == "minesweeper" and (row + col) % 7 == 0:
                    shapes.append(
                        text(
                            (col + 0.5) * cell,
                            (row + 0.5) * cell,
                            "⚑" if col == 0 else "1",
                            18,
                            "#aebff4",
                        )
                    )
                if slug == "reversi" and row in (3, 4) and col in (3, 4):
                    shapes.append(
                        f'<circle cx="{(col+.5)*cell}" cy="{(row+.5)*cell}" r="20" fill="{"#ede5f5" if row == col else "#08080e"}" stroke="#8f7b9e"/>'
                    )
        if slug == "sudoku":
            for i in (1, 2):
                shapes.append(
                    f'<path d="M{i*140} 0V420M0 {i*140}H420" stroke="#ad87c2" stroke-width="3"/>'
                )
    return f'<svg class="game-idle-art" viewBox="0 0 {w} {h}" role="img" aria-label="{escape(slug.replace("-", " "))} ready preview" focusable="false"><rect width="{w}" height="{h}" rx="10" fill="#12101b"/>{"".join(shapes)}</svg>'
