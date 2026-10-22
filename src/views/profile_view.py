PROFILE_VIEW = '''<section class="container page-section profile-page" id="profile-page">
<div class="page-intro"><div class="eyebrow">YOUR CORNER OF THE WORKSHOP</div><h1 id="profile-heading">Your profile<span class="accent">.</span></h1><p id="profile-intro">A name, a little personality, and your next best score.</p></div>
<p id="profile-status" class="muted small" role="status">Loading profile…</p>
<div id="profile-login" class="panel tool-form" hidden><h2>Make this space yours.</h2><p>Sign in with Google to edit your name, avatar and biography.</p><button class="button primary" id="profile-sign-in">Continue with Google</button></div>
<form id="profile-form" class="panel tool-form profile-editor" hidden>
<div class="profile-avatar-row"><span id="profile-avatar" class="avatar-badge avatar-large" aria-label="Avatar preview"></span><div><label class="button secondary file-button">Choose avatar<input id="profile-avatar-file" type="file" accept="image/jpeg,image/png,image/webp"></label><button type="button" class="text-link" id="profile-remove-avatar">Remove avatar</button><p class="muted small">JPG, PNG or WebP · up to 5 MB. Center-cropped to a square. Uploaded when you save.</p></div></div>
<label>Public name<input id="profile-name" maxlength="64" autocomplete="nickname" required></label><p class="muted small">2–32 characters. Your Google name is used initially; you can choose another unique name.</p>
<label>Biography<textarea id="profile-bio" rows="4" maxlength="600" placeholder="A little about you…"></textarea></label><p class="muted small"><output id="profile-bio-count">0</output> / 300 characters</p>
<p class="profile-visibility-note">Your name, avatar, biography and qualifying best typing scores are public. Your email, drafts and tool histories stay private.</p>
<div class="action-row"><button class="button primary" id="profile-save" type="submit">Save changes</button><a class="button secondary" id="profile-view-public" href="/profile/">View public profile ↗</a></div>
</form>
<article class="panel public-profile" id="public-profile" hidden><div class="public-profile-heading"><span id="public-avatar" class="avatar-badge avatar-large" aria-label="Profile avatar"></span><div><h2 id="public-name"></h2><p id="public-bio"></p></div></div><div class="action-row"><a class="text-link" href="/tools/typing-sprint/">Try Typing Sprint →</a><a class="text-link" id="public-edit-profile" href="/profile/" hidden>Edit my profile</a></div><h3>Best typing sprints</h3><div id="public-best-scores" class="profile-scores"></div></article>
<button class="button secondary" id="profile-retry" hidden>Retry loading profile</button>
</section>'''
