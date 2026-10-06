"""Build the shareable journey-maps page from docs/CUSTOMER_JOURNEYS.md (the source of truth).

Usage: pnpm journeys  ->  out/journey-maps.html (gitignored). Publish that file to update the team page.
"""
import html, re, pathlib, sys

SRC = pathlib.Path(sys.argv[1])
OUT = pathlib.Path(sys.argv[2])
OUT.parent.mkdir(parents=True, exist_ok=True)
md = SRC.read_text()

NOW = {"prototype", "M0"}
NEXT = {"M1", "M2", "M3", "M3b"}
LATER = {"M4", "M5", "M5b", "M6", "M7", "M8"}


def tag_kind(t):
    if t in NOW:
        return "now"
    if t in NEXT:
        return "next"
    if t in LATER:
        return "later"
    if t == "gap":
        return "gap"
    return None


def inline(s):
    s = html.escape(s, quote=False)
    s = s.replace("&lt;br&gt;", "<br>")
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", s)

    def tag(m):
        t = m.group(1)
        k = tag_kind(t)
        if not k:
            return m.group(0)
        return f'<span class="tag" data-k="{k}">{t}</span>'

    s = re.sub(r"\[(prototype|M\d+b?|gap)\]", tag, s)
    s = s.replace("→", '<span class="arr" aria-hidden="true">→</span><span class="sr">then</span>')
    return s


def cells(line):
    parts = line.strip().strip("|").split("|")
    return [p.strip() for p in parts]


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


# ---- split into sections ----
sections = []  # (level, title, lines)
cur = None
for line in md.splitlines():
    m = re.match(r"^(#{1,3}) (.*)$", line)
    if m:
        cur = [len(m.group(1)), m.group(2), []]
        sections.append(cur)
    elif cur is not None:
        cur[2].append(line)


def blocks(lines):
    """Yield ('table', rows) | ('ul', items) | ('ol', items) | ('p', text) | ('label', text)."""
    i = 0
    out = []
    while i < len(lines):
        l = lines[i]
        if l.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                if not re.match(r"^\|[\s:|-]+\|$", lines[i]):
                    rows.append(cells(lines[i]))
                i += 1
            out.append(("table", rows))
            continue
        if l.startswith("- "):
            items = []
            while i < len(lines) and lines[i].startswith("- "):
                items.append(lines[i][2:])
                i += 1
            out.append(("ul", items))
            continue
        if re.match(r"^\d+\. ", l):
            items = []
            while i < len(lines) and re.match(r"^\d+\. ", lines[i]):
                items.append(re.sub(r"^\d+\. ", "", lines[i]))
                i += 1
            out.append(("ol", items))
            continue
        if re.match(r"^\*\*[^*]+\*\*$", l.strip()):
            out.append(("label", l.strip().strip("*")))
            i += 1
            continue
        if l.strip():
            para = [l]
            i += 1
            while i < len(lines) and lines[i].strip() and not re.match(r"^(\||- |\d+\. |\*\*)", lines[i]):
                para.append(lines[i])
                i += 1
            out.append(("p", " ".join(para)))
            continue
        i += 1
    return out


def render_table(rows, kind="plain", caption=None):
    head, body = rows[0], rows[1:]
    cls = {"journey": "tbl journey", "plain": "tbl", "events": "tbl events", "gaps": "tbl gaps"}[kind]
    h = [f'<div class="scroll" tabindex="0" role="region" aria-label="{html.escape(caption or "Table")}"><table class="{cls}">']
    if caption:
        h.append(f'<caption class="sr">{html.escape(caption)}</caption>')
    h.append("<thead><tr>")
    for j, c in enumerate(head):
        h.append(f'<th scope="col">{inline(c)}</th>')
    h.append("</tr></thead><tbody>")
    for r in body:
        attrs = ""
        if kind == "events":
            funnels = re.findall(r"\b[A-E]\b", r[3]) if len(r) > 3 else []
            attrs = f' data-funnels="{" ".join(funnels)}"'
        h.append(f"<tr{attrs}>")
        for j, c in enumerate(r):
            if kind == "journey" and j == 0:
                h.append(f'<th scope="row">{inline(c.strip("*"))}</th>')
            elif kind == "events" and j == 0:
                h.append(f'<th scope="row">{inline(c)}</th>')
            else:
                h.append(f"<td>{inline(c)}</td>")
        h.append("</tr>")
    h.append("</tbody></table></div>")
    return "".join(h)


# ---- page body ----
body = []
nav = []
persona_count = 0
for level, title, lines in sections:
    if level == 1:
        bl = blocks(lines)
        intro = [b for b in bl if b[0] == "p"]
        tables = [b for b in bl if b[0] == "table"]
        body.append('<section class="intro" aria-label="How to read these maps">')
        body.append(f"<p class=\"lede\">{inline(intro[0][1])}</p>")
        legend = tables[0][1][1:]
        body.append('<div class="legend"><h2 class="h-small">When each capability exists</h2><dl class="legend-list">')
        for tag, meaning in legend:
            body.append(f'<div class="legend-row"><dt>{inline(tag)}</dt><dd>{inline(meaning)}</dd></div>')
        body.append("</dl></div>")
        if len(intro) > 1:
            body.append(f'<p class="refs">{inline(intro[1][1])}</p>')
        body.append("</section>")
        continue

    sid = slug(title)
    is_persona = bool(re.match(r"^\d+\. ", title))
    if level == 2:
        short = re.sub(r"^\d+\. ", "", title)
        short = re.sub(r"\s*\[.*\]$", "", short)
        nav.append((sid, short, is_persona))
    tag_html = ""
    m = re.search(r"\[(M\d+b?)\]$", title)
    clean_title = re.sub(r"\s*\[(M\d+b?)\]$", "", title)
    if m:
        tag_html = " " + inline(f"[{m.group(1)}]")
    num = ""
    if is_persona:
        persona_count += 1
        n, rest = clean_title.split(". ", 1)
        num = f'<span class="pnum" aria-hidden="true">{n}</span>'
        clean_title = rest
    hl = "h2" if level == 2 else "h3"
    cls = "persona" if is_persona else ("sub" if level == 3 else "block")
    body.append(f'<section id="{sid}" class="{cls}" aria-labelledby="{sid}-h">')
    body.append(f'<{hl} id="{sid}-h" class="{"h-persona" if is_persona else "h-section" if level == 2 else "h-sub"}">{num}<span>{inline(clean_title)}</span>{tag_html}</{hl}>')
    bl = blocks(lines)
    pending_label = None
    lists = []
    for kind, val in bl:
        if kind == "p":
            body.append(f'<p class="para">{inline(val)}</p>')
        elif kind == "label":
            pending_label = val
        elif kind in ("ul", "ol"):
            tagname = kind
            if pending_label:
                tone = "never" if "never" in pending_label.lower() else "moment"
                lists.append((pending_label, tone, val))
                pending_label = None
                continue
            if title.startswith("Funnels"):
                body.append('<ol class="funnels">')
                for it in val:
                    mm = re.match(r"\*\*(.+?):\*\*\s*(.*)$", it)
                    name, steps = (mm.group(1), mm.group(2)) if mm else ("", it)
                    letter = name.split(".")[0] if "." in name else ""
                    label = name.split(". ", 1)[1] if ". " in name else name
                    parts = [p.strip() for p in steps.split("→")]
                    tail = ""
                    if ", with " in parts[-1] or ", plus " in parts[-1]:
                        cut = parts[-1].find(", with ") if ", with " in parts[-1] else parts[-1].find(", plus ")
                        tail = parts[-1][cut + 2:]
                        parts[-1] = parts[-1][:cut]
                    body.append(f'<li class="funnel" data-f="{letter}"><div class="funnel-h"><span class="fl">{letter}</span>{inline(label)}</div><ol class="steps">')
                    for p in parts:
                        body.append(f"<li>{inline(p.rstrip('.'))}</li>")
                    body.append("</ol>")
                    if tail:
                        body.append(f'<p class="funnel-note">{inline(tail.rstrip("."))}</p>')
                    body.append("</li>")
                body.append("</ol>")
            elif title.startswith("Privacy rules"):
                body.append('<ol class="rules">')
                for it in val:
                    body.append(f"<li>{inline(it)}</li>")
                body.append("</ol>")
            else:
                body.append(f'<{tagname} class="list">' + "".join(f"<li>{inline(it)}</li>" for it in val) + f"</{tagname}>")
        elif kind == "table":
            if is_persona:
                body.append(render_table(val, "journey", f"Journey map: {clean_title}"))
            elif title.startswith("Event catalogue"):
                body.append(render_table(val, "events", "Event catalogue"))
            elif title.startswith("Gaps"):
                body.append(render_table(val, "gaps", "Gaps and open questions"))
            else:
                body.append(render_table(val, "plain", clean_title))
    if lists:
        body.append('<div class="pair">')
        for label, tone, items in lists:
            body.append(f'<div class="callout" data-tone="{tone}"><h4>{inline(label)}</h4><ul>' + "".join(f"<li>{inline(it)}</li>" for it in items) + "</ul></div>")
        body.append("</div>")
    body.append("</section>")

nav_html = "".join(
    f'<a href="#{sid}" class="{"p" if p else ""}">{html.escape(name)}</a>' for sid, name, p in nav
)

TEMPLATE = (pathlib.Path(__file__).parent / "shell.html").read_text()
OUT.write_text(TEMPLATE.replace("{{NAV}}", nav_html).replace("{{BODY}}", "\n".join(body)).replace("{{PERSONAS}}", str(persona_count)))
print("wrote", OUT, len(OUT.read_text()))
