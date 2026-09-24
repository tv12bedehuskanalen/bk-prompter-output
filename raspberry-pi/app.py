from flask import Flask, render_template, request, redirect, url_for
import os
import socket
import subprocess

app = Flask(__name__)
DEFAULT_URL = "http://10.144.144.162:7890/output"
URL_FILE = os.path.expanduser("~/prompter_url.txt")
PORT = 8443
VERSION_FILE = os.path.join(os.path.dirname(__file__), "VERSION")
UPDATE_SCRIPT = os.path.join(os.path.dirname(__file__), "update-bk-prompter.sh")
UPDATE_STATUS = os.path.join(os.path.dirname(__file__), "update-status")


def app_version():
    try:
        with open(VERSION_FILE, encoding="utf-8") as version_file:
            return "v" + version_file.read().strip().lstrip("v")
    except OSError:
        return "vdev"


def site_name():
    """BK-AES-PROMPTER becomes BK AES; other hostnames remain readable."""
    parts = socket.gethostname().split("-")
    return " ".join(parts[:2]).upper() if len(parts) >= 2 else socket.gethostname().upper()


@app.route("/", methods=["GET", "POST"])
def index():
    if request.method == "POST":
        if "software_update" in request.form:
            subprocess.Popen([UPDATE_SCRIPT], start_new_session=True)
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
    return render_template("index.html", current_url=current_url, site_name=site_name(), version=app_version(), update_status=update_status)


if __name__ == "__main__":
    if not os.path.exists(URL_FILE):
        with open(URL_FILE, "w", encoding="utf-8") as url_file:
            url_file.write(DEFAULT_URL)
    app.run(host="127.0.0.1", port=PORT)
