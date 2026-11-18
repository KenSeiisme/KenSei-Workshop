"""Small account-page covers, reusing the existing game illustrations."""

from pathlib import Path
from template_renderer import render_template

ASSETS = Path(__file__).resolve().parents[1] / "assets"


def account_game_art(game):
    if game == "pong":
        return render_template("games/preview-pong.html").replace(
            "<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ', 1
        )
    parts = ['<rect width="240" height="160" rx="12" fill="#201a2b"/>']
    if game == "chess":
        for row in range(4):
            for col in range(6):
                fill = "#675275" if (row + col) % 2 else "#bcabc9"
                parts.append(
                    f'<rect x="{col*40}" y="{row*40}" width="40" height="40" fill="{fill}"/>'
                )
        for piece, x, y in [("bn", 40, 0), ("wp", 80, 80), ("wk", 160, 120)]:
            svg = (ASSETS / "chess" / f"{piece}.svg").read_text(encoding="utf-8")
            parts.append(
                svg.replace("<svg ", f'<svg x="{x}" y="{y}" width="40" height="40" ', 1)
            )
    elif game == "go":
        for i in range(7):
            parts.append(
                f'<path d="M{30+i*30} 20v120M30 {20+i*20}h180" stroke="#9b87af" stroke-opacity=".5"/>'
            )
        for x, y, color in [
            (90, 60, "#17111f"),
            (120, 60, "#f6eff9"),
            (90, 80, "#f6eff9"),
            (150, 100, "#17111f"),
            (150, 60, "#17111f"),
        ]:
            parts.append(
                f'<circle cx="{x}" cy="{y}" r="11" fill="{color}" stroke="#9d86ad"/>'
            )
    elif game == "xiangqi":
        board = (ASSETS / "xiangqi-board.svg").read_text(encoding="utf-8")
        parts.append(
            board.replace("<svg ", '<svg x="0" y="-55" width="240" height="270" ', 1)
        )
        for x, y, piece, color in [
            (47, 45, "車", "#edb9cc"),
            (120, 45, "將", "#e0d3ee"),
            (193, 45, "馬", "#edb9cc"),
            (82, 115, "炮", "#edb9cc"),
            (157, 115, "兵", "#e0d3ee"),
        ]:
            parts.append(
                f'<circle cx="{x}" cy="{y}" r="18" fill="#302438" stroke="{color}"/><text x="{x}" y="{y+7}" text-anchor="middle" fill="{color}" font-family="serif" font-size="22">{piece}</text>'
            )
    else:
        raise ValueError("Unsupported account game cover: " + game)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 160">'
        + "".join(parts)
        + "</svg>"
    )
