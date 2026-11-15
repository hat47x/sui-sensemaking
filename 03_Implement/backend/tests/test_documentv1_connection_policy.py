"""Fix the connection policy of the DocumentV1 projection parts (SUI #3371).

The read path (``from_artifact``) may be used by the TEI reference route. The
payload builder, the save plan, and the merge must stay off every route, MCP
tool, and CLI until an ADR adopts saving a projection as a SUI document.
"""

import ast
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
PACKAGE = BACKEND / "src" / "sui_sensemaking_api"
# Entry points live in the package (routes, CLI) and in backend scripts.
SCAN_ROOTS = (PACKAGE, BACKEND / "scripts")

# module -> modules allowed to import it (package-relative names)
ALLOWED_IMPORTERS = {
    "documentv1_save_plan": set(),
    "documentv1_merge": {"documentv1_save_plan"},
}
# name -> modules allowed to import it from documentv1_projection
ALLOWED_NAME_IMPORTERS = {
    "to_documentv1_payload": {"documentv1_merge", "documentv1_save_plan"},
}


def _imports(path: Path):
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            yield node.module.rsplit(".", 1)[-1], [a.name for a in node.names]
        elif isinstance(node, ast.Import):
            for alias in node.names:
                yield alias.name.rsplit(".", 1)[-1], []


class DocumentV1ConnectionPolicyTest(unittest.TestCase):
    def test_save_parts_are_not_wired_into_any_entry_point(self):
        violations = []
        paths = [(root, p) for root in SCAN_ROOTS if root.is_dir() for p in sorted(root.rglob("*.py"))]
        self.assertTrue(any(root == PACKAGE for root, _ in paths))
        for root, path in paths:
            prefix = "" if root == PACKAGE else root.name + "."
            importer = prefix + path.relative_to(root).with_suffix("").as_posix().replace("/", ".")
            for module, names in _imports(path):
                allowed = ALLOWED_IMPORTERS.get(module)
                if allowed is not None and importer not in allowed:
                    violations.append(f"{importer} imports {module}")
                if module == "documentv1_projection":
                    for name in names:
                        allowed_names = ALLOWED_NAME_IMPORTERS.get(name)
                        if allowed_names is not None and importer not in allowed_names:
                            violations.append(f"{importer} imports {name}")
        self.assertEqual(
            violations,
            [],
            "Saving a projection is not adopted (SUI #3371). Write an ADR before wiring these parts.",
        )

    def test_read_path_is_the_only_projection_entry(self):
        reference = (PACKAGE / "tei_sui_reference.py").read_text(encoding="utf-8")
        self.assertIn("from_artifact", reference)
        self.assertNotIn("to_documentv1_payload", reference)


if __name__ == "__main__":
    unittest.main()
