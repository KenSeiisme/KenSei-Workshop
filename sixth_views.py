def workspace_section(kind, title, slug):
    return f'''<section class="workspace-section" id="workspace-{kind}"><h2>{title}</h2><p id="{kind}-workspace-state" class="muted small" role="status"></p><div id="{kind}-workspace-list" class="saved-list"></div><div class="action-row"><button id="{kind}-workspace-more" class="text-link" hidden>Load more</button><button id="{kind}-workspace-retry" class="text-link">Retry sync</button><button id="{kind}-workspace-export" class="text-link">Export all ↓</button><button id="{kind}-workspace-clear" class="text-link">Clear all</button><a href="/tools/{slug}/" class="text-link">Open {title} →</a></div></section>'''

WORKSPACE = workspace_section('planner', 'Study plans', 'study-planner') + workspace_section('whiteboard', 'Whiteboards', 'whiteboard')
