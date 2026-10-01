from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
DATA_MODEL_OVERVIEW = ROOT / "02_Architecture/data_model_operations_overview.html"
SCHEMAS = ROOT / "02_Architecture/schemas.md"
API = ROOT / "02_Architecture/api.md"
ADR_0033 = ROOT / "01_Plans/adr/ADR-0033-mvp-data-support-and-maintenance-boundary.md"

SUPPORT_LEVELS = {"L1", "L1.5", "L2", "L2.5", "L3", "L0"}


class _ProseExtractor(HTMLParser):
    """Reduce documentation HTML to the Markdown-equivalent prose the checks scan.

    `<code>` becomes a backticked token so token assertions read the same for
    Markdown and HTML sources; `<script>` / `<style>` bodies are dropped.
    """

    _DROP_BODY_TAGS = frozenset({"script", "style"})

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._parts: list[str] = []
        self._drop_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in self._DROP_BODY_TAGS:
            self._drop_depth += 1
        elif tag == "code" and not self._drop_depth:
            self._parts.append("`")

    def handle_endtag(self, tag):
        if tag in self._DROP_BODY_TAGS:
            self._drop_depth = max(0, self._drop_depth - 1)
        elif tag == "code" and not self._drop_depth:
            self._parts.append("`")

    def handle_data(self, data):
        if not self._drop_depth:
            self._parts.append(data)

    def result(self) -> str:
        return "".join(self._parts)


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _prose(path: Path) -> str:
    """Return `path` as Markdown-equivalent prose (HTML sources are normalized)."""
    text = _read(path)
    if path.suffix.lower() not in (".html", ".htm"):
        return text
    parser = _ProseExtractor()
    parser.feed(text)
    parser.close()
    return parser.result()


class _TableCollector(HTMLParser):
    """Collect every HTML table as (header_cells, body_rows) of plain-text cells.

    `<code>` content is re-wrapped in backticks so the row labels this module
    asserts on read the same whether the source is Markdown or HTML.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables: list[tuple[list[str], list[list[str]]]] = []
        self._header: list[str] = []
        self._body: list[list[str]] = []
        self._row: list[str] = []
        self._cell: list[str] | None = None
        self._is_header_cell = False
        self._code_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self._header, self._body = [], []
        elif tag == "tr":
            self._row = []
        elif tag in ("td", "th"):
            self._cell = []
            self._is_header_cell = tag == "th"
        elif tag == "code" and self._cell is not None:
            self._code_depth += 1
            self._cell.append("`")

    def handle_endtag(self, tag):
        if tag == "code" and self._cell is not None and self._code_depth:
            self._code_depth -= 1
            self._cell.append("`")
        elif tag in ("td", "th") and self._cell is not None:
            text = "".join(self._cell).strip()
            if self._is_header_cell:
                self._header.append(text)
            else:
                self._row.append(text)
            self._cell = None
        elif tag == "tr" and self._row:
            self._body.append(self._row)
            self._row = []
        elif tag == "table":
            self.tables.append((self._header, self._body))

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data.replace("\n", " "))


def _table_rows(text: str, required_header: str) -> list[list[str]]:
    """Return the body rows of the table whose header joins to `required_header`.

    Markdown tables are matched on their pipe-delimited header line; HTML tables
    are matched on their `<th>` cells joined with the same separator.
    """
    lines = text.splitlines()
    for index, line in enumerate(lines):
        if line.startswith("|") and required_header in line:
            rows: list[list[str]] = []
            for row in lines[index + 2 :]:
                if not row.startswith("|"):
                    break
                cells = [cell.strip() for cell in row.strip().strip("|").split("|")]
                rows.append(cells)
            if rows:
                return rows

    collector = _TableCollector()
    collector.feed(text)
    collector.close()
    for header, body in collector.tables:
        if body and required_header in " | ".join(header):
            return body

    raise AssertionError(f"missing table: {required_header}")


def _find_row(rows: list[list[str]], label: str) -> list[str]:
    for row in rows:
        if label in row[0]:
            return row
    raise AssertionError(f"missing table row: {label}")


def test_crud_support_table_keeps_support_levels_and_owners() -> None:
    text = _read(DATA_MODEL_OVERVIEW)
    rows = _table_rows(text, "データ領域 | Support level")

    assert len(rows) >= 10
    for row in rows:
        assert len(row) >= 8
        data_area, support_level, create, read, update, delete, owner, note = row[:8]
        assert data_area
        assert support_level in SUPPORT_LEVELS
        assert create
        assert read
        assert update
        assert delete
        assert owner
        assert note

    expected_levels = {
        "Documentスナップショット": "L1",
        "Card / Edge": "L2",
        "EvidenceLink": "L2",
        "ReviewAttribution": "L2.5",
        "MergeDecisionRecord": "L1.5",
        "SimilarCandidateGroup": "L3",
        "ContextQuery / ContextBundle": "L2.5",
        "Export / Context audit event": "L3",
        "User / UserIdentity": "L1",
        "Import/Review Pack artifact": "L3",
    }
    for label, support_level in expected_levels.items():
        assert _find_row(rows, label)[1] == support_level


def test_document_v1_field_table_keeps_embedded_and_contract_boundaries() -> None:
    text = _read(DATA_MODEL_OVERVIEW)
    rows = _table_rows(text, "フィールド | Support level")

    expected_levels = {
        "`version` / `id` / `createdAt` / `updatedAt` / `transform`": "L1",
        "`cards[]`": "L2",
        "`edges[]`": "L2",
        "`islands[]`": "L2",
        "`evidenceLinks`": "L2",
        "`patchApplyLog`": "L2",
        "`mergeSuggestionDecisions`": "L2",
        "`critiqueInputs` / `reproposalDiffs`": "L2.5",
        "`reviewAttribution`": "L2.5",
        "`deterministicTieBreak`": "L2.5",
    }
    for label, support_level in expected_levels.items():
        row = _find_row(rows, label)
        assert row[1] == support_level
        assert row[4]
        assert row[5]


def test_data_model_contract_references_are_wired_across_design_docs() -> None:
    overview = _prose(DATA_MODEL_OVERVIEW)
    schemas = _read(SCHEMAS)
    api = _read(API)
    adr = _read(ADR_0033)

    for text in (overview, schemas, adr):
        for support_level in SUPPORT_LEVELS:
            assert support_level in text

    for text in (schemas, api):
        assert "data_model_operations_overview.html" in text

    for token in (
        "個別CRUD",
        "型がある",
        "version gate",
        "`PUT /docs/{doc_id}`",
        "DATA-MAINT-01",
        "DATA-CONTRACT-01",
    ):
        assert token in overview

    assert "POST** `/docs`" in api
    assert "DATA-CONTRACT-01" in api
    assert "本書の型定義単体で運用保証を主張しない" in schemas
