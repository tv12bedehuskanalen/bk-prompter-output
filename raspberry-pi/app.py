from flask import Flask, render_template, request, redirect, url_for
import os
import socket
import subprocess
import threading
import time
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

app = Flask(__name__, static_folder="branding", static_url_path="/branding")
DEFAULT_URL = "http://10.144.144.162:7890/output"
URL_FILE = os.path.expanduser("~/prompter_url.txt")
PORT = 8443
VERSION_FILE = os.path.join(os.path.dirname(__file__), "VERSION")
UPDATE_SCRIPT = os.path.join(os.path.dirname(__file__), "update-bk-prompter.sh")
UPDATE_STATUS = os.path.join(os.path.dirname(__file__), "update-status")
UPDATE_AVAILABLE = os.path.join(os.path.dirname(__file__), "update-available")
TITLE_FILE = os.path.join(os.path.dirname(__file__), "title.txt")


def app_version():
    try:
        with open(VERSION_FILE, encoding="utf-8") as version_file:
            return "v" + version_file.read().strip().lstrip("v")
    except OSError:
        return "vdev"


def page_title():
    try:
        with open(TITLE_FILE, encoding="utf-8") as title_file:
            title = title_file.read().strip()
            if title:
                return title
    except OSError:
        pass
    return site_name()


def site_name():
    """BK-AES-PROMPTER becomes BK AES; other hostnames remain readable."""
    parts = socket.gethostname().split("-")
    return " ".join(parts[:2]).upper() if len(parts) >= 2 else socket.gethostname().upper()


def full_hostname():
    return socket.gethostname().upper()


def update_check_loop():
    time.sleep(86400)
    while True:
        try:
            subprocess.run(["sudo", "-n", UPDATE_SCRIPT, "--check"], timeout=60, check=False)
        except (OSError, subprocess.SubprocessError):
            pass
        time.sleep(86400)


@app.route("/", methods=["GET", "POST"])
def index():
    if request.method == "POST":
        if "software_update" in request.form:
            subprocess.Popen(["sudo", "-n", UPDATE_SCRIPT], start_new_session=True)
        elif "save_title" in request.form:
            title = request.form.get("title", "").strip()[:80]
            if title:
                with open(TITLE_FILE, "w", encoding="utf-8") as title_file:
                    title_file.write(title + "\n")
        elif "update" in request.form:
            new_url = request.form.get("url", "").strip()
            if new_url:
                with open(URL_FILE, "w", encoding="utf-8") as url_file:
                    url_file.write(new_url)
        elif "refresh" in request.form:
            os.utime(URL_FILE, None)
        elif "reboot" in request.form:
            subprocess.Popen(["sudo", "-n", "/usr/bin/systemctl", "reboot"])
            return redirect(url_for("index"))

    with open(URL_FILE, encoding="utf-8") as url_file:
        current_url = url_file.read().strip()
    try:
        with open(UPDATE_STATUS, encoding="utf-8") as status_file:
            update_status = status_file.read().strip()
    except OSError:
        update_status = ""
    if not update_status.startswith("Updated from"):
        update_status = ""
    try:
        with open(UPDATE_AVAILABLE, encoding="utf-8") as available_file:
            update_available = available_file.read().strip()
    except OSError:
        update_available = ""
    if update_status.startswith("Updated from"):
        try:
            os.remove(UPDATE_STATUS)
        except OSError:
            pass
    return render_template("index.html", current_url=current_url, site_name=site_name(), full_hostname=full_hostname(), page_title=page_title(), version=app_version(), update_status=update_status, update_available=update_available)


@app.get("/preview")
def preview():
    """Fetch only the saved output URL through the Pi for remote previews."""
    try:
        with open(URL_FILE, encoding="utf-8") as url_file:
            target = url_file.read().strip()
        request = Request(target, headers={"User-Agent": "BK-Prompter-Preview/1.0"})
        with urlopen(request, timeout=10) as response:
            body = response.read()
            content_type = response.headers.get("Content-Type", "text/html; charset=utf-8")
        if content_type.startswith("text/html"):
            html = body.decode("utf-8", errors="replace")
            html = html.replace("<head>", '<head><base href="/preview-assets/">', 1)
            body = html.encode("utf-8")
        return body, 200, {"Content-Type": content_type, "Cache-Control": "no-store"}
    except Exception as error:
        return f"Preview unavailable: {error}", 502, {"Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store"}


@app.get("/preview-assets/<path:asset_path>")
def preview_asset(asset_path):
    """Proxy same-origin relative assets from the saved output URL."""
    try:
        with open(URL_FILE, encoding="utf-8") as url_file:
            target = url_file.read().strip()
        parsed = urlparse(target)
        if not parsed.scheme or not parsed.netloc or ".." in asset_path.split("/"):
            return "Invalid preview asset", 400
        base = target.rsplit("/", 1)[0] + "/"
        asset_url = urljoin(base, asset_path)
        asset_parsed = urlparse(asset_url)
        if asset_parsed.scheme != parsed.scheme or asset_parsed.netloc != parsed.netloc:
            return "Preview asset outside output origin", 403
        with urlopen(Request(asset_url, headers={"User-Agent": "BK-Prompter-Preview/1.0"}), timeout=10) as response:
            body = response.read()
            content_type = response.headers.get("Content-Type", "application/octet-stream")
        return body, 200, {"Content-Type": content_type, "Cache-Control": "no-store"}
    except Exception as error:
        return f"Preview asset unavailable: {error}", 502, {"Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store"}


@app.get("/update-status")
def update_status_api():
    available = ""
    status = ""
    for path, target in ((UPDATE_AVAILABLE, "available"), (UPDATE_STATUS, "status")):
        try:
            with open(path, encoding="utf-8") as value_file:
                value = value_file.read().strip()
            if target == "available": available = value
            else: status = value
        except OSError:
            pass
    return {"available": available, "status": status, "version": app_version()}


@app.get("/update-check")
def update_check_api():
    try:
        subprocess.run(["sudo", "-n", UPDATE_SCRIPT, "--check"], timeout=60, check=False)
    except (OSError, subprocess.SubprocessError):
        pass
    return update_status_api()


if __name__ == "__main__":
    if not os.path.exists(URL_FILE):
        with open(URL_FILE, "w", encoding="utf-8") as url_file:
            url_file.write(DEFAULT_URL)
    threading.Thread(target=update_check_loop, daemon=True).start()
    app.run(host="127.0.0.1", port=PORT)
