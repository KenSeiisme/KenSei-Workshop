from template_renderer import render_template
from file_tools import job_status

VIEW = render_template("tools/study-planner.html", job_status=job_status())
