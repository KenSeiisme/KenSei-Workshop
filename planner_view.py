from tool_views import job_status

VIEW = '''
<div class="planner-layout">
<aside class="panel tool-form planner-library"><h2>Your study plans</h2>
<button id="planner-new" class="button primary">New plan</button>
<label>Import a JSON backup<input id="planner-import" type="file" accept=".json,application/json"></label>
<p class="muted small">Up to 30 courses, 14 weekly class times per course and 300 assignments / exams per plan. JSON limit: 1 MB.</p>
<div id="planner-list" aria-label="Saved study plans"></div>
<button id="planner-more" class="text-link" hidden>Load more plans</button>
<button id="planner-retry" class="text-link">Retry sync</button>
<p id="planner-save-state" class="muted small" role="status"></p>
<details id="planner-guest-copy" hidden><summary>Copy a guest plan to this account</summary><p class="muted small">Guest plans stay on this device. This action creates a private account copy; the guest original stays here.</p><label>Guest plan<select id="planner-guest-plan"></select></label><button id="planner-copy-account" class="button secondary">Copy to account</button></details>
</aside>
<section class="panel tool-form planner-main"><h2>A little more room to plan</h2>
<fieldset id="planner-fields" disabled><legend class="sr-only">Current study plan</legend>
<div class="form-row"><label>Plan name<input id="planner-name" maxlength="100" placeholder="My semester"></label><label>Plan time zone<input id="planner-zone" list="planner-zones" maxlength="100" autocomplete="off" placeholder="Asia/Kuala_Lumpur"></label></div><datalist id="planner-zones"></datalist>
<p id="planner-zone-note" class="muted small">Classes and deadlines use this fixed time zone on every device. Changing it keeps the written dates and times.</p>
<div class="action-row"><button id="planner-export" class="button secondary">Export JSON ↓</button><button id="planner-delete" class="text-link">Delete plan</button><button id="planner-clear" class="text-link">Clear all plans</button></div>
<p class="muted small">Edits save automatically after 500 ms. Guests save on this device; signed-in plans sync privately. This page does not send background reminders.</p>

<div class="section-heading planner-week-heading"><h3>Your week</h3><div class="action-row"><button id="planner-prev" class="button secondary" aria-label="Previous week">←</button><button id="planner-today" class="text-link">This week</button><button id="planner-next" class="button secondary" aria-label="Next week">→</button></div></div>
<p id="planner-week-label" class="muted small"></p><div class="planner-week-scroll" tabindex="0" role="region" aria-label="Weekly class and deadline schedule"><div id="planner-week" class="planner-week"></div></div>
<p class="muted small">Weekly classes appear only inside each course's date range. A class that lands in a daylight-saving time gap is flagged and skipped; repeated local times use the earlier occurrence.</p>

<div class="planner-editors">
<section class="planner-editor"><div class="section-heading"><h3>Courses</h3><button id="planner-course-new" class="text-link">New course</button></div><div id="planner-courses" class="planner-item-list"></div>
<p id="planner-course-edit-label" class="muted small">Add a course</p><label>Course title<input id="planner-course-title" maxlength="100" placeholder="Introduction to programming"></label>
<div class="form-row"><label>Start date<input id="planner-course-start" type="date"></label><label>End date<input id="planner-course-end" type="date"></label></div>
<label>Course color<input id="planner-course-color" type="color" value="#d6b1ec"></label>
<h4>Weekly class times</h4><div id="planner-sessions"></div>
<div class="planner-session-fields"><label>Day<select id="planner-session-day"><option value="1">Monday</option><option value="2">Tuesday</option><option value="3">Wednesday</option><option value="4">Thursday</option><option value="5">Friday</option><option value="6">Saturday</option><option value="7">Sunday</option></select></label><label>Starts<input id="planner-session-start" type="time" value="09:00"></label><label>Ends<input id="planner-session-end" type="time" value="10:00"></label></div>
<button id="planner-session-add" class="text-link">Add class time</button><p class="muted small">Up to 14 class times. Overnight classes need two entries on consecutive days.</p>
<div class="action-row"><button id="planner-course-save" class="button primary">Add course</button><button id="planner-course-delete" class="text-link" hidden>Delete course</button></div>
</section>
<section class="planner-editor"><div class="section-heading"><h3>Assignments &amp; exams</h3><button id="planner-task-new" class="text-link">New task</button></div>
<label>Show<select id="planner-task-filter"><option value="open">Due &amp; overdue</option><option value="overdue">Overdue</option><option value="done">Done</option><option value="all">All tasks</option></select></label><p id="planner-task-summary" class="muted small"></p><div id="planner-tasks" class="planner-item-list"></div>
<p id="planner-task-edit-label" class="muted small">Add an assignment or exam</p><label>Task title<input id="planner-task-title" maxlength="200" placeholder="Assignment 1"></label>
<div class="form-row"><label>Type<select id="planner-task-type"><option value="assignment">Assignment</option><option value="exam">Exam</option></select></label><label>Course<select id="planner-task-course"><option value="">No course</option></select></label></div>
<label>Deadline in the plan time zone<input id="planner-task-due" type="datetime-local" step="60"></label><label class="check-label"><input id="planner-task-done" type="checkbox">Done</label>
<div class="action-row"><button id="planner-task-save" class="button primary">Add task</button><button id="planner-task-delete" class="text-link" hidden>Delete task</button></div>
</section></div></fieldset>
<p id="planner-empty" class="muted">Create a plan or open one from your library to get started.</p></section></div>
''' + job_status()
