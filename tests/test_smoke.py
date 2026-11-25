from typer.testing import CliRunner

import rfcomp
from rfcomp.cli import app


def test_import() -> None:
    assert rfcomp.__version__


def test_cli_version() -> None:
    result = CliRunner().invoke(app, ["version"])
    assert result.exit_code == 0
    assert result.stdout.strip() == rfcomp.__version__
