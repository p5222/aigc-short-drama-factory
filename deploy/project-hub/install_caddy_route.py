"""Add the reviewed /ops route while preserving every unrelated Caddy site.

Writes a candidate only. Validate it with Caddy before atomically installing.
"""
import pathlib
import sys


def add_route(text: str) -> str:
    if "reverse_proxy 127.0.0.1:4319" in text:
        return text
    start = text.find("manjiao.cloud, www.manjiao.cloud {")
    if start < 0:
        raise ValueError("Expected Manjiao site block missing; inspect config before changing")
    end = text.find("\n}", start)
    if end < 0:
        raise ValueError("Site closing brace missing")
    site = text[start:end]
    expected = "\treverse_proxy 127.0.0.1:8080"
    if site.count(expected) != 1 or "handle " in site or "handle_path " in site:
        raise ValueError("Unexpected existing routing; refuse a blind replacement")
    replacement = """\t@projectHubWWW {
\t\thost www.manjiao.cloud
\t\tpath /ops /ops/*
\t}
\tredir @projectHubWWW https://manjiao.cloud{uri} 308
\t@projectHub path /ops /ops/*
\thandle @projectHub {
\t\treverse_proxy 127.0.0.1:4319 {
\t\t\theader_up X-Project-Hub-Client-IP {remote_host}
\t\t}
\t}
\thandle {
\t\treverse_proxy 127.0.0.1:8080
\t}"""
    return text[:start] + site.replace(expected, replacement) + text[end:]


if __name__ == "__main__":
    source, target = map(pathlib.Path, sys.argv[1:3])
    target.write_text(add_route(source.read_text()), encoding="utf-8")
