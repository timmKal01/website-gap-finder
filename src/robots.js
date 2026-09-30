// robots.txt: minimal reader, same rules as tech-stack-lead-finder's copy, plus our own agent group.
// Longest matching rule wins; Allow wins ties. Supports `*` and `$` in paths.

/** Rules that apply to us: our own `User-agent` group if the file has one, otherwise the `*` group. */
export function parseRobots(txt, agentToken) {
    const groups = [];
    let current = null;
    let lastWasAgent = false;
    for (const rawLine of String(txt ?? '').split(/\r?\n/)) {
        const line = rawLine.replace(/#.*/, '').trim();
        const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
        if (!m) continue;
        const key = m[1].toLowerCase();
        const value = m[2].trim();
        if (key === 'user-agent') {
            if (!lastWasAgent) {
                current = { agents: [], rules: [] };
                groups.push(current);
            }
            current.agents.push(value.toLowerCase());
            lastWasAgent = true;
            continue;
        }
        lastWasAgent = false;
        if (current && (key === 'allow' || key === 'disallow')) current.rules.push({ allow: key === 'allow', path: value });
    }
    const ours = groups.filter((g) => g.agents.includes(agentToken));
    return (ours.length ? ours : groups.filter((g) => g.agents.includes('*'))).flatMap((g) => g.rules);
}

function ruleRegex(path) {
    const anchored = path.endsWith('$');
    const body = (anchored ? path.slice(0, -1) : path).split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

export function isAllowed(rules, path) {
    let best = null;
    for (const rule of rules) {
        if (!rule.path) continue; // "Disallow:" with nothing after it allows everything
        if (!ruleRegex(rule.path).test(path)) continue;
        if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) best = rule;
    }
    return best ? best.allow : true;
}
