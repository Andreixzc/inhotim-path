"""Data sources. Each module splits a thin ``fetch_*`` (network) from pure ``parse_*`` helpers."""


class SourceError(RuntimeError):
    """Upstream data did not have the expected shape (the endpoint probably changed)."""
