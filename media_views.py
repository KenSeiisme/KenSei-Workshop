"""Local capture panels, composed into the existing media tools."""

QR_SCAN = '''
<section id="qr-scan-panel" class="panel tool-form" role="tabpanel" aria-labelledby="qr-scan-tab" hidden>
<h2>Read a QR code</h2><p class="muted small">Scan a local image or use your camera. Results stay on this page and are never saved.</p>
<label>QR image<input id="qr-scan-file" type="file" accept="image/png,image/jpeg,image/webp"></label>
<p class="muted small">JPG, PNG or WebP · up to 20 MB and 40 megapixels · one QR result per scan.</p>
<div class="action-row"><label class="compact-label">Camera<select id="qr-camera-facing"><option value="environment">Back camera</option><option value="user">Front camera</option></select></label><button id="qr-camera-start" class="button secondary">Start camera</button><button id="qr-camera-stop" class="button secondary" disabled>Stop camera</button></div>
<video id="qr-camera-video" class="capture-video" muted playsinline hidden></video>
<p id="qr-scan-status" class="muted small" role="status" aria-live="polite">Choose an image, or start your camera.</p>
<label>Decoded content<textarea id="qr-scan-result" readonly class="copy-output" spellcheck="false"></textarea></label>
<div class="action-row"><button id="qr-scan-copy" class="button secondary" disabled>Copy result</button><a id="qr-scan-open" class="button secondary" target="_blank" rel="noopener noreferrer" hidden>Open website ↗</a><button id="qr-scan-clear" class="text-link">Clear result</button></div>
</section>'''

AUDIO_RECORD = '''
<section class="panel tool-form capture-panel"><h2>Record a fresh clip</h2>
<p class="muted small">Microphone access starts only when you choose Start recording. Up to 5 minutes or 50 MB; recording is kept on this page only.</p>
<div class="capture-meter-row"><meter id="audio-record-level" min="0" max="1" value="0" aria-label="Microphone level"></meter><span id="audio-record-time" class="capture-clock">00:00</span></div>
<div class="action-row"><button id="audio-record-start" class="button secondary" data-lock>Start recording</button><button id="audio-record-pause" class="button secondary" disabled>Pause</button><button id="audio-record-stop" class="button secondary" disabled>Stop & edit</button></div>
<p id="audio-record-status" class="muted small" role="status" aria-live="polite">Microphone is off. Stop a recording to open it in the editor below.</p>
<div id="audio-record-recovery" hidden><audio id="audio-record-preview" controls preload="metadata"></audio><button id="audio-record-download" class="button secondary">Download original recording ↓</button><button id="audio-record-retry" class="button secondary">Retry editor</button></div>
</section>'''

SCREEN_VIEW = '''
<div class="studio-grid"><section class="panel tool-form"><h2>Capture what you want to show</h2>
<p>Record a browser tab, window or screen. Your browser lets you choose the source; the recording stays on this device.</p>
<div class="notice-box"><strong>Desktop browsers work best</strong><p>Screen capture and shared audio depend on your browser and system. No screen or microphone access until you start.</p></div>
<label class="check-label"><input id="screen-shared-audio" type="checkbox">Request shared tab or system audio</label>
<label class="check-label"><input id="screen-microphone" type="checkbox">Include microphone</label>
<p class="muted small">Both audio options start off. Choose “Share audio” in the browser picker when available. Requested quality: up to 1080p at 30 fps; the browser decides the actual capture size.</p>
<div class="capture-meter-row"><span id="screen-time" class="capture-clock">00:00</span><span id="screen-bytes" class="muted small">0 MB</span></div>
<div class="action-row"><button id="screen-start" class="button primary">Start recording</button><button id="screen-pause" class="button secondary" disabled>Pause</button><button id="screen-stop" class="button secondary" disabled>Stop recording</button></div>
<p id="screen-status" class="muted small" role="status" aria-live="polite">Ready. Nothing is being captured.</p>
<p id="screen-specs" class="muted small"></p><p class="muted small">Automatically stops after 10 minutes elapsed or at 250 MB. Recording continues while this tab is in the background. Leaving the page releases capture; download your result before leaving.</p>
</section><section class="panel capture-preview-panel"><h2>Your preview</h2><video id="screen-live" class="capture-video" muted playsinline autoplay hidden></video><video id="screen-result" class="capture-video" playsinline controls preload="metadata" hidden></video><p id="screen-placeholder" class="muted">A live preview and your finished recording appear here.</p><div class="action-row"><button id="screen-download" class="button primary" disabled>Download recording ↓</button><button id="screen-discard" class="button secondary" disabled>Discard result</button></div><p class="muted small">Downloads use a supported native WebM or MP4 format. Preview audio is muted during capture to prevent feedback. Files are not uploaded or stored in your account.</p></section></div>
'''

def augment_qr(view):
    return '''<div class="action-row capture-tabs" role="tablist" aria-label="QR mode"><button id="qr-generate-tab" role="tab" aria-selected="true" aria-controls="qr-generate-panel" class="button secondary">Generate</button><button id="qr-scan-tab" role="tab" aria-selected="false" aria-controls="qr-scan-panel" class="button secondary">Scan</button></div><div id="qr-generate-panel" role="tabpanel" aria-labelledby="qr-generate-tab">''' + view + '</div>' + QR_SCAN

def augment_audio(view):
    return AUDIO_RECORD + view
