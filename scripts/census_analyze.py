"""Sameness of a census: CLIP diversity, cluster count, motion measures, contact sheet.

usage: ../.venv/bin/python scripts/census_analyze.py <label>
reads reports/census/<label>/{census.json,frames/*.jpg}
writes reports/census/<label>/{summary.json,sheet.jpg}
"""
import json, sys, os
import numpy as np
import torch, open_clip
from PIL import Image
from sklearn.cluster import AgglomerativeClustering, KMeans
from sklearn.metrics import silhouette_score

label = sys.argv[1]
base = f"reports/census/{label}"
rows = json.load(open(f"{base}/census.json"))

# --- CLIP embeddings (ViT-B/32, OpenAI weights) ---
model, _, preprocess = open_clip.create_model_and_transforms("ViT-B-32", pretrained="openai")
model.eval()
imgs = [Image.open(f"{base}/frames/{r['n']}.jpg").convert("RGB") for r in rows]
with torch.no_grad():
    emb = torch.cat([model.encode_image(torch.stack([preprocess(i) for i in imgs[k:k + 32]])) for k in range(0, len(imgs), 32)])
emb = torch.nn.functional.normalize(emb, dim=-1).numpy()
np.save(f"{base}/clip.npy", emb)

sim = emb @ emb.T
iu = np.triu_indices(len(emb), 1)
diversity = float(np.mean(1 - sim[iu]))            # mean pairwise cosine distance

# groups at a fixed cosine-distance threshold, comparable across censuses
THRESH = 0.12
agg = AgglomerativeClustering(n_clusters=None, distance_threshold=THRESH, metric="cosine", linkage="average").fit(emb)
sizes = np.bincount(agg.labels_)
groups = int((sizes >= 3).sum())                    # groups with at least 3 designs
# best k by silhouette, as a second view
best_k, best_s = 2, -1
for k in range(2, 16):
    lab = KMeans(n_clusters=k, n_init=5, random_state=0).fit_predict(emb)
    s = silhouette_score(emb, lab, metric="cosine")
    if s > best_s: best_k, best_s = k, s

# --- motion ---
def stats(key, sub=rows):
    v = np.array([r[key] for r in sub if r.get(key) is not None], float)
    return {"mean": round(float(v.mean()), 3), "median": round(float(np.median(v)), 3)} if len(v) else None

def by(flag):
    out = {}
    for val in sorted({str(r.get(flag)) for r in rows}):
        sub = [r for r in rows if str(r.get(flag)) == val]
        out[val] = {"n": len(sub), "inward": stats("inward", sub), "uniformity": stats("uniformity", sub), "speed": stats("speed", sub)}
    return out

# "streaming inward" — the waterfall signature: motion that mostly heads toward the centre
waterfall = [r for r in rows if r.get("inward", 0) > 0.25]
summary = {
    "label": label, "designs": len(rows),
    "clip_diversity": round(diversity, 4),
    "groups_at_0.12": groups, "largest_group_share": round(float(sizes.max() / len(rows)), 3),
    "kmeans_best_k": best_k, "kmeans_silhouette": round(float(best_s), 3),
    "motion": {k: stats(k) for k in ["uniformity", "inward", "speed", "moving"]},
    "streaming_inward_share": round(len(waterfall) / len(rows), 3),
    "species": {s: sum(1 for r in rows if r.get("species") == s) for s in sorted({r.get("species") for r in rows})},
    "by_choice": {f: by(f) for f in ["scale", "flow", "mode", "delay", "species"]},
}
json.dump(summary, open(f"{base}/summary.json", "w"), indent=1)

# --- contact sheet: 20 × 15 thumbnails, ordered by cluster so sameness is visible ---
order = np.argsort(agg.labels_, kind="stable")
T = 96
sheet = Image.new("RGB", (20 * T, 15 * T), (17, 17, 17))
for i, idx in enumerate(order[:300]):
    sheet.paste(imgs[idx].resize((T, T)), ((i % 20) * T, (i // 20) * T))
sheet.save(f"{base}/sheet.jpg", quality=82)
print(json.dumps({k: summary[k] for k in ["clip_diversity", "groups_at_0.12", "largest_group_share", "kmeans_best_k", "streaming_inward_share"]}))
print(json.dumps(summary["motion"]))
print(json.dumps(summary["by_choice"], indent=None)[:1500])
