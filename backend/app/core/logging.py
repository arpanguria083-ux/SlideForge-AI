import logging
import re


class RedactingFormatter(logging.Formatter):
    _sensitive_pattern = re.compile(
        r"(api[_-]?key|authorization)\s*[:=]\s*['\"]?([^'\"\s]+)",
        re.IGNORECASE,
    )

    def format(self, record: logging.LogRecord) -> str:
        rendered = super().format(record)

        def _mask(match: re.Match) -> str:
            key = match.group(1)
            return f"{key}=***"

        return self._sensitive_pattern.sub(_mask, rendered)
