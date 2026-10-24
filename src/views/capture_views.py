"""Local capture panels, composed into the existing media tools."""

from template_renderer import render_template

QR_SCAN = render_template("tools/qr-studio/scan.html")

AUDIO_RECORD = render_template("tools/audio-studio/record.html")

SCREEN_VIEW = render_template("tools/screen-recorder.html")


def augment_qr(view):
    return render_template("partials/augment-qr.html", view=view, qr_scan=QR_SCAN)


def augment_audio(view):
    return AUDIO_RECORD + view
