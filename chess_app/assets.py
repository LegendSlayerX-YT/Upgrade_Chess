"""Cache-busting for the front-end ES modules.

The browser caches static JS aggressively (and Cloudflare in front of the site
overrides our `no-cache` with a multi-hour `max-age`), so a deploy can stay
invisible until the cache expires. To make deploys take effect immediately we
stamp every asset URL with `?v=<ASSET_VERSION>`, a hash of the JS that only
changes when the JS changes. Because the modules import each other with
hardcoded relative paths (`import './state.js'`), versioning the entry point is
not enough — we rewrite those import specifiers at serve time so the version
cascades through the whole module graph. A version-stamped URL never changes
content, so each response is served `immutable`.
"""

import hashlib
import os
import re

from flask import Response, abort

from chess_app import state

_STATIC_DIR = state.app.static_folder
_JS_DIR = os.path.join(_STATIC_DIR, "js")

# Relative module specifiers inside import/export statements, e.g.
#   import { x } from './state.js'      ->  from './state.js?v=...'
#   } from '../ui.js'                   ->  from '../ui.js?v=...'
#   import './combat.js'                ->  import './combat.js?v=...'
# Absolute URLs (https://esm.sh/...) start with a scheme, not '.', so they are
# left untouched.
_REL_IMPORT_RE = re.compile(
    r"""(\bfrom\s*|\bimport\s*)(['"])(\.{1,2}/[^'"]+?\.js)(['"])"""
)


def _iter_js_paths():
    yield os.path.join(_STATIC_DIR, "app.js")
    for root, _dirs, files in os.walk(_JS_DIR):
        for name in files:
            if name.endswith(".js"):
                yield os.path.join(root, name)


def _compute_version():
    digest = hashlib.sha256()
    for path in sorted(_iter_js_paths()):
        with open(path, "rb") as fh:
            digest.update(fh.read())
        digest.update(b"\0")
    return digest.hexdigest()[:12]


ASSET_VERSION = _compute_version()


def _stamp_imports(source):
    return _REL_IMPORT_RE.sub(
        lambda m: f"{m.group(1)}{m.group(2)}{m.group(3)}?v={ASSET_VERSION}{m.group(4)}",
        source,
    )


# Files don't change while the server runs, so stamp each one once.
_stamped_cache = {}


def _serve_module(abs_path):
    if not os.path.isfile(abs_path):
        abort(404)
    body = _stamped_cache.get(abs_path)
    if body is None:
        with open(abs_path, "r", encoding="utf-8") as fh:
            body = _stamp_imports(fh.read())
        _stamped_cache[abs_path] = body
    resp = Response(body, mimetype="text/javascript")
    resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return resp


@state.app.route("/static/app.js")
def serve_app_js():
    return _serve_module(os.path.join(_STATIC_DIR, "app.js"))


@state.app.route("/static/js/<path:filename>")
def serve_js_module(filename):
    abs_path = os.path.abspath(os.path.join(_JS_DIR, filename))
    if not filename.endswith(".js") or not abs_path.startswith(os.path.abspath(_JS_DIR) + os.sep):
        abort(404)
    return _serve_module(abs_path)


@state.app.context_processor
def _inject_asset_version():
    return {"asset_version": ASSET_VERSION}
