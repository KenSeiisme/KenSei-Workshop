"""Tool interfaces. Processing lives in the matching tool-scripts module."""

from template_renderer import render_template

from image_editor import PDF_SETTINGS


def draft_controls():
    return render_template("partials/draft-controls.html")


def job_status():
    return '<div class="job-status"><p id="tool-status" class="muted small" role="status" aria-live="polite">Everything is processed on this device.</p><button class="button secondary small-button" id="cancel-job" hidden>Cancel</button></div>'


VIEWS = {
    "qr-studio": render_template("tools/qr-studio.html", job_status=job_status()),
    "markdown-studio": render_template(
        "tools/markdown-studio.html",
        draft_controls=draft_controls(),
        job_status=job_status(),
    ),
    "text-compare": render_template("tools/text-compare.html", job_status=job_status()),
    "image-to-text": render_template(
        "tools/image-to-text.html",
        job_status=job_status(),
        draft_controls=draft_controls(),
    ),
    "pdf-toolkit": render_template(
        "tools/pdf-toolkit.html", job_status=job_status(), pdf_settings=PDF_SETTINGS
    ),
}
