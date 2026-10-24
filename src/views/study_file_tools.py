from template_renderer import render_template
from file_tools import job_status

VIEWS = {
    "calculator-studio": render_template(
        "tools/calculator-studio.html", job_status=job_status()
    ),
    "file-check": render_template("tools/file-check.html", job_status=job_status()),
    "subtitle-studio": render_template(
        "tools/subtitle-studio.html", job_status=job_status()
    ),
    "flashcards": render_template("tools/flashcards.html", job_status=job_status()),
}
WORKSPACE = render_template("workspace/flashcards.html")
