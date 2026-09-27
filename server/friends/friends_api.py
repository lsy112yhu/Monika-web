#!/usr/bin/env python3
import base64
import binascii
import hashlib
import hmac
import ipaddress
import json
import os
import re
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from http.cookies import SimpleCookie
from http.client import HTTPSConnection, HTTPException
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse, urlunparse


HOST = os.environ.get("FRIENDS_API_HOST", "127.0.0.1")
PORT = int(os.environ.get("FRIENDS_API_PORT", "8766"))
DATA_FILE = Path(os.environ.get("FRIENDS_DATA_FILE", "/var/lib/web-lsy2005/friends.json"))

MAX_BODY_BYTES = 5_500_000
MAX_AVATAR_BYTES = 3 * 1024 * 1024
MAX_LINKS = 120
LOGIN_RATE_LIMIT = 8
LOGIN_RATE_WINDOW_SECONDS = 15 * 60
SUBMISSION_RATE_LIMIT = 5
SUBMISSION_RATE_WINDOW_SECONDS = 60 * 60
ADMIN_USERNAME = os.environ.get("FRIENDS_ADMIN_USERNAME", "Monika")
ADMIN_PASSWORD_HASH = os.environ.get("FRIENDS_ADMIN_PASSWORD_HASH", "")
SESSION_SECRET = os.environ.get("FRIENDS_SESSION_SECRET", "")
SESSION_TTL_SECONDS = int(os.environ.get("FRIENDS_SESSION_TTL_SECONDS", str(12 * 60 * 60)))
SESSION_COOKIE_NAME = "monika_friend_session"
ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
DATA_URL_RE = re.compile(r"^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$")
PROJECT_SITES = (
    {"id": "api", "url": "https://api.lsy2005.xyz/"},
    {"id": "astrbot", "url": "https://astrbot.lsy2005.xyz/"},
)
SITE_STATUS_CACHE_SECONDS = 30
SITE_STATUS_TIMEOUT_SECONDS = 6

store_lock = threading.Lock()
rate_limit_lock = threading.Lock()
rate_limit_buckets = {"login": {}, "submission": {}}
site_status_lock = threading.Lock()
site_status_cache = {"expires": 0.0, "payload": None}


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def read_store():
    if not DATA_FILE.exists():
        return {"links": []}

    try:
        with DATA_FILE.open("r", encoding="utf-8") as file:
            data = json.load(file)
    except (OSError, json.JSONDecodeError):
        return {"links": []}

    links = data.get("links", [])
    return {"links": links if isinstance(links, list) else []}


def write_store(data):
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=DATA_FILE.parent, delete=False) as file:
        json.dump(data, file, ensure_ascii=False, separators=(",", ":"))
        file.write("\n")
        temp_name = file.name
    os.replace(temp_name, DATA_FILE)


def json_response(handler, status, payload, extra_headers=None):
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("X-Content-Type-Options", "nosniff")
    for name, value in extra_headers or []:
        handler.send_header(name, value)
    handler.end_headers()
    handler.wfile.write(body)


def headers_response(handler, status):
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("X-Content-Type-Options", "nosniff")
    handler.end_headers()


def read_json_body(handler):
    try:
        length = int(handler.headers.get("Content-Length", "0"))
    except ValueError:
        raise ValueError("missing_length")

    if length <= 0:
        raise ValueError("empty_body")
    if length > MAX_BODY_BYTES:
        raise ValueError("body_too_large")

    try:
        return json.loads(handler.rfile.read(length).decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("invalid_json") from exc


def password_hash(password, salt=None, iterations=240_000):
    salt_bytes = salt or os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt_bytes, iterations)
    encoded_salt = base64.urlsafe_b64encode(salt_bytes).decode("ascii").rstrip("=")
    encoded_digest = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
    return f"pbkdf2_sha256${iterations}${encoded_salt}${encoded_digest}"


def verify_password(password):
    if not ADMIN_PASSWORD_HASH:
        return False

    try:
        algorithm, iterations, encoded_salt, expected = ADMIN_PASSWORD_HASH.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = base64.urlsafe_b64decode(encoded_salt + "=" * (-len(encoded_salt) % 4))
        actual_hash = password_hash(str(password or ""), salt=salt, iterations=int(iterations))
    except (ValueError, binascii.Error):
        return False

    return hmac.compare_digest(actual_hash, ADMIN_PASSWORD_HASH)


def is_secure_request(handler):
    return handler.headers.get("X-Forwarded-Proto", "").lower() == "https"


def make_session_cookie(value, max_age=SESSION_TTL_SECONDS, handler=None):
    parts = [
        f"{SESSION_COOKIE_NAME}={value}",
        "Path=/api/friends",
        "HttpOnly",
        "SameSite=Lax",
        f"Max-Age={max_age}",
    ]
    if handler and is_secure_request(handler):
        parts.append("Secure")
    return "; ".join(parts)


def clear_session_cookie(handler):
    return make_session_cookie("", max_age=0, handler=handler)


def make_session_token():
    if not SESSION_SECRET:
        return ""
    issued = str(int(time.time()))
    nonce = uuid.uuid4().hex
    payload = f"{issued}.{nonce}"
    signature = hmac.new(SESSION_SECRET.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{payload}.{signature}"


def get_cookie_value(handler, name):
    raw_cookie = handler.headers.get("Cookie", "")
    if not raw_cookie:
        return ""
    cookie = SimpleCookie()
    try:
        cookie.load(raw_cookie)
    except Exception:
        return ""
    return cookie[name].value if name in cookie else ""


def is_authenticated(handler):
    if not SESSION_SECRET:
        return False

    token = get_cookie_value(handler, SESSION_COOKIE_NAME)
    parts = token.split(".")
    if len(parts) != 3:
        return False

    issued, nonce, signature = parts
    if not issued.isdigit() or not nonce:
        return False

    payload = f"{issued}.{nonce}"
    expected = hmac.new(SESSION_SECRET.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        return False

    return int(time.time()) - int(issued) <= SESSION_TTL_SECONDS


def mutating_origin_allowed(handler):
    origin = handler.headers.get("Origin")
    if not origin:
        return True

    parsed = urlparse(origin)
    return parsed.scheme in {"http", "https"} and parsed.netloc == handler.headers.get("Host", "")


def mutating_request_allowed(handler, require_json=True):
    if handler.headers.get("X-Requested-With") != "XMLHttpRequest":
        return False

    if handler.headers.get("Sec-Fetch-Site", "").lower() == "cross-site":
        return False

    if require_json:
        media_type = handler.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if media_type != "application/json":
            return False

    return mutating_origin_allowed(handler)


def client_ip(handler):
    peer = str(handler.client_address[0] if handler.client_address else "")
    if peer not in {"127.0.0.1", "::1"}:
        return peer

    forwarded = handler.headers.get("X-Forwarded-For", "")
    for candidate in reversed([part.strip() for part in forwarded.split(",") if part.strip()]):
        try:
            return str(ipaddress.ip_address(candidate))
        except ValueError:
            continue
    return peer


def consume_rate_limit(bucket_name, handler, limit, window_seconds):
    now = time.monotonic()
    cutoff = now - window_seconds
    key = client_ip(handler)

    with rate_limit_lock:
        bucket = rate_limit_buckets[bucket_name]
        recent = [timestamp for timestamp in bucket.get(key, []) if timestamp > cutoff]
        if len(recent) >= limit:
            return max(1, int(recent[0] + window_seconds - now) + 1)

        recent.append(now)
        bucket[key] = recent

        if len(bucket) > 4096:
            stale_keys = [item_key for item_key, values in bucket.items() if not values or values[-1] <= cutoff]
            for item_key in stale_keys:
                bucket.pop(item_key, None)

    return 0


def reject_rate_limited(handler, retry_after):
    json_response(
        handler,
        HTTPStatus.TOO_MANY_REQUESTS,
        {"error": "rate_limited", "message": "Too many requests. Please try again later."},
        [("Retry-After", str(retry_after))],
    )


def probe_project_site(site):
    parsed = urlparse(site["url"])
    started = time.perf_counter()
    connection = None
    try:
        connection = HTTPSConnection(
            parsed.hostname,
            parsed.port or 443,
            timeout=SITE_STATUS_TIMEOUT_SECONDS,
        )
        path = parsed.path or "/"
        if parsed.query:
            path = f"{path}?{parsed.query}"
        connection.request(
            "HEAD",
            path,
            headers={
                "Accept": "*/*",
                "Connection": "close",
                "User-Agent": "Monika-Nexus-Status/1.0",
            },
        )
        response = connection.getresponse()
        latency_ms = max(1, round((time.perf_counter() - started) * 1000))
        return {
            "id": site["id"],
            "url": site["url"],
            "live": True,
            "latencyMs": latency_ms,
            "status": response.status,
        }
    except (OSError, TimeoutError, HTTPException):
        return {
            "id": site["id"],
            "url": site["url"],
            "live": False,
            "latencyMs": None,
            "status": None,
        }
    finally:
        if connection is not None:
            connection.close()


def project_site_status():
    now = time.monotonic()
    with site_status_lock:
        cached = site_status_cache["payload"]
        if cached is not None and now < site_status_cache["expires"]:
            return cached

        with ThreadPoolExecutor(max_workers=len(PROJECT_SITES)) as executor:
            sites = list(executor.map(probe_project_site, PROJECT_SITES))
        payload = {"checkedAt": utc_now(), "sites": sites}
        site_status_cache["payload"] = payload
        site_status_cache["expires"] = time.monotonic() + SITE_STATUS_CACHE_SECONDS
        return payload


def require_admin(handler):
    if not is_authenticated(handler):
        json_response(handler, HTTPStatus.UNAUTHORIZED, {"error": "unauthorized", "message": "请先登录。"})
        return False
    return True


def friend_id_from_path(path):
    prefix = "/api/friends/"
    if not path.startswith(prefix):
        return ""
    friend_id = unquote(path[len(prefix):]).strip()
    return friend_id if friend_id and "/" not in friend_id else ""


def normalize_url(value):
    raw = str(value or "").strip()
    if not raw:
        raise ValueError("网址不能为空")

    scheme_match = re.match(r"^([a-z][a-z0-9+.-]*):", raw, flags=re.IGNORECASE)
    if scheme_match and not re.match(r"^https?://", raw, flags=re.IGNORECASE) and "." not in scheme_match.group(1):
        raise ValueError("网址格式不太对")
    if "://" in raw and not re.match(r"^https?://", raw, flags=re.IGNORECASE):
        raise ValueError("网址格式不太对")

    if not re.match(r"^https?://", raw, flags=re.IGNORECASE):
        raw = f"https://{raw}"

    parsed = urlparse(raw)
    scheme = parsed.scheme.lower()
    if scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("网址格式不太对")

    try:
        parsed.port
    except ValueError as exc:
        raise ValueError("网址格式不太对") from exc

    if not parsed.hostname:
        raise ValueError("网址格式不太对")

    netloc = parsed.netloc.lower()
    path = parsed.path or "/"
    return urlunparse((scheme, netloc, path, "", parsed.query, parsed.fragment))


def normalize_avatar(value):
    if not value:
        return ""

    avatar = str(value).strip()
    match = DATA_URL_RE.match(avatar)
    if not match:
        raise ValueError("头像格式不支持")

    media_type = match.group(1).lower()
    if media_type not in ALLOWED_IMAGE_TYPES:
        raise ValueError("头像仅支持 PNG/JPG/WebP/GIF")

    encoded = re.sub(r"\s+", "", match.group(2))
    try:
        decoded = base64.b64decode(encoded, validate=True)
    except binascii.Error as exc:
        raise ValueError("头像格式不支持") from exc

    if len(decoded) > MAX_AVATAR_BYTES:
        raise ValueError("头像请选择 3MB 以内的图片")

    return f"data:{media_type};base64,{encoded}"


def sanitize_link(payload):
    name = str(payload.get("name", "")).strip()[:18]
    intro = str(payload.get("intro", "")).strip()[:10]
    url = normalize_url(payload.get("url", ""))
    avatar = normalize_avatar(payload.get("avatar", ""))

    if not name:
        raise ValueError("昵称不能为空")
    if not intro:
        raise ValueError("介绍不能为空")

    return {
        "id": str(payload.get("id") or uuid.uuid4()),
        "name": name,
        "intro": intro,
        "url": url,
        "avatar": avatar,
        "createdAt": str(payload.get("createdAt") or utc_now()),
    }


class FriendsHandler(BaseHTTPRequestHandler):
    server_version = "FriendsAPI/1.0"

    def do_OPTIONS(self):
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Allow", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Requested-With")
        self.end_headers()

    def do_HEAD(self):
        if self.path.split("?", 1)[0] not in {"/api/friends", "/api/friends/session", "/api/friends/sites"}:
            headers_response(self, HTTPStatus.NOT_FOUND)
            return
        headers_response(self, HTTPStatus.OK)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/friends/session":
            authenticated = is_authenticated(self)
            json_response(
                self,
                HTTPStatus.OK,
                {"authenticated": authenticated, "user": ADMIN_USERNAME if authenticated else ""},
            )
            return

        if path == "/api/friends/sites":
            json_response(self, HTTPStatus.OK, project_site_status())
            return

        if path != "/api/friends":
            json_response(self, HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return

        with store_lock:
            data = read_store()
        json_response(self, HTTPStatus.OK, data)

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/friends/session":
            self.handle_login()
            return

        if path != "/api/friends":
            json_response(self, HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return

        if not mutating_request_allowed(self):
            json_response(self, HTTPStatus.FORBIDDEN, {"error": "bad_origin"})
            return

        retry_after = consume_rate_limit(
            "submission",
            self,
            SUBMISSION_RATE_LIMIT,
            SUBMISSION_RATE_WINDOW_SECONDS,
        )
        if retry_after:
            reject_rate_limited(self, retry_after)
            return

        try:
            payload = read_json_body(self)
        except ValueError as exc:
            if str(exc) == "missing_length":
                json_response(self, HTTPStatus.LENGTH_REQUIRED, {"error": "missing_length"})
            elif str(exc) == "body_too_large":
                json_response(self, HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "body_too_large", "message": "头像请选择 3MB 以内的图片。"})
            elif str(exc) == "invalid_json":
                json_response(self, HTTPStatus.BAD_REQUEST, {"error": "invalid_json", "message": "提交内容格式不对。"})
            else:
                json_response(self, HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return

        try:
            link = sanitize_link(payload if isinstance(payload, dict) else {})
        except ValueError as exc:
            json_response(self, HTTPStatus.BAD_REQUEST, {"error": "invalid_link", "message": str(exc)})
            return

        with store_lock:
            data = read_store()
            links = data["links"]

            if any(str(item.get("url", "")).lower() == link["url"].lower() for item in links if isinstance(item, dict)):
                json_response(self, HTTPStatus.CONFLICT, {"error": "duplicate_url", "message": "这个网址已经在友链里了。", "links": links})
                return

            if len(links) >= MAX_LINKS:
                json_response(self, HTTPStatus.CONFLICT, {"error": "links_full", "message": "友链位置暂时满了。", "links": links})
                return

            links.append(link)
            data = {"links": links, "updatedAt": utc_now()}
            write_store(data)

        json_response(self, HTTPStatus.CREATED, {"link": link, "links": links})

    def do_PUT(self):
        path = self.path.split("?", 1)[0]
        friend_id = friend_id_from_path(path)
        if not friend_id or path == "/api/friends/session":
            json_response(self, HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return

        if not mutating_request_allowed(self):
            json_response(self, HTTPStatus.FORBIDDEN, {"error": "bad_origin"})
            return
        if not require_admin(self):
            return

        try:
            payload = read_json_body(self)
        except ValueError as exc:
            if str(exc) == "body_too_large":
                json_response(self, HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "body_too_large", "message": "头像请选择 3MB 以内的图片。"})
            elif str(exc) == "invalid_json":
                json_response(self, HTTPStatus.BAD_REQUEST, {"error": "invalid_json", "message": "提交内容格式不对。"})
            else:
                json_response(self, HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return

        try:
            link = sanitize_link(payload if isinstance(payload, dict) else {})
        except ValueError as exc:
            json_response(self, HTTPStatus.BAD_REQUEST, {"error": "invalid_link", "message": str(exc)})
            return

        with store_lock:
            data = read_store()
            links = data["links"]
            index = next((i for i, item in enumerate(links) if isinstance(item, dict) and str(item.get("id")) == friend_id), -1)
            if index < 0:
                json_response(self, HTTPStatus.NOT_FOUND, {"error": "not_found", "message": "没有找到这条友链。"})
                return

            duplicate = any(
                str(item.get("url", "")).lower() == link["url"].lower() and str(item.get("id")) != friend_id
                for item in links
                if isinstance(item, dict)
            )
            if duplicate:
                json_response(self, HTTPStatus.CONFLICT, {"error": "duplicate_url", "message": "这个网址已经在友链里了。", "links": links})
                return

            previous = links[index]
            link["id"] = friend_id
            link["createdAt"] = str(previous.get("createdAt") or link.get("createdAt") or utc_now())
            link["updatedAt"] = utc_now()
            links[index] = link
            data = {"links": links, "updatedAt": utc_now()}
            write_store(data)

        json_response(self, HTTPStatus.OK, {"link": link, "links": links})

    def do_DELETE(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/friends/session":
            if not mutating_request_allowed(self, require_json=False):
                json_response(self, HTTPStatus.FORBIDDEN, {"error": "bad_origin"})
                return
            json_response(self, HTTPStatus.OK, {"authenticated": False}, [("Set-Cookie", clear_session_cookie(self))])
            return

        friend_id = friend_id_from_path(path)
        if not friend_id:
            json_response(self, HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return

        if not mutating_request_allowed(self, require_json=False):
            json_response(self, HTTPStatus.FORBIDDEN, {"error": "bad_origin"})
            return
        if not require_admin(self):
            return

        with store_lock:
            data = read_store()
            links = data["links"]
            kept_links = [item for item in links if not (isinstance(item, dict) and str(item.get("id")) == friend_id)]
            if len(kept_links) == len(links):
                json_response(self, HTTPStatus.NOT_FOUND, {"error": "not_found", "message": "没有找到这条友链。"})
                return
            data = {"links": kept_links, "updatedAt": utc_now()}
            write_store(data)

        json_response(self, HTTPStatus.OK, {"links": kept_links})

    def handle_login(self):
        if not mutating_request_allowed(self):
            json_response(self, HTTPStatus.FORBIDDEN, {"error": "bad_origin"})
            return


        retry_after = consume_rate_limit("login", self, LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW_SECONDS)
        if retry_after:
            reject_rate_limited(self, retry_after)
            return

        try:
            payload = read_json_body(self)
        except ValueError as exc:
            if str(exc) == "invalid_json":
                json_response(self, HTTPStatus.BAD_REQUEST, {"error": "invalid_json", "message": "提交内容格式不对。"})
            else:
                json_response(self, HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return

        username = str(payload.get("username", "") if isinstance(payload, dict) else "").strip()
        password = str(payload.get("password", "") if isinstance(payload, dict) else "")
        if username != ADMIN_USERNAME or not verify_password(password):
            json_response(self, HTTPStatus.UNAUTHORIZED, {"error": "invalid_credentials", "message": "用户名或密码不对。"})
            return

        token = make_session_token()
        if not token:
            json_response(self, HTTPStatus.SERVICE_UNAVAILABLE, {"error": "auth_not_configured", "message": "登录服务还没有配置好。"})
            return

        json_response(
            self,
            HTTPStatus.OK,
            {"authenticated": True, "user": ADMIN_USERNAME},
            [("Set-Cookie", make_session_cookie(token, handler=self))],
        )

    def log_message(self, fmt, *args):
        print(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {self.address_string()} {fmt % args}", flush=True)


def main():
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((HOST, PORT), FriendsHandler)
    print(f"Friends API listening on http://{HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
