"""Command-line interface for rfcomp."""

import typer

from rfcomp import __version__

app = typer.Typer(help="RF compliance analysis toolkit.", no_args_is_help=True)


@app.callback()
def main() -> None:
    """RF compliance analysis toolkit."""


@app.command()
def version() -> None:
    """Print the rfcomp version."""
    typer.echo(__version__)


if __name__ == "__main__":
    app()
