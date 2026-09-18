#!/usr/bin/env python3
"""Build a self-contained, model-blind offline adjudication form.

The generated HTML contains only the preregistered candidate identity, blind
card text, the four allowed labels, and an optional human reason. It contains
no selection stratum, source island, geometry, relation, model score, ranking,
or model explanation.

The browser page performs no network access. It can export a response JSON that
is accepted by freeze_cognitive_assoc_adjudication.py after all judgements are
complete and the Maintainer model-blind attestation is checked.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
from pathlib import Path
from typing import Any

from build_cognitive_assoc_adjudication_packet import (
    ALLOWED_LABELS,
    load_model_input,
)
from freeze_cognitive_assoc_adjudication import TEMPLATE_SCHEMA


FORBIDDEN_PAYLOAD_KEYS = {
    "selectionStrata",
    "sourceIslandId",
    "islandId",
    "islandTitle",
    "x",
    "y",
    "geometry",
    "edges",
    "score",
    "similarity",
    "distance",
    "activation",
    "confidence",
    "ranking",
    "modelOutput",
    "modelExplanation",
}


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def build_form_payload(
    selected: dict[str, Any],
    selected_raw: bytes,
    cards: dict[tuple[str, str], str],
) -> dict[str, Any]:
    if selected.get("status") != "pending_human":
        raise ValueError("selected review set must remain pending_human")
    if selected.get("semanticBaselineGate") != "closed":
        raise ValueError("semantic baseline gate must remain closed")
    if selected.get("modelOutputsAllowed") is not False:
        raise ValueError("model outputs must remain forbidden")

    cases: list[dict[str, Any]] = []
    seen: set[str] = set()
    for collection_name, expected_size in (
        ("pairCandidates", 2),
        ("twoPlusOneCandidates", 3),
    ):
        collection = selected.get(collection_name)
        if not isinstance(collection, list):
            raise ValueError(f"missing candidate collection: {collection_name}")
        for candidate in collection:
            candidate_id = candidate.get("id")
            if not isinstance(candidate_id, str) or not candidate_id:
                raise ValueError(f"candidate without id in {collection_name}")
            if candidate_id in seen:
                raise ValueError(f"duplicate candidate id: {candidate_id}")
            seen.add(candidate_id)

            if candidate.get("label") != "pending_human":
                raise ValueError(
                    f"candidate is already labelled before human review: {candidate_id}"
                )
            if tuple(candidate.get("allowedLabels", ())) != ALLOWED_LABELS:
                raise ValueError(f"allowedLabels drift: {candidate_id}")

            document_id = candidate.get("documentId")
            card_ids = candidate.get("cardIds")
            if not isinstance(document_id, str) or not document_id:
                raise ValueError(f"candidate missing documentId: {candidate_id}")
            if not isinstance(card_ids, list) or len(card_ids) != expected_size:
                raise ValueError(
                    f"candidate {candidate_id} must contain {expected_size} cards"
                )
            if len(set(card_ids)) != expected_size:
                raise ValueError(f"candidate repeats a card: {candidate_id}")

            rendered_cards: list[dict[str, str]] = []
            for card_id in card_ids:
                key = (document_id, card_id)
                if key not in cards:
                    raise ValueError(
                        f"candidate {candidate_id} references missing blind card {key}"
                    )
                rendered_cards.append(
                    {"cardId": card_id, "text": cards[key]}
                )

            cases.append(
                {
                    "candidateId": candidate_id,
                    "documentId": document_id,
                    "cards": rendered_cards,
                }
            )

    if not cases:
        raise ValueError("selected review set has no candidates")

    payload = {
        "schema": "sui.cognitive-assoc-human-adjudication-form/v1",
        "benchmarkId": selected.get("benchmarkId"),
        "sourceSelectedReviewSetSha256": sha256_bytes(selected_raw),
        "semanticBaselineGate": "closed",
        "modelOutputsAllowed": False,
        "allowedLabels": list(ALLOWED_LABELS),
        "cases": sorted(cases, key=lambda item: item["candidateId"]),
    }

    def walk(value: Any, path: str = "root") -> None:
        if isinstance(value, dict):
            forbidden = FORBIDDEN_PAYLOAD_KEYS.intersection(value)
            if forbidden:
                raise ValueError(
                    f"form payload leaks forbidden fields at {path}: "
                    f"{sorted(forbidden)}"
                )
            for key, child in value.items():
                walk(child, f"{path}.{key}")
        elif isinstance(value, list):
            for index, child in enumerate(value):
                walk(child, f"{path}[{index}]")

    walk(payload)
    return payload


def render_html(payload: dict[str, Any]) -> str:
    payload_json = json.dumps(
        payload, ensure_ascii=False, separators=(",", ":")
    ).replace("</", "<\/")
    escaped_title = html.escape(
        f"{payload['benchmarkId']} model-blind human adjudication"
    )
    labels = payload["allowedLabels"]
    label_help = {
        "hard_negative": "一束へ寄せると訴えを壊す",
        "related_but_separate": "関係はあるが一束ではない",
        "ambiguous_or_held": "現時点では閉じない",
        "exclude": "v0 contrast評価から外す",
    }

    label_legend = "".join(
        f"<li><code>{html.escape(label)}</code> — "
        f"{html.escape(label_help[label])}</li>"
        for label in labels
    )

    return f"""<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>{escaped_title}</title>
<style>
:root {{ color-scheme: light dark; font-family: system-ui, sans-serif; }}
body {{ max-width: 980px; margin: 0 auto; padding: 24px; line-height: 1.6; }}
header {{ position: sticky; top: 0; background: Canvas; padding: 12px 0; border-bottom: 1px solid GrayText; z-index: 2; }}
.progress {{ font-variant-numeric: tabular-nums; }}
.case {{ border: 1px solid GrayText; border-radius: 10px; padding: 18px; margin: 20px 0; }}
.cards {{ display: grid; gap: 10px; }}
.card {{ border-left: 4px solid GrayText; padding: 8px 12px; background: color-mix(in srgb, Canvas 92%, GrayText 8%); }}
.choice {{ display: block; margin: 7px 0; }}
textarea {{ width: 100%; min-height: 64px; box-sizing: border-box; }}
.actions {{ display: flex; gap: 10px; flex-wrap: wrap; margin: 16px 0; }}
button, .file-label {{ padding: 8px 12px; border: 1px solid GrayText; border-radius: 6px; background: Canvas; cursor: pointer; }}
.warning {{ border-left: 4px solid orange; padding-left: 12px; }}
code {{ overflow-wrap: anywhere; }}
.small {{ font-size: .9em; color: GrayText; }}
</style>
</head>
<body>
<header>
  <strong>{escaped_title}</strong>
  <div class="progress" id="progress">0 / {len(payload['cases'])} 判定済み</div>
</header>

<h1>Model-blind Human Adjudication</h1>
<p class="warning">
この画面は意味モデルの結果を表示しません。各組合せを人間として読み、
4つの選択肢から一つを選んでください。理由は任意です。
</p>
<ul>{label_legend}</ul>

<div class="actions">
  <label class="file-label">
    既存response JSONを読み込む
    <input id="importFile" type="file" accept="application/json,.json" hidden>
  </label>
  <button type="button" id="exportDraft">途中経過JSONを出力</button>
  <button type="button" id="exportFinal">完了JSONを出力</button>
</div>

<div id="cases"></div>

<section>
<h2>完了時の確認</h2>
<label>
  <input type="checkbox" id="attestation">
  63件の判定を完了する前に、semantic model / embedding / FlyHash候補など、
  後段で比較するモデル出力を見ていません。
</label>
<p class="small">
完了JSONは、全候補が判定済みかつこの確認が有効な場合だけ出力できます。
</p>
</section>

<script>
"use strict";
const DATA = {payload_json};
const state = new Map(DATA.cases.map(c => [c.candidateId, {{label:"", reason:""}}]));

function el(tag, attrs={{}}, text="") {{
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {{
    if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  }}
  if (text) node.textContent = text;
  return node;
}}

function updateProgress() {{
  const completed = [...state.values()].filter(v => DATA.allowedLabels.includes(v.label)).length;
  document.getElementById("progress").textContent =
    completed + " / " + DATA.cases.length + " 判定済み";
}}

function render() {{
  const root = document.getElementById("cases");
  root.textContent = "";
  DATA.cases.forEach((item, index) => {{
    const section = el("section", {{class:"case", id:"case-" + index}});
    section.append(el("h2", {{}}, String(index + 1).padStart(4,"0") + ". " + item.candidateId));
    section.append(el("div", {{class:"small"}}, "Document: " + item.documentId));

    const cards = el("div", {{class:"cards"}});
    item.cards.forEach((card, cardIndex) => {{
      const box = el("div", {{class:"card"}});
      box.append(el("strong", {{}}, "Card " + (cardIndex + 1) + " — " + card.cardId));
      box.append(el("div", {{}}, card.text));
      cards.append(box);
    }});
    section.append(cards);

    const choices = el("fieldset");
    choices.append(el("legend", {{}}, "判定"));
    DATA.allowedLabels.forEach(label => {{
      const wrapper = el("label", {{class:"choice"}});
      const radio = el("input", {{
        type:"radio",
        name:"label-" + index,
        value:label
      }});
      radio.addEventListener("change", () => {{
        state.get(item.candidateId).label = label;
        updateProgress();
      }});
      wrapper.append(radio, document.createTextNode(" " + label));
      choices.append(wrapper);
    }});
    section.append(choices);

    section.append(el("label", {{}}, "Reason（任意）"));
    const reason = el("textarea", {{placeholder:"空欄でも可"}});
    reason.addEventListener("input", () => {{
      state.get(item.candidateId).reason = reason.value;
    }});
    section.append(reason);
    root.append(section);
  }});
  updateProgress();
}}

function responseObject(finalMode) {{
  return {{
    schema: {json.dumps(TEMPLATE_SCHEMA)},
    benchmarkId: DATA.benchmarkId,
    status: finalMode ? "complete" : "in_progress",
    sourceSelectedReviewSetSha256: DATA.sourceSelectedReviewSetSha256,
    semanticBaselineGate: "closed",
    modelOutputsAllowed: false,
    attestation: {{
      completedByRole: "Maintainer",
      semanticModelOutputsViewedBeforeCompletion:
        finalMode ? false : null
    }},
    judgements: DATA.cases.map(item => ({{
      candidateId: item.candidateId,
      label: state.get(item.candidateId).label,
      reason: state.get(item.candidateId).reason
    }}))
  }};
}}

function exportJson(finalMode) {{
  if (finalMode) {{
    const incomplete = [...state.values()].filter(v => !DATA.allowedLabels.includes(v.label));
    if (incomplete.length) {{
      alert("未判定が " + incomplete.length + " 件あります。");
      return;
    }}
    if (!document.getElementById("attestation").checked) {{
      alert("model-blind完了確認をチェックしてください。");
      return;
    }}
  }}
  const value = responseObject(finalMode);
  const blob = new Blob([JSON.stringify(value, null, 2) + "\n"], {{type:"application/json"}});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "human-adjudication-response.json";
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}}

function importResponse(value) {{
  if (!value || value.schema !== {json.dumps(TEMPLATE_SCHEMA)}) throw new Error("schemaが一致しません");
  if (value.benchmarkId !== DATA.benchmarkId) throw new Error("benchmarkIdが一致しません");
  if (value.sourceSelectedReviewSetSha256 !== DATA.sourceSelectedReviewSetSha256)
    throw new Error("selected review set SHA-256が一致しません");
  if (!Array.isArray(value.judgements)) throw new Error("judgementsがありません");

  const incoming = new Map(value.judgements.map(j => [j.candidateId, j]));
  if (incoming.size !== DATA.cases.length) throw new Error("candidate件数が一致しません");
  DATA.cases.forEach((item, index) => {{
    const judgement = incoming.get(item.candidateId);
    if (!judgement) throw new Error("candidateが不足しています: " + item.candidateId);
    const label = judgement.label || "";
    if (label && !DATA.allowedLabels.includes(label))
      throw new Error("未知のlabelです: " + label);
    state.set(item.candidateId, {{label, reason:String(judgement.reason || "")}});
    const radios = document.querySelectorAll('input[name="label-' + index + '"]');
    radios.forEach(radio => radio.checked = radio.value === label);
    const textarea = document.querySelector("#case-" + index + " textarea");
    textarea.value = String(judgement.reason || "");
  }});
  updateProgress();
}}

document.getElementById("exportDraft").addEventListener("click", () => exportJson(false));
document.getElementById("exportFinal").addEventListener("click", () => exportJson(true));
document.getElementById("importFile").addEventListener("change", async event => {{
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {{
    importResponse(JSON.parse(await file.text()));
  }} catch (error) {{
    alert("読み込みに失敗しました: " + error.message);
  }} finally {{
    event.target.value = "";
  }}
}});

render();
</script>
</body>
</html>
"""


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build a self-contained offline human adjudication form."
    )
    parser.add_argument("selected_review_set", type=Path)
    parser.add_argument("model_input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    try:
        selected_raw = args.selected_review_set.read_bytes()
        selected = json.loads(selected_raw.decode("utf-8"))
        cards = load_model_input(args.model_input)
        payload = build_form_payload(selected, selected_raw, cards)
        page = render_html(payload)
    except (OSError, UnicodeDecodeError, ValueError, json.JSONDecodeError) as exc:
        print(f"FAIL: {exc}")
        return 1

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(page, encoding="utf-8")
    print(f"WROTE_FORM: {args.output}")
    print(f"CANDIDATE_COUNT: {len(payload['cases'])}")
    print("NETWORK_ACCESS: NONE")
    print("SEMANTIC_BASELINE_GATE: CLOSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
