"""Shared compute helpers: working directory, log materialization, DOT->SVG."""
from __future__ import annotations

import contextlib
import os
import uuid
from pathlib import Path

from ..config import settings
from .. import repo


_RESOURCES = Path(__file__).resolve().parent.parent / "resources"


def work_root(session_id: str | None = None) -> Path:
    """The compute working dir; per-session subdir when a session id is given.

    prolysis writes intermediate files to a relative ``output_files/`` — scoping the
    CWD per session keeps concurrent sessions from clobbering each other. IMr's cut
    search additionally reads ``assets/lookup_table.csv`` relative to the CWD, so the
    bundled copy is provisioned into every work dir.
    """
    root = Path(settings.work_dir)
    if session_id:
        root = root / session_id
    (root / "output_files").mkdir(parents=True, exist_ok=True)
    assets = root / "assets"
    assets.mkdir(parents=True, exist_ok=True)
    lookup = assets / "lookup_table.csv"
    if not lookup.exists():
        lookup.write_bytes((_RESOURCES / "lookup_table.csv").read_bytes())
    return root


@contextlib.contextmanager
def workdir(session_id: str | None = None):
    """Run a block with CWD at the (session-scoped) working dir."""
    root = work_root(session_id)
    prev = os.getcwd()
    os.chdir(root)
    try:
        yield root
    finally:
        os.chdir(prev)


def materialize_log(artifact_id: str) -> str:
    """Write a stored event log's XES bytes to a file and return its absolute path."""
    ev = repo.get_event_log_by_artifact(artifact_id)
    if not ev:
        raise ValueError(f"no event log stored for artifact {artifact_id}")
    logs_dir = Path(settings.work_dir) / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    dest = logs_dir / f"{artifact_id}_{uuid.uuid4().hex[:8]}.xes"
    dest.write_bytes(ev["content"])
    return str(dest.resolve())


def dot_to_svg(dot: str) -> str:
    """Render Graphviz DOT source to an inline SVG string (needs the `dot` binary)."""
    import graphviz

    return graphviz.Source(dot).pipe(format="svg").decode("utf-8")


def petri_to_bpmn_xml(net, im, fm) -> str | None:
    """Convert a Petri net to BPMN XML with layout (DI), for client-side bpmn-js.

    Best-effort: models render as Petri-net SVG regardless, so a conversion failure
    must never fail the discovery job.
    """
    import os
    import tempfile
    from pathlib import Path

    import pm4py

    try:
        bpmn = pm4py.convert_to_bpmn(net, im, fm)
        with tempfile.NamedTemporaryFile(suffix=".bpmn", delete=False) as tf:
            tmp = tf.name
        try:
            pm4py.write_bpmn(bpmn, tmp, auto_layout=True)
            return _fix_gateway_markers(Path(tmp).read_text(encoding="utf-8"))
        finally:
            os.unlink(tmp)
    except Exception:
        return None


def _fix_gateway_markers(xml: str) -> str:
    """Make exclusive-gateway × markers visible.

    pm4py's exporter omits ``isMarkerVisible`` on the DI shapes; per the BPMN spec,
    viewers (bpmn-js included) then draw exclusive gateways as EMPTY diamonds. Stamp
    ``isMarkerVisible="true"`` on every shape that references an exclusive gateway.
    """
    import re

    gw_ids = set(re.findall(r'<[\w:]*exclusiveGateway\s+id="([^"]+)"', xml))

    def add_marker(m: "re.Match[str]") -> str:
        tag = m.group(0)
        if m.group(1) in gw_ids and "isMarkerVisible" not in tag:
            return tag[:-1] + ' isMarkerVisible="true">'
        return tag

    return re.sub(r'<[\w:]*BPMNShape\s+bpmnElement="([^"]+)"[^>]*>', add_marker, xml)


def fig_to_json(fig) -> dict:
    """Serialize a Plotly figure to a JSON-safe dict (handles numpy via plotly's encoder)."""
    import json

    return json.loads(fig.to_json())
