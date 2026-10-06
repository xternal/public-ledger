"""Inject seed JSON into the prototype template -> prototype/index.html"""
import json, pathlib
root = pathlib.Path(__file__).parent
t = (root/"prototype/template.html").read_text()
for key, f in [("PNL","uk_fy2025-26_pnl.json"),("LEV","levers.json"),("PROM","promises.json")]:
    data = json.dumps(json.loads((root/"data/seed"/f).read_text()), ensure_ascii=False)
    t = t.replace(f"/*__{key}__*/null", data)
(root/"prototype/index.html").write_text(t)
print("ok", len(t))
