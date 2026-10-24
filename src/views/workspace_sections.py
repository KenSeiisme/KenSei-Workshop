from template_renderer import render_template


def workspace_section(kind, title, slug):
    return render_template(
        "workspace/record-section.html",
        kind=kind,
        title=title,
        kind_2=kind,
        kind_3=kind,
        kind_4=kind,
        kind_5=kind,
        kind_6=kind,
        kind_7=kind,
        slug=slug,
        title_2=title,
    )


WORKSPACE = workspace_section(
    "planner", "Study plans", "study-planner"
) + workspace_section("whiteboard", "Whiteboards", "whiteboard")
