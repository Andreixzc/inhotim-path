"""inhotim-path: plan the best walking route through Inhotim from its live map."""

from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("inhotim-path")
except PackageNotFoundError:  # running from a source tree without installation
    __version__ = "0.0.0"

USER_AGENT = f"inhotim-path/{__version__} (+https://github.com/Andreixzc/inhotim-path)"
