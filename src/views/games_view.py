"""Games remain independent from the tool catalog and workspace."""

from template_renderer import render_template
from html import escape
from pong_view import VIEW as PONG_VIEW

HELP = {
    "block-drop": (
        "Stack seven kinds of falling pieces on a 10 × 20 board. Left/right or "
        "A/D move; Up/X rotates clockwise, Z counterclockwise, Down/S "
        "soft-drops, Space hard-drops, C/Shift holds once per piece. SRS wall "
        "kicks, seven-piece bags, a ghost and three-piece preview are included."
        " Clear 1/2/3/4 lines for 100/300/500/800 × level; soft drop adds 1 per"
        " cell and hard drop 2. Every 10 lines increases level. Classic ends "
        "when the stack reaches the top. Sprint ranks completed 40-line runs by"
        " server time. Pause and restore are Private."
    ),
    "pong": "Create an online invitation room. Both players sign in and press Ready. First to seven points wins.",
    "sudoku": (
        "Fill each row, column and 3 × 3 box with digits 1–9. Select a cell and"
        " use the number pad or keyboard. Pencil notes are available in either "
        "mode. Conflicts show duplicates, not hidden answers. Private provides "
        "one-step Undo and a one-cell Hint. Complete a Public puzzle without "
        "hints or interruption to enter its difficulty board."
    ),
    "nonogram": (
        "The numbers show consecutive filled runs in each row and column, in "
        "order. Separate runs with at least one empty square. Switch Fill / "
        "Mark or use X to mark an empty square; drag to paint. A matching clue "
        "line is highlighted. Scroll the clue area to pan larger boards. "
        "Private provides Undo and a one-cell Hint. Only a completed Public "
        "puzzle can rank."
    ),
    "block-puzzle": (
        "Place each of the three shapes, then receive a new tray. Tap a shape "
        "and a board square, or drag it into place. The selected square is the "
        "shape’s top-left corner. Arrow keys move the placement cursor; Enter "
        "places. Full rows and columns clear together. Each placed cell earns 1"
        " point, each cleared line 10. Shapes cannot rotate. The game ends when"
        " none of the remaining shapes fits."
    ),
    "brick-breaker": (
        "Move the paddle with your pointer, touch, arrow keys or A / D. Catch "
        "×3 Multiball, ↔ Wide Paddle (12 seconds), and ¾ Slow Ball (8 seconds) "
        "drops. Only losing all active balls costs a life. New games use "
        "powerup rules v2; old saves use Legacy rules. Tap Launch or press "
        "Space to serve. Break each brick for 10 points; clear three stages "
        "using three shared lives. A new ball waits for your launch after a "
        "miss. The five-minute active-play limit includes waiting to launch. "
        "Only natural endings, time limit or all three cleared stages finish "
        "Public runs."
    ),
    "connect-four": (
        "Drop a piece into one of seven columns. Connect four horizontally, "
        "vertically or diagonally to win. A full board without a winner is a "
        "draw. Choose three computer difficulties or two players on this "
        "device. Choose first or second before starting. Private only: pause, "
        "continue and undo your last human turn (one move for two players)."
    ),
    "reversi": (
        "Black plays first. Place a disc on a marked legal square to enclose "
        "and flip opponent discs along a row, column or diagonal. The opponent "
        "is skipped automatically if no move is legal. When neither player can "
        "move, the larger disc count wins; equal counts draw. Choose a computer"
        " difficulty or two local players. Private only, with save and Undo."
    ),
    "2048": (
        "Use arrow keys, WASD, swipe, or the direction buttons. Equal tiles "
        "merge once per move; their new value adds to your score. New tiles are"
        " 2 (90%) or 4 (10%). Reaching 2048 is a milestone: keep playing until "
        "no moves remain. One-step Undo is available in Private."
    ),
    "minesweeper": (
        "Reveal every safe square to win. Your first reveal and its neighbors "
        "are safe. Right-click to flag; on touch use Reveal / Flag. Activate an"
        " already-open number to reveal its neighbors when the surrounding flag"
        " count matches. Incorrect flags can lose the game. Random boards may "
        "require a guess. Large boards pan inside the game area."
    ),
    "snake": (
        "Use arrow keys, WASD, swipe, or the direction buttons. Each food adds "
        "10 points and one segment. Avoid walls and your own body; filling the "
        "board wins. Slow, Normal and Fast use 6, 10 and 14 cells per second. "
        "Direction changes are accepted once per game tick."
    ),
    "memory-match": (
        "Select two cards to find a matching pair. Each pair of flips counts as"
        " one attempt. A mismatch stays visible for 650 ms; wait before trying "
        "again. Match every pair to finish. Fewer attempts rank first, then "
        "faster completion."
    ),
}
DETAILS = {
    "block-drop": (
        "11",
        "Find your stack rhythm.",
        "Classic / 40-line Sprint",
        "Keys / touch buttons",
    ),
    "pong": (
        "12",
        "A friend on the other side.",
        "Online friends · Private",
        "Pointer / touch / keys",
    ),
    "sudoku": ("05", "A little room for logic.", "3 difficulties", "Keys / number pad"),
    "nonogram": ("06", "A picture in the clues.", "5 × 5 to 15 × 15", "Fill / mark"),
    "block-puzzle": ("07", "Make a little space.", "8 × 8 board", "Drag / tap"),
    "brick-breaker": (
        "08",
        "Keep a good thing bouncing.",
        "3 stages · 5 minutes",
        "Pointer / arrows",
    ),
    "connect-four": ("09", "One move ahead.", "3 AI levels", "Tap a column"),
    "reversi": ("10", "Turn the whole picture.", "3 AI levels", "Tap a square"),
    "2048": ("01", "Merge. Build. Repeat.", "4 × 4 board", "Arrow keys / swipe"),
    "minesweeper": (
        "02",
        "A little calculated risk.",
        "3 difficulties",
        "Reveal / flag",
    ),
    "snake": ("03", "One more bite.", "3 speeds", "Arrow keys / swipe"),
    "memory-match": ("04", "Find your other half.", "6–12 pairs", "Tap to match"),
}


def preview(kind):
    if kind == "block-drop":
        return (
            '<div class="mini-drop" aria-hidden="true">'
            + "".join(
                f'<span data-value="{1 if i in (2,7,8,9,18,19,20,21,24,25,26,27,28,29) else 0}"></span>'
                for i in range(30)
            )
            + "</div>"
        )
    if kind == "pong":
        return render_template("games/preview-pong.html")
    if kind == "2048":
        return (
            '<div class="mini-tiles" aria-hidden="true">'
            + "".join(
                f'<span data-value="{n}">{n}</span>'
                for n in [
                    "2",
                    "4",
                    "",
                    "8",
                    "16",
                    "32",
                    "4",
                    "",
                    "",
                    "64",
                    "128",
                    "2",
                    "4",
                    "",
                    "256",
                    "2048",
                ]
            )
            + "</div>"
        )
    if kind == "mines":
        return (
            '<div class="mini-mines" aria-hidden="true">'
            + "".join(
                f'<span data-value="{n}">{n}</span>'
                for n in [
                    "",
                    "",
                    "1",
                    "1",
                    "",
                    "⚑",
                    "",
                    "2",
                    "",
                    "1",
                    "1",
                    "",
                    "⚑",
                    "",
                    "1",
                    "",
                    "2",
                    "",
                    "",
                    "1",
                    "",
                    "",
                    "1",
                    "",
                    "",
                ]
            )
            + "</div>"
        )
    if kind == "snake":
        return render_template("games/preview-snake.html")
    if kind in ("sudoku", "nonogram", "block-puzzle", "connect-four", "reversi"):
        cells = {
            "sudoku": ["1", "", "3", "", "5", "", "7", "", "9"],
            "nonogram": [
                "",
                "■",
                "■",
                "■",
                "",
                "■",
                "",
                "",
                "",
                "■",
                "■",
                "",
                "",
                "",
                "■",
                "",
                "■",
                "",
                "■",
                "",
                "",
                "",
                "■",
                "",
                "",
            ],
            "block-puzzle": [
                "■",
                "■",
                "",
                "",
                "■",
                "",
                "■",
                "■",
                "",
                "",
                "■",
                "",
                "■",
                "■",
                "■",
                "",
            ],
            "connect-four": [
                "",
                "",
                "",
                "",
                "",
                "●",
                "",
                "",
                "●",
                "●",
                "",
                "●",
                "●",
                "●",
                "●",
                "",
                "",
                "",
                "",
                "",
                "",
            ],
            "reversi": [
                "",
                "",
                "",
                "",
                "",
                "●",
                "○",
                "",
                "",
                "○",
                "●",
                "",
                "",
                "",
                "",
                "",
            ],
        }[kind]
        return (
            '<div class="mini-extra mini-'
            + kind
            + '" aria-hidden="true">'
            + "".join(f'<span data-value="{v}">{v}</span>' for v in cells)
            + "</div>"
        )
    if kind == "brick-breaker":
        return render_template(
            "games/preview-brick-breaker.html",
            bricks="".join(
                (
                    f'<rect x="{20 + x * 37}" y="{20 + y * 19}" width="31" height="12" rx="3"/>'
                    for y in range(3)
                    for x in range(5)
                )
            ),
        )
    return (
        '<div class="mini-memory" aria-hidden="true">'
        + "".join(
            f'<span data-value="{n}">{n}</span>'
            for n in ["✦", "?", "?", "◈", "?", "✦", "◈", "?"]
        )
        + "</div>"
    )


def directory(games):
    cards = "".join(
        render_template(
            "games/card.html",
            slug=g["slug"],
            category_key=g["category"].lower(),
            category=g["category"],
            search_text=escape(
                (g["name"] + " " + g["description"]).lower(), quote=True
            ),
            name=g["name"],
            station=DETAILS[g["slug"]][0],
            preview=preview(g["preview"]),
            tagline=DETAILS[g["slug"]][1],
            description=g["description"],
            spec=DETAILS[g["slug"]][2],
            play_mode=(
                "Online / Friends"
                if g["slug"] == "pong"
                else "Computer / Local" if g["category"] == "Board" else "Solo"
            ),
        )
        for g in games
    )
    art = "".join(
        f'<div class="games-hero-tile" data-game-theme="{g["slug"]}">{preview(g["preview"])}</div>'
        for g in games[:4]
    )
    return render_template(
        "games/directory.html", game_count=len(games), art=art, cards=cards
    )


def game_page(game):
    if game["slug"] == "pong":
        return PONG_VIEW
    slug, name = game["slug"], game["name"]
    number, tagline, spec, controls = DETAILS[slug]
    private_only = game["category"] == "Board"
    mode_options = '<option value="private">Private · saved progress</option>' + (
        "" if private_only else '<option value="public">Public · Ranked</option>'
    )
    first_side = (
        '<label>Play as<select id="game-human-side"><option value="1">First player</option><option value="2">Second player</option></select></label>'
        if private_only
        else ""
    )
    hint = (
        '<button class="button secondary" id="game-hint" disabled>Hint · Private</button>'
        if slug in ("sudoku", "nonogram")
        else ""
    )
    milestones = "" if private_only else render_template("games/milestones.html")
    board_info = render_template("games/private-info.html") if private_only else ""
    directions = (
        render_template("games/direction-pad.html") if slug in ("2048", "snake") else ""
    )
    mine_mode = (
        render_template("games/mine-controls.html") if slug == "minesweeper" else ""
    )
    undo = (
        f'<button class="button secondary" id="game-undo" disabled>{"Undo turn" if private_only else "Undo one move"}</button>'
        if slug in ("2048", "sudoku", "nonogram", "connect-four", "reversi")
        else ""
    )
    return render_template(
        "games/page.html",
        slug=slug,
        number=number,
        category=game["category"].upper(),
        name=name,
        tagline=tagline,
        description=game["description"],
        mode_options=mode_options,
        difficulty_label="Opponent" if private_only else "Difficulty",
        first_side=first_side,
        mine_mode=mine_mode,
        preview=preview(game["preview"]),
        spec=spec,
        controls=controls,
        directions=directions,
        undo=undo,
        hint=hint,
        public_hidden="hidden" if private_only else "",
        milestones=milestones,
        board_info=board_info,
        archive_hidden="" if slug == "brick-breaker" else "hidden",
        help_text=HELP[slug],
    )
