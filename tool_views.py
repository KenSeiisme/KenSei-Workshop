"""Tool interfaces. Processing lives in the matching tool-scripts module."""

def draft_controls():
    return '''<div class="draft-controls"><label class="sr-only" for="draft-name">Draft name</label><input id="draft-name" maxlength="100" placeholder="Give this draft a name"><button class="button primary" id="save-draft">Save draft</button></div><p class="muted small" id="draft-state">Save manually to your workspace when you are ready.</p>'''

def job_status():
    return '<div class="job-status"><p id="tool-status" class="muted small" role="status" aria-live="polite">Everything is processed on this device.</p><button class="button secondary small-button" id="cancel-job" hidden>Cancel</button></div>'

VIEWS = {
'qr-studio': '''
<div class="studio-grid">
  <section class="panel tool-form">
    <h2>Make a connection</h2>
    <label>Content type<select id="qr-type"><option value="url">Website URL</option><option value="text">Plain text</option><option value="wifi">Wi-Fi network</option></select></label>
    <div data-qr-section="url"><p class="muted small">Include https:// or http:// for website links.</p></div>
    <label id="qr-content-group">URL or text<textarea id="qr-content" maxlength="2000" rows="3" placeholder="https://example.com"></textarea></label>
    <div data-qr-section="wifi" hidden>
      <label>Network name (SSID)<input id="qr-ssid" maxlength="128" autocomplete="off"></label>
      <label>Security<select id="qr-encryption"><option value="WPA">WPA / WPA2 / WPA3</option><option value="WEP">WEP</option><option value="nopass">Open network</option></select></label>
      <label>Password<input id="qr-password" type="password" maxlength="128" autocomplete="new-password"></label>
      <label class="check-label"><input id="qr-hidden" type="checkbox">Hidden network</label>
    </div>
    <div class="form-row"><label>Foreground<input type="color" id="qr-dark" value="#21152d"></label><label>Background<input type="color" id="qr-light" value="#ffffff"></label></div>
    <label>Export size<select id="qr-size"><option value="256">256 × 256</option><option value="512" selected>512 × 512</option><option value="1024">1024 × 1024</option></select></label>
    <label>Logo (optional)<input id="qr-logo" type="file" accept="image/png,image/jpeg,image/webp"></label>
    <button id="qr-remove-logo" class="text-link">Remove logo</button>
    <p class="muted small">Use strong contrast and a small logo so your code stays easy to scan.</p>
    <div class="action-row"><button id="qr-generate" class="button primary">Generate QR code →</button><button id="save-qr-preset" class="button secondary">Save appearance</button></div>
    <p class="muted small">Appearance presets exclude QR content, passwords and logos.</p>
  </section>
  <section class="panel preview-panel"><div id="qr-preview" class="qr-preview"><span>Your code will appear here.</span></div><div class="action-row"><button id="qr-png" class="button secondary" disabled>Download PNG</button><button id="qr-svg" class="button secondary" disabled>Download SVG</button></div></section>
</div>''' + job_status(),
'markdown-studio': '''
<div class="action-row"><label class="button secondary file-button">Import .md<input id="markdown-import" type="file" accept=".md,.markdown,.txt,text/plain,text/markdown"></label><button id="markdown-md" class="button secondary">Download .md</button><button id="markdown-html" class="button secondary">Download HTML</button></div>
<div class="editor-split">
  <section class="panel editor-pane"><h2><label for="markdown-input">Markdown</label></h2><textarea id="markdown-input" maxlength="100000" spellcheck="false" placeholder="# Your next idea&#10;&#10;Start writing here…"></textarea></section>
  <section class="panel editor-pane"><h2>Live preview</h2><div id="markdown-preview" class="markdown-preview"></div></section>
</div>''' + draft_controls() + job_status(),
'text-compare': '''
<div class="editor-split">
  <section class="panel editor-pane"><h2><label for="compare-left">Original text</label></h2><textarea id="compare-left" data-lock maxlength="100000" spellcheck="false" placeholder="Paste the original…"></textarea><label class="button secondary small-button file-button">Import .txt<input id="compare-file-left" data-lock type="file" accept=".txt,text/plain"></label></section>
  <section class="panel editor-pane"><h2><label for="compare-right">Updated text</label></h2><textarea id="compare-right" data-lock maxlength="100000" spellcheck="false" placeholder="Paste the updated version…"></textarea><label class="button secondary small-button file-button">Import .txt<input id="compare-file-right" data-lock type="file" accept=".txt,text/plain"></label></section>
</div>
<div class="panel tool-form compare-options"><div class="action-row"><label>Compare by<select id="compare-mode" data-lock><option value="lines">Lines</option><option value="characters">Characters</option></select></label><label class="check-label"><input type="checkbox" id="compare-case" data-lock>Ignore case</label><label class="check-label"><input type="checkbox" id="compare-space" data-lock>Normalize whitespace</label></div><div class="action-row"><button id="compare-run" class="button primary" data-lock>Compare texts →</button><button id="compare-swap" class="button secondary" data-lock>Swap sides</button><button id="compare-download" class="button secondary" disabled>Download .diff</button></div></div>
''' + job_status() + '<p class="muted small">+ Added · − Removed. Ignored differences are normalized in the displayed result and export.</p><pre id="compare-output" class="panel diff-output" aria-label="Text differences"></pre>',
'image-to-text': '''
<div class="studio-grid">
  <section class="panel tool-form"><h2>From image to words</h2><label>Choose an image<input id="ocr-file" type="file" accept="image/png,image/jpeg,image/webp" data-lock></label><p class="muted small" id="ocr-file-info">JPG, PNG or WebP · up to 20 MB and 40 megapixels</p><img id="ocr-preview" class="ocr-preview" alt="Selected image for recognition" hidden><fieldset><legend>Languages in this image</legend><label class="check-label"><input type="checkbox" name="ocr-language" value="eng" checked data-lock>English</label><label class="check-label"><input type="checkbox" name="ocr-language" value="chi_sim" data-lock>Simplified Chinese</label><label class="check-label"><input type="checkbox" name="ocr-language" value="chi_tra" data-lock>Traditional Chinese</label><label class="check-label"><input type="checkbox" name="ocr-language" value="msa" data-lock>Malay (Bahasa Melayu)</label></fieldset><p class="muted small">Only selected language packs are downloaded, then cached in this browser. Clear printed text works best; review the result for mistakes.</p><button id="ocr-run" class="button primary" data-lock>Extract text →</button></section>
  <section class="panel editor-pane"><h2><label for="ocr-output">Recognized text</label></h2><textarea id="ocr-output" maxlength="100000" placeholder="Your extracted text will appear here. You can edit it before saving."></textarea><div class="action-row"><button id="ocr-copy" class="button secondary">Copy text</button><button id="ocr-download" class="button secondary">Download .txt</button></div></section>
</div>''' + job_status() + draft_controls(),
'pdf-toolkit': '''
<section class="panel tool-form">
  <div class="form-row"><label>Operation<select id="pdf-operation" data-lock><option value="organize">Merge / extract / organize pages</option><option value="split">Split PDF into files</option><option value="images">Images to PDF</option><option value="export">PDF to PNG / JPG</option></select></label><label>Choose files<input id="pdf-files" type="file" accept="application/pdf" multiple data-lock></label></div>
  <p class="muted small" id="pdf-help"></p><p class="muted small">Up to 50 MB and 200 pages in total. Encrypted PDFs are not supported.</p>
  <label id="pdf-ranges-group">Page ranges (optional)<input id="pdf-ranges" placeholder="All selected pages, or e.g. 1-3,5" maxlength="2000" data-lock></label>
  <div class="form-row" id="pdf-export-settings" hidden><label>Image format<select id="pdf-image-format" data-lock><option value="image/png">PNG</option><option value="image/jpeg">JPG</option></select></label><label>Resolution<select id="pdf-scale" data-lock><option value="1.333333">96 DPI</option><option value="2" selected>144 DPI</option><option value="2.666667">192 DPI</option></select></label></div>
  <div class="action-row"><button id="pdf-run" class="button primary" data-lock>Create download →</button><span class="muted small" id="pdf-summary">No files selected.</span></div>
</section>''' + job_status() + '''<div class="pdf-layout"><section class="panel"><h2>Pages</h2><p class="muted small">Select, move or rotate pages before exporting.</p><div id="pdf-pages" class="pdf-page-list"></div></section><section class="panel pdf-preview-panel"><h2>Page preview</h2><canvas id="pdf-preview" hidden aria-label="PDF page preview"></canvas></section></div>'''
}
