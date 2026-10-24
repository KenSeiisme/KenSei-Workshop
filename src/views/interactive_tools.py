"""Interfaces for private autosave tools, typing and temporary device tests."""

from template_renderer import render_template


def history(kind, title, element_id):
    return render_template("workspace/history.html", element_id=element_id, title=title)


VIEWS = {
    "answer-book": render_template(
        "tools/answer-book.html",
        history=history("answer", "Your answer history", "answer-history"),
    ),
    "decision-studio": render_template(
        "tools/decision-studio.html",
        history=history("decision", "Your saved schemes", "decision-history"),
    ),
    "typing-sprint": render_template("tools/typing-sprint.html"),
    "device-check": render_template("tools/device-check.html"),
}
