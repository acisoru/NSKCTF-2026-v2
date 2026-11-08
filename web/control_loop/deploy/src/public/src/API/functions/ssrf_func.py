import ipaddress
import logging
import re
import socket
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)

URL_PATTERN = re.compile(r'https?://[^\s<>"\']+')

BLOCKED_SUBSTRINGS = ("127.", "localhost", "0x", "0.0.0.0", "::1")

PRIVATE_V4_NETWORKS = tuple(
    ipaddress.ip_network(cidr)
    for cidr in (
        "10.0.0.0/8",
        "127.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16",
        "169.254.0.0/16",
    )
)

PREVIEW_LIMIT = 6144


def extract_url(text: str) -> str | None:
    match = URL_PATTERN.search(text or "")
    return match.group(0) if match else None


class SourceBlocked(Exception):
    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


def validate_source_url(raw_url: str) -> str:
    lowered = raw_url.lower()
    for bad in BLOCKED_SUBSTRINGS:
        if bad in lowered:
            raise SourceBlocked("forbidden substring in address")

    parsed = urlparse(raw_url)
    host = parsed.hostname or ""

    try:
        ipaddress.IPv4Address(host)
        raise SourceBlocked("literal IP addresses are not allowed, use a domain name")
    except ValueError:
        pass

    if parsed.scheme not in ("http", "https"):
        raise SourceBlocked("only http/https schemes are allowed")

    try:
        resolved = socket.getaddrinfo(host, None)
    except socket.gaierror:
        raise SourceBlocked("address does not resolve")

    resolved_ip = ipaddress.ip_address(resolved[0][4][0])
    if isinstance(resolved_ip, ipaddress.IPv4Address):
        if any(resolved_ip in net for net in PRIVATE_V4_NETWORKS):
            raise SourceBlocked("address does not resolve to a public range")

    return raw_url


async def fetch_source(raw_url: str) -> tuple[int, str]:
    validate_source_url(raw_url)
    async with httpx.AsyncClient(follow_redirects=False, timeout=5.0) as client:
        response = await client.get(raw_url)
    return response.status_code, response.text[:PREVIEW_LIMIT]
