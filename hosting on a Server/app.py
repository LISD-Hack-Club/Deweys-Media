from flask import Flask, render_template, request, redirect, url_for, session, flash, jsonify, abort
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from werkzeug.middleware.proxy_fix import ProxyFix
from sqlalchemy import or_, and_
from datetime import date, datetime, timedelta
from functools import wraps
from flask_sock import Sock
import os
import uuid
import json
import random
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# =========================================================
# APP SETUP
# =========================================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__)

# ---------------- CORE / SECURITY CONFIG ----------------
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "change-this-in-production-now")

app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get(
    "DATABASE_URL",
    "sqlite:////var/www/deweys-media/instance/database.db"
)
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

# Request / upload limits
app.config["MAX_CONTENT_LENGTH"] = int(
    os.environ.get("MAX_CONTENT_LENGTH", 100 * 1024 * 1024)
)

# Cookies / proxy
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = os.environ.get("SESSION_COOKIE_SECURE", "false").lower() == "true"
app.config["REMEMBER_COOKIE_HTTPONLY"] = True
app.config["PREFERRED_URL_SCHEME"] = "https"

# Trust reverse proxy headers from nginx
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1)

# ---------------- PATHS ----------------
app.config["UPLOAD_BASE"] = os.environ.get(
    "UPLOAD_BASE",
    os.path.join(BASE_DIR, "static", "uploads")
)
os.makedirs(app.config["UPLOAD_BASE"], exist_ok=True)

app.config["MESSAGE_UPLOADS"] = os.environ.get(
    "MESSAGE_UPLOADS",
    os.path.join(BASE_DIR, "static", "message_uploads")
)
os.makedirs(app.config["MESSAGE_UPLOADS"], exist_ok=True)

app.config["STORY_UPLOAD_FOLDER"] = os.environ.get(
    "STORY_UPLOAD_FOLDER",
    os.path.join(BASE_DIR, "static", "story_uploads")
)
os.makedirs(app.config["STORY_UPLOAD_FOLDER"], exist_ok=True)

# ---------------- MAIL CONFIG ----------------
app.config["MAIL_SERVER"] = os.environ.get("MAIL_SERVER", "smtp.gmail.com")
app.config["MAIL_PORT"] = int(os.environ.get("MAIL_PORT", 587))
app.config["MAIL_USE_TLS"] = os.environ.get("MAIL_USE_TLS", "true").lower() == "true"
app.config["MAIL_USERNAME"] = os.environ.get("MAIL_USERNAME", "")
app.config["MAIL_FROM"] = os.environ.get("MAIL_FROM", "")
app.config["MAIL_PASSWORD"] = os.environ.get("DEWEYS_GMAIL_APP_PASSWORD", "")

db = SQLAlchemy(app)
sock = Sock(app)

# =========================================================
# GENERAL HELPERS
# =========================================================
def safe_slug(text: str) -> str:
    return secure_filename(text or "").lower()


def ensure_user_slug(user: "User") -> str:
    if not user.upload_slug:
        base = safe_slug(user.username)
        if not base:
            base = f"user_{uuid.uuid4().hex[:8]}"

        candidate = base
        n = 1
        while User.query.filter_by(upload_slug=candidate).first() is not None:
            n += 1
            candidate = f"{base}_{n}"

        user.upload_slug = candidate
        db.session.commit()

    return user.upload_slug


def user_upload_dir(user: "User", kind: str) -> str:
    slug = ensure_user_slug(user)
    folder = os.path.join(app.config["UPLOAD_BASE"], slug, kind)
    os.makedirs(folder, exist_ok=True)
    return folder


def save_file(file_storage, folder: str) -> str:
    ext = os.path.splitext(file_storage.filename)[1].lower()
    base = secure_filename(os.path.splitext(file_storage.filename)[0])[:50] or "file"
    filename = f"{base}_{uuid.uuid4().hex}{ext}"
    path = os.path.join(folder, filename)
    file_storage.save(path)
    return filename


def delete_file_if_exists(path: str):
    try:
        if path and os.path.exists(path):
            os.remove(path)
    except Exception:
        pass


def calc_age_13_plus(birthday_str: str) -> bool:
    try:
        b = datetime.strptime(birthday_str, "%Y-%m-%d").date()
        today = date.today()
        age = today.year - b.year - ((today.month, today.day) < (b.month, b.day))
        return age >= 13
    except Exception:
        return False


def current_user():
    if "user_id" not in session:
        return None
    return User.query.get(session["user_id"])


def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if "user_id" not in session:
            return redirect(url_for("login"))
        return f(*args, **kwargs)
    return decorated_function


def must_login_json():
    return jsonify({"error": "Not logged in"}), 403


def avatar_url_for(user: "User") -> str:
    if user and user.avatar_filename:
        slug = ensure_user_slug(user)
        return f"/static/uploads/{slug}/avatars/{user.avatar_filename}"
    return "/static/assets/imgs/avatar_placeholder.png"


def post_media_url_for(user: "User", filename: str) -> str:
    slug = ensure_user_slug(user)
    return f"/static/uploads/{slug}/posts/{filename}"


def generate_reset_code():
    return f"{random.randint(0, 999999):06d}"


def send_reset_email(to_email: str, code: str):
    mail_user = app.config.get("MAIL_USERNAME")
    mail_pass = app.config.get("MAIL_PASSWORD")
    mail_from = app.config.get("MAIL_FROM")

    if not mail_user or not mail_pass:
        raise Exception("Email config missing. Set DEWEYS_GMAIL_APP_PASSWORD first.")

    subject = "Deweys Media Password Reset Code"

    html_body = f"""
    <div style="font-family: Arial, sans-serif; background:#0f1115; color:#ffffff; padding:24px; border-radius:16px;">
        <h2 style="margin-top:0;">Deweys Media</h2>
        <p>You requested a password reset.</p>
        <p>Your 6-digit code is:</p>
        <div style="font-size:32px; font-weight:700; letter-spacing:6px; margin:18px 0; color:#9be15d;">
            {code}
        </div>
        <p>This code expires in <b>5 minutes</b>.</p>
        <p>If you did not request this, you can ignore this email.</p>
    </div>
    """

    plain_body = f"""
Deweys Media

You requested a password reset.

Your 6-digit code is: {code}

This code expires in 5 minutes.

If you did not request this, you can ignore this email.
""".strip()

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = mail_from
    msg["To"] = to_email

    msg.attach(MIMEText(plain_body, "plain"))
    msg.attach(MIMEText(html_body, "html"))

    with smtplib.SMTP(app.config["MAIL_SERVER"], app.config["MAIL_PORT"]) as server:
        server.starttls()
        server.login(mail_user, mail_pass)
        server.sendmail(mail_from, [to_email], msg.as_string())

def send_feedback_email(user, feedback_text: str):
    mail_user = app.config.get("MAIL_USERNAME")
    mail_pass = app.config.get("MAIL_PASSWORD")
    mail_from = app.config.get("MAIL_FROM")

    if not mail_user or not mail_pass:
        raise Exception("Email config missing. Set DEWEYS_GMAIL_APP_PASSWORD first.")

    to_email = "deweysstudio@gmail.com"
    subject = f"Deweys Media Feedback from {user.username} (ID: {user.id})"

    safe_feedback = (feedback_text or "").strip()

    plain_body = f"""
New Deweys Media Feedback

User ID: {user.id}
Username: {user.username}
Email: {user.email or 'No email'}
Submitted At: {datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")}

Feedback:
{safe_feedback}
""".strip()

    html_body = f"""
    <div style="font-family: Arial, sans-serif; background:#0f1115; color:#ffffff; padding:24px; border-radius:16px;">
        <h2 style="margin-top:0;">New Deweys Media Feedback</h2>

        <p><b>User ID:</b> {user.id}</p>
        <p><b>Username:</b> {user.username}</p>
        <p><b>Email:</b> {user.email or 'No email'}</p>
        <p><b>Submitted At:</b> {datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")}</p>

        <hr style="border:none; border-top:1px solid #2a2f3a; margin:18px 0;">

        <p><b>Feedback:</b></p>
        <div style="white-space:pre-wrap; background:#151922; padding:14px; border-radius:12px; line-height:1.5;">
            {safe_feedback}
        </div>
    </div>
    """

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = mail_from
    msg["To"] = to_email
    msg["Reply-To"] = user.email or mail_from

    msg.attach(MIMEText(plain_body, "plain"))
    msg.attach(MIMEText(html_body, "html"))

    with smtplib.SMTP(app.config["MAIL_SERVER"], app.config["MAIL_PORT"]) as server:
        server.starttls()
        server.login(mail_user, mail_pass)
        server.sendmail(mail_from, [to_email], msg.as_string())


@app.context_processor
def inject_helpers():
    return dict(
        avatar_url=avatar_url_for,
        post_media_url=post_media_url_for,
        datetime=datetime
    )

# =========================================================
# MODELS
# =========================================================
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(150), unique=True, nullable=False)
    password = db.Column(db.String(200), nullable=False)

    email = db.Column(db.String(200), unique=True, nullable=True)

    profile_visibility = db.Column(db.String(20), default="everyone")
    is_private_account = db.Column(db.Boolean, default=False)

    birthday = db.Column(db.String(10), nullable=True)   # store as YYYY-MM-DD
    location = db.Column(db.String(120), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    upload_slug = db.Column(db.String(150), unique=True, nullable=True)
    avatar_filename = db.Column(db.String(300), nullable=True)
    bio = db.Column(db.String(280), nullable=True)

    reset_code = db.Column(db.String(6), nullable=True)
    reset_code_expires = db.Column(db.DateTime, nullable=True)
    reset_code_verified = db.Column(db.Boolean, default=False)

    posts = db.relationship("Post", backref="user", lazy=True)
    comments = db.relationship("Comment", backref="user", lazy=True)

class Post(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.Text, nullable=False)
    is_private = db.Column(db.Boolean, default=False)

    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)

    media = db.relationship("Media", backref="post", lazy=True, cascade="all, delete-orphan")
    reactions = db.relationship("Reaction", backref="post", lazy=True, cascade="all, delete-orphan")
    comments = db.relationship("Comment", backref="post", lazy=True, cascade="all, delete-orphan")


class Media(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    filename = db.Column(db.String(300))
    media_type = db.Column(db.String(20))
    post_id = db.Column(db.Integer, db.ForeignKey("post.id"), nullable=False)
    owner_user_id = db.Column(db.Integer, nullable=False)


class Reaction(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, nullable=False)
    post_id = db.Column(db.Integer, db.ForeignKey("post.id"), nullable=False)
    emoji = db.Column(db.String(50), nullable=False)


class Comment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.Text, nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    post_id = db.Column(db.Integer, db.ForeignKey("post.id"), nullable=False)


class FriendRequest(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    from_user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    to_user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    status = db.Column(db.String(20), default="pending")
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    accepted_at = db.Column(db.DateTime, nullable=True)


class Notification(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, nullable=False)
    type = db.Column(db.String(40), nullable=False)
    actor_user_id = db.Column(db.Integer, nullable=True)
    post_id = db.Column(db.Integer, nullable=True)
    friend_request_id = db.Column(db.Integer, nullable=True)
    comment_id = db.Column(db.Integer, nullable=True)

    is_read = db.Column(db.Boolean, default=False)
    is_dismissed = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Event(db.Model):
    id = db.Column(db.Integer, primary_key=True)

    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, nullable=True)

    date = db.Column(db.Date, nullable=False)
    time = db.Column(db.String(50), nullable=True)
    location = db.Column(db.String(200), nullable=True)

    visibility = db.Column(db.String(20), default="public")
    theme = db.Column(db.String(50), nullable=True)

    banner_image = db.Column(db.String(300), nullable=True)

    host_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class EventInvite(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    event_id = db.Column(db.Integer, db.ForeignKey("event.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    status = db.Column(db.String(20), default="invited")


class EventRSVP(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    event_id = db.Column(db.Integer, db.ForeignKey("event.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    rsvp = db.Column(db.String(10), default="maybe")
    updated_at = db.Column(db.DateTime, default=datetime.utcnow)


class EventUpdate(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    event_id = db.Column(db.Integer, db.ForeignKey("event.id"), nullable=False)
    author_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    text = db.Column(db.Text, nullable=False)
    photo_url = db.Column(db.String(300), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Conversation(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class ConversationParticipant(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    conversation_id = db.Column(db.Integer, db.ForeignKey("conversation.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)


class Message(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    conversation_id = db.Column(db.Integer, db.ForeignKey("conversation.id"), nullable=False)
    sender_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)

    body = db.Column(db.Text, nullable=False, default="")
    media_url = db.Column(db.String(500), nullable=True)
    media_type = db.Column(db.String(50), nullable=True)
    file_name = db.Column(db.String(255), nullable=True)

    is_read = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Story(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    media_url = db.Column(db.String(500), nullable=True)
    media_type = db.Column(db.String(20), nullable=False, default="image")
    caption = db.Column(db.String(255), nullable=True)
    text_overlay = db.Column(db.Text, nullable=True)
    bg_color = db.Column(db.String(50), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    expires_at = db.Column(db.DateTime, nullable=False)

    user = db.relationship("User", backref=db.backref("stories", lazy=True, cascade="all, delete-orphan"))


class StoryView(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    story_id = db.Column(db.Integer, db.ForeignKey("story.id"), nullable=False)
    viewer_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    viewed_at = db.Column(db.DateTime, default=datetime.utcnow)

    story = db.relationship("Story", backref=db.backref("story_views", lazy=True, cascade="all, delete-orphan"))
    viewer = db.relationship("User", backref=db.backref("viewed_stories", lazy=True))

    __table_args__ = (
        db.UniqueConstraint("story_id", "viewer_id", name="unique_story_view"),
    )

# =========================================================
# NOTIFICATION HELPERS
# =========================================================
def create_notification(user_id: int, type_: str, actor_user_id=None, post_id=None, friend_request_id=None, comment_id=None):
    if not user_id:
        return

    n = Notification(
        user_id=user_id,
        type=type_,
        actor_user_id=actor_user_id,
        post_id=post_id,
        friend_request_id=friend_request_id,
        comment_id=comment_id,
        is_read=False,
        is_dismissed=False
    )
    db.session.add(n)
    db.session.commit()


def notif_actor_dict(actor_id):
    if not actor_id:
        return None
    u = User.query.get(actor_id)
    if not u:
        return None
    return {"id": u.id, "username": u.username, "avatar": avatar_url_for(u)}

# =========================================================
# FRIENDSHIP HELPERS
# =========================================================
def are_friends(a_id: int, b_id: int) -> bool:
    if not a_id or not b_id:
        return False
    if a_id == b_id:
        return True

    fr = FriendRequest.query.filter(
        FriendRequest.status == "accepted",
        or_(
            and_(FriendRequest.from_user_id == a_id, FriendRequest.to_user_id == b_id),
            and_(FriendRequest.from_user_id == b_id, FriendRequest.to_user_id == a_id),
        )
    ).first()
    return fr is not None


def get_friends_ids(me_id):
    accepted_rows = FriendRequest.query.filter(
        FriendRequest.status == "accepted",
        or_(
            FriendRequest.from_user_id == me_id,
            FriendRequest.to_user_id == me_id
        )
    ).all()

    friend_ids = []
    for row in accepted_rows:
        if row.from_user_id == me_id:
            friend_ids.append(row.to_user_id)
        else:
            friend_ids.append(row.from_user_id)

    return friend_ids

# =========================================================
# EVENT HELPERS
# =========================================================
def is_invited_to_event(event_id: int, user_id: int) -> bool:
    if not user_id:
        return False
    inv = EventInvite.query.filter_by(event_id=event_id, user_id=user_id).first()
    return inv is not None


def can_view_event(e: Event, me_id: int) -> bool:
    if not e or not me_id:
        return False
    if e.host_id == me_id:
        return True

    invited = is_invited_to_event(e.id, me_id)

    if e.visibility == "public":
        return True
    if e.visibility == "private":
        return invited
    if e.visibility == "friends":
        return invited or are_friends(me_id, e.host_id)

    return False


def get_event_or_404_viewable(event_id: int, me_id: int):
    e = Event.query.get(event_id)
    if not e:
        return None, (jsonify({"error": "Event not found"}), 404)
    if not can_view_event(e, me_id):
        return None, (jsonify({"error": "No permission"}), 403)
    return e, None


def event_payload_for_user(e: Event, me_id: int):
    host_user = User.query.get(e.host_id)
    host_name = host_user.username if host_user else ""

    invite = EventInvite.query.filter_by(event_id=e.id, user_id=me_id).first()
    is_invited = invite is not None

    r = EventRSVP.query.filter_by(event_id=e.id, user_id=me_id).first()
    rsvp_val = r.rsvp if r else "maybe"

    return {
        "id": e.id,
        "title": e.title,
        "description": e.description or "",
        "date": e.date.strftime("%Y-%m-%d"),
        "start_time": e.time or "",
        "end_time": "",
        "location": e.location or "",
        "visibility": e.visibility,
        "theme": e.theme or "",
        "banner_image": e.banner_image or "",
        "host_id": e.host_id,
        "host_name": host_name,
        "is_host": (e.host_id == me_id),
        "is_invited": is_invited or (e.host_id == me_id),
        "rsvp": rsvp_val
    }

# =========================================================
# MESSAGE HELPERS
# =========================================================
ALLOWED_MESSAGE_FILES = {
    "png", "jpg", "jpeg", "gif", "webp",
    "mp4", "webm", "mov",
    "mp3", "wav", "ogg",
    "pdf", "doc", "docx", "txt"
}


def allowed_message_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_MESSAGE_FILES


def get_message_file_kind(filename):
    ext = filename.rsplit(".", 1)[1].lower()

    if ext in {"png", "jpg", "jpeg", "gif", "webp"}:
        return "image"
    if ext in {"mp4", "webm", "mov"}:
        return "video"
    if ext in {"mp3", "wav", "ogg"}:
        return "audio"
    return "file"


def get_or_create_dm_conversation(user_a_id: int, user_b_id: int):
    if not user_a_id or not user_b_id or user_a_id == user_b_id:
        return None

    a_rows = ConversationParticipant.query.filter_by(user_id=user_a_id).all()
    a_conv_ids = {row.conversation_id for row in a_rows}

    if a_conv_ids:
        b_rows = ConversationParticipant.query.filter(
            ConversationParticipant.user_id == user_b_id,
            ConversationParticipant.conversation_id.in_(a_conv_ids)
        ).all()

        for row in b_rows:
            participants = ConversationParticipant.query.filter_by(
                conversation_id=row.conversation_id
            ).all()

            ids = sorted([p.user_id for p in participants])
            if ids == sorted([user_a_id, user_b_id]):
                return Conversation.query.get(row.conversation_id)

    conv = Conversation()
    db.session.add(conv)
    db.session.commit()

    db.session.add(ConversationParticipant(conversation_id=conv.id, user_id=user_a_id))
    db.session.add(ConversationParticipant(conversation_id=conv.id, user_id=user_b_id))
    db.session.commit()

    return conv


def get_dm_conversation(user_a_id: int, user_b_id: int):
    if not user_a_id or not user_b_id or user_a_id == user_b_id:
        return None

    a_rows = ConversationParticipant.query.filter_by(user_id=user_a_id).all()
    a_conv_ids = {row.conversation_id for row in a_rows}

    if not a_conv_ids:
        return None

    b_rows = ConversationParticipant.query.filter(
        ConversationParticipant.user_id == user_b_id,
        ConversationParticipant.conversation_id.in_(a_conv_ids)
    ).all()

    for row in b_rows:
        participants = ConversationParticipant.query.filter_by(
            conversation_id=row.conversation_id
        ).all()

        ids = sorted([p.user_id for p in participants])
        if ids == sorted([user_a_id, user_b_id]):
            return Conversation.query.get(row.conversation_id)

    return None


def conversation_has_user(conversation_id: int, user_id: int) -> bool:
    row = ConversationParticipant.query.filter_by(
        conversation_id=conversation_id,
        user_id=user_id
    ).first()
    return row is not None


def last_message_preview(msg):
    if not msg:
        return ""

    if msg.body and msg.body.strip() and msg.body.strip() != "[media]":
        return msg.body

    if msg.media_type == "image":
        return "📷 Photo"
    if msg.media_type == "video":
        return "🎥 Video"
    if msg.media_type == "audio":
        return "🎵 Audio"
    if msg.media_type == "file":
        return "📎 File"

    return ""


def serialize_message(msg: "Message", me_id: int):
    sender = User.query.get(msg.sender_id)
    return {
        "id": msg.id,
        "conversation_id": msg.conversation_id,
        "sender_id": msg.sender_id,
        "sender_name": sender.username if sender else "Unknown",
        "body": "" if (msg.body or "") == "[media]" else (msg.body or ""),
        "media_url": msg.media_url,
        "media_type": msg.media_type,
        "file_name": msg.file_name,
        "is_me": msg.sender_id == me_id,
        "is_read": bool(msg.is_read),
        "created_at": msg.created_at.strftime("%b %d, %Y %I:%M %p"),
        "time_only": msg.created_at.strftime("%I:%M %p").lstrip("0")
    }
    

# =========================================================
# STORIES HELPERS
# =========================================================
STORY_ALLOWED_EXTENSIONS = {
    "png", "jpg", "jpeg", "gif", "webp", "mp4", "webm", "mov"
}


def allowed_story_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in STORY_ALLOWED_EXTENSIONS


def story_file_type(filename):
    ext = filename.rsplit(".", 1)[1].lower()
    if ext in {"mp4", "webm", "mov"}:
        return "video"
    return "image"


def get_story_upload_path(user_id):
    folder = os.path.join(app.config["STORY_UPLOAD_FOLDER"], str(user_id))
    os.makedirs(folder, exist_ok=True)
    return folder


def save_story_file(file_obj, user_id):
    if not file_obj or not file_obj.filename:
        return None, None

    if not allowed_story_file(file_obj.filename):
        return None, None

    original_name = secure_filename(file_obj.filename)
    ext = original_name.rsplit(".", 1)[1].lower()
    unique_name = f"{uuid.uuid4().hex}.{ext}"

    folder = get_story_upload_path(user_id)
    full_path = os.path.join(folder, unique_name)
    file_obj.save(full_path)

    rel_path = "/" + full_path.replace("\\", "/")
    return rel_path, story_file_type(original_name)


def get_story_expiration():
    return datetime.utcnow() + timedelta(hours=24)


def cleanup_expired_stories():
    expired = Story.query.filter(Story.expires_at <= datetime.utcnow()).all()

    for story in expired:
        if story.media_url:
            file_path = story.media_url.lstrip("/")
            if os.path.exists(file_path):
                try:
                    os.remove(file_path)
                except Exception:
                    pass

        StoryView.query.filter_by(story_id=story.id).delete()
        db.session.delete(story)

    db.session.commit()


def serialize_story(story, me_id):
    owner = User.query.get(story.user_id)

    viewed = False
    if me_id != story.user_id:
        viewed = StoryView.query.filter_by(
            story_id=story.id,
            viewer_id=me_id
        ).first() is not None

    return {
        "id": story.id,
        "user_id": story.user_id,
        "username": owner.username if owner else "Unknown",
        "profile_pic": avatar_url_for(owner) if owner else "/static/assets/imgs/avatar_placeholder.png",
        "media_url": story.media_url,
        "media_type": story.media_type,
        "caption": story.caption or "",
        "text_overlay": story.text_overlay or "",
        "bg_color": story.bg_color or "",
        "created_at": story.created_at.isoformat() if story.created_at else None,
        "expires_at": story.expires_at.isoformat() if story.expires_at else None,
        "is_own": story.user_id == me_id,
        "viewed": viewed,
        "views_count": StoryView.query.filter_by(story_id=story.id).count()
    }


def serialize_story_group(user_obj, stories, me_id):
    stories_sorted = sorted(stories, key=lambda s: s.created_at or datetime.utcnow())

    all_viewed = True
    if user_obj.id == me_id:
        all_viewed = False
    else:
        for story in stories_sorted:
            was_viewed = StoryView.query.filter_by(
                story_id=story.id,
                viewer_id=me_id
            ).first() is not None
            if not was_viewed:
                all_viewed = False
                break

    return {
        "user_id": user_obj.id,
        "username": user_obj.username,
        "profile_pic": avatar_url_for(user_obj),
        "is_own": user_obj.id == me_id,
        "all_viewed": all_viewed,
        "stories": [serialize_story(story, me_id) for story in stories_sorted]
    }

# =========================================================
# BASIC PAGES
# =========================================================
@app.route("/")
def home():
    if "user_id" not in session:
        return redirect(url_for("login"))

    me = current_user()
    me_id = me.id

    all_posts = Post.query.order_by(Post.id.desc()).all()
    visible_posts = []

    for post in all_posts:
        if not post.is_private:
            visible_posts.append(post)
        else:
            if post.user_id == me_id:
                visible_posts.append(post)
            elif are_friends(me_id, post.user_id):
                visible_posts.append(post)

    header_avatar = avatar_url_for(me)
    suggestions = User.query.filter(User.id != me_id).limit(5).all()

    return render_template(
        "home.html",
        posts=visible_posts,
        suggestions=suggestions,
        header_avatar=header_avatar
    )

@app.route("/friends")
def friends():
    if "user_id" not in session:
        return redirect(url_for("login"))

    me = current_user()
    header_avatar = avatar_url_for(me)
    return render_template("friends.html", header_avatar=header_avatar)


@app.route("/events")
@login_required
def events_page():
    me = current_user()
    header_avatar = avatar_url_for(me)
    return render_template("events.html", header_avatar=header_avatar)


@app.route("/messages")
@login_required
def messages_page():
    me = current_user()
    header_avatar = avatar_url_for(me)
    return render_template("messages.html", header_avatar=header_avatar)

# =========================================================
# AUTH
# =========================================================
@app.route("/signup", methods=["GET"])
def signup():
    return render_template("signup.html")


@app.route("/check_username")
def check_username():
    u = (request.args.get("u", "") or "").strip()
    if not u:
        return jsonify({"available": False})
    exists = User.query.filter_by(username=u).first() is not None
    return jsonify({"available": not exists})


@app.route("/signup_finish", methods=["POST"])
def signup_finish():
    username = (request.form.get("username") or "").strip()
    password_raw = request.form.get("password") or ""
    email = (request.form.get("email") or "").strip().lower()
    birthday = (request.form.get("birthday") or "").strip()

    if not username or not password_raw or not email or not birthday:
        flash("Please fill out everything.")
        return redirect(url_for("signup"))

    if len(password_raw) < 6:
        flash("Password must be at least 6 characters.")
        return redirect(url_for("signup"))

    if not calc_age_13_plus(birthday):
        flash("You must be 13+ to sign up.")
        return redirect(url_for("signup"))

    if User.query.filter_by(username=username).first():
        flash("Username exists.")
        return redirect(url_for("signup"))

    if User.query.filter_by(email=email).first():
        flash("Email already in use.")
        return redirect(url_for("signup"))

    user = User(
        username=username,
        password=generate_password_hash(password_raw),
        email=email,
        birthday=birthday
    )
    db.session.add(user)
    db.session.commit()
    ensure_user_slug(user)

    avatar_file = request.files.get("avatar")
    if avatar_file and avatar_file.filename:
        folder = user_upload_dir(user, "avatars")
        filename = save_file(avatar_file, folder)
        user.avatar_filename = filename
        db.session.commit()

    session["user_id"] = user.id
    session["username"] = user.username
    return redirect(url_for("home"))


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        identifier = (request.form.get("identifier") or "").strip()
        password = request.form.get("password") or ""

        if not identifier or not password:
            flash("Please fill out both fields.")
            return render_template("login.html")

        user = User.query.filter(
            or_(User.username == identifier, User.email == identifier.lower())
        ).first()

        if user and check_password_hash(user.password, password):
            session["user_id"] = user.id
            session["username"] = user.username
            ensure_user_slug(user)
            return redirect(url_for("home"))

        flash("Invalid email/username or password.")

    return render_template("login.html")


@app.route("/forgot-password/request", methods=["POST"])
def forgot_password_request():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()

    if not email:
        return jsonify({"error": "Email is required."}), 400

    user = User.query.filter_by(email=email).first()

    if not user:
        return jsonify({"message": "If that email exists, a code has been sent."})

    code = generate_reset_code()
    user.reset_code = code
    user.reset_code_expires = datetime.utcnow() + timedelta(minutes=5)
    user.reset_code_verified = False
    db.session.commit()

    try:
        send_reset_email(user.email, code)
    except Exception as e:
        print("Forgot password email error:", e)
        return jsonify({"error": "Could not send email right now."}), 500

    return jsonify({"message": "Code sent to your email."})


@app.route("/forgot-password/verify", methods=["POST"])
def forgot_password_verify():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    code = (data.get("code") or "").strip()

    if not email or not code:
        return jsonify({"error": "Email and code are required."}), 400

    user = User.query.filter_by(email=email).first()
    if not user:
        return jsonify({"error": "Invalid code."}), 400

    if not user.reset_code or not user.reset_code_expires:
        return jsonify({"error": "No reset code found. Request a new one."}), 400

    if datetime.utcnow() > user.reset_code_expires:
        user.reset_code = None
        user.reset_code_expires = None
        user.reset_code_verified = False
        db.session.commit()
        return jsonify({"error": "Code expired. Request a new one."}), 400

    if user.reset_code != code:
        return jsonify({"error": "Invalid code."}), 400

    user.reset_code_verified = True
    db.session.commit()

    session["password_reset_user_id"] = user.id
    return jsonify({"message": "Code verified."})


@app.route("/forgot-password/reset", methods=["POST"])
def forgot_password_reset():
    reset_user_id = session.get("password_reset_user_id")
    if not reset_user_id:
        return jsonify({"error": "Reset session expired. Start over."}), 400

    user = User.query.get(reset_user_id)
    if not user:
        session.pop("password_reset_user_id", None)
        return jsonify({"error": "User not found."}), 404

    if not user.reset_code_verified:
        return jsonify({"error": "Code not verified yet."}), 403

    if not user.reset_code_expires or datetime.utcnow() > user.reset_code_expires:
        user.reset_code = None
        user.reset_code_expires = None
        user.reset_code_verified = False
        db.session.commit()
        session.pop("password_reset_user_id", None)
        return jsonify({"error": "Reset session expired. Start over."}), 400

    data = request.get_json(silent=True) or {}
    password = data.get("password") or ""
    confirm_password = data.get("confirm_password") or ""

    if not password or not confirm_password:
        return jsonify({"error": "Both password fields are required."}), 400

    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters."}), 400

    if password != confirm_password:
        return jsonify({"error": "Passwords do not match."}), 400

    user.password = generate_password_hash(password)
    user.reset_code = None
    user.reset_code_expires = None
    user.reset_code_verified = False

    db.session.commit()
    session.pop("password_reset_user_id", None)

    return jsonify({"message": "Password updated successfully."})


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))

# =========================================================
# POSTS
# =========================================================
@app.route("/create_post", methods=["POST"])
def create_post():
    if "user_id" not in session:
        return must_login_json()

    me = current_user()
    if not me:
        return jsonify({"error": "User not found"}), 404

    content = (request.form.get("content") or "").strip()
    if not content:
        return jsonify({"error": "No content"}), 400

    is_private = request.form.get("private") in ("true", "on", "1", "yes")

    post = Post(content=content, user_id=me.id, is_private=is_private)
    db.session.add(post)
    db.session.commit()

    if "media" in request.files:
        files = request.files.getlist("media")
        folder = user_upload_dir(me, "posts")

        for f in files:
            if f and f.filename:
                filename = save_file(f, folder)
                media_type = "image" if (f.mimetype or "").startswith("image") else "video"
                db.session.add(Media(
                    filename=filename,
                    media_type=media_type,
                    post_id=post.id,
                    owner_user_id=me.id
                ))
        db.session.commit()

    return jsonify({"success": True})


@app.route("/get_post/<int:post_id>")
def get_post(post_id):
    if "user_id" not in session:
        return must_login_json()

    me = current_user()
    if not me:
        return jsonify({"error": "User not found"}), 404

    post = Post.query.get(post_id)
    if not post:
        return jsonify({"error": "Post not found"}), 404

    if post.user_id != me.id:
        return jsonify({"error": "No permission"}), 403

    media_out = []
    for m in post.media:
        media_out.append({
            "id": m.id,
            "url": post_media_url_for(post.user, m.filename),
            "type": m.media_type,
            "filename": m.filename
        })

    return jsonify({
        "id": post.id,
        "content": post.content,
        "private": bool(post.is_private),
        "media": media_out
    })


@app.route("/delete_post/<int:post_id>", methods=["POST"])
def delete_post(post_id):
    if "user_id" not in session:
        return must_login_json()

    me = current_user()
    post = Post.query.get(post_id)

    if not post:
        return jsonify({"error": "Not found"}), 404
    if post.user_id != me.id:
        return jsonify({"error": "No permission"}), 403

    folder = user_upload_dir(me, "posts")
    for m in post.media:
        delete_file_if_exists(os.path.join(folder, m.filename))

    db.session.delete(post)
    db.session.commit()
    return jsonify({"success": True})


@app.route("/edit_post/<int:post_id>", methods=["POST"])
def edit_post(post_id):
    if "user_id" not in session:
        return must_login_json()

    me = current_user()
    post = Post.query.get(post_id)

    if not post:
        return jsonify({"error": "Not found"}), 404
    if post.user_id != me.id:
        return jsonify({"error": "No permission"}), 403

    new_content = (request.form.get("content") or "").strip()
    if not new_content:
        return jsonify({"error": "No content"}), 400

    post.content = new_content

    if "private" in request.form:
        post.is_private = request.form.get("private") in ("true", "on", "1", "yes")

    remove_ids_raw = request.form.get("remove_media_ids", "") or ""
    remove_ids = []
    for x in remove_ids_raw.split(","):
        x = x.strip()
        if x.isdigit():
            remove_ids.append(int(x))

    folder = user_upload_dir(me, "posts")

    for mid in remove_ids:
        m = Media.query.get(mid)
        if m and m.post_id == post.id and m.owner_user_id == me.id:
            delete_file_if_exists(os.path.join(folder, m.filename))
            db.session.delete(m)

    if "media" in request.files:
        files = request.files.getlist("media")
        for f in files:
            if f and f.filename:
                filename = save_file(f, folder)
                media_type = "image" if (f.mimetype or "").startswith("image") else "video"
                db.session.add(Media(
                    filename=filename,
                    media_type=media_type,
                    post_id=post.id,
                    owner_user_id=me.id
                ))

    db.session.commit()
    return jsonify({"success": True})


@app.route("/react_post/<int:post_id>", methods=["POST"])
def react_post(post_id):
    if "user_id" not in session:
        return must_login_json()

    data = request.json or {}
    emoji = data.get("reaction")
    if not emoji:
        return jsonify({"error": "No emoji sent"}), 400

    existing = Reaction.query.filter_by(user_id=session["user_id"], post_id=post_id, emoji=emoji).first()
    if existing:
        db.session.delete(existing)
    else:
        old = Reaction.query.filter_by(user_id=session["user_id"], post_id=post_id).first()
        if old:
            db.session.delete(old)
        db.session.add(Reaction(user_id=session["user_id"], post_id=post_id, emoji=emoji))

    db.session.commit()
    return jsonify({"success": True})


@app.route("/add_comment/<int:post_id>", methods=["POST"])
def add_comment(post_id):
    if "user_id" not in session:
        return must_login_json()

    data = request.json or {}
    content = (data.get("content") or "").strip()
    if not content:
        return jsonify({"error": "Empty comment"}), 400

    post = Post.query.get(post_id)
    if not post:
        return jsonify({"error": "Post not found"}), 404

    c = Comment(content=content, user_id=session["user_id"], post_id=post_id)
    db.session.add(c)
    db.session.commit()

    if post.user_id != session["user_id"]:
        create_notification(
            user_id=post.user_id,
            type_="comment",
            actor_user_id=session["user_id"],
            post_id=post_id,
            comment_id=c.id
        )

    return jsonify({"success": True})


@app.route("/my_page")
def my_page():
    if "user_id" not in session:
        return redirect(url_for("login"))

    user = User.query.get(session["user_id"])
    tab = (request.args.get("tab") or "posts").strip()

    posts = Post.query.filter_by(user_id=user.id).order_by(Post.id.desc()).all()

    stats = {
        "posts": len(posts),
        "media": sum(len(p.media) for p in posts),
        "reactions": sum(len(p.reactions) for p in posts),
        "friends": FriendRequest.query.filter(
            FriendRequest.status == "accepted",
            or_(
                FriendRequest.from_user_id == user.id,
                FriendRequest.to_user_id == user.id
            )
        ).count()
    }

    header_avatar = avatar_url_for(user)

    return render_template(
        "mypage.html",
        user=user,
        posts=posts,
        stats=stats,
        tab=tab,
        header_avatar=header_avatar
    )

# =========================================================
# PROFILE
# =========================================================
@app.route("/update_bio", methods=["POST"])
def update_bio():
    if "user_id" not in session:
        return must_login_json()

    user = User.query.get(session["user_id"])
    if not user:
        return jsonify({"error": "User not found"}), 404

    data = request.json or {}
    bio_text = (data.get("bio") or "").strip()

    if len(bio_text) > 280:
        return jsonify({"error": "Bio too long (max 280)"}), 400

    user.bio = bio_text
    db.session.commit()
    return jsonify({"success": True, "bio": user.bio or ""})


@app.route("/change_avatar", methods=["POST"])
def change_avatar():
    if "user_id" not in session:
        return must_login_json()

    user = User.query.get(session["user_id"])
    if not user:
        return jsonify({"error": "User not found"}), 404

    avatar_file = request.files.get("avatar")
    if not avatar_file or not avatar_file.filename:
        return jsonify({"error": "No file"}), 400

    folder = user_upload_dir(user, "avatars")

    if user.avatar_filename:
        delete_file_if_exists(os.path.join(folder, user.avatar_filename))

    filename = save_file(avatar_file, folder)
    user.avatar_filename = filename
    db.session.commit()

    return jsonify({"success": True, "avatar_url": avatar_url_for(user)})

# =========================================================
# FRIEND REQUESTS
# =========================================================
@app.route("/friend_request/send/<int:to_user_id>", methods=["POST"])
def send_friend_request(to_user_id):
    if "user_id" not in session:
        return must_login_json()

    if to_user_id == session["user_id"]:
        return jsonify({"error": "Can't friend yourself"}), 400

    to_user = User.query.get(to_user_id)
    if not to_user:
        return jsonify({"error": "User not found"}), 404

    existing_pending = FriendRequest.query.filter_by(
        from_user_id=session["user_id"],
        to_user_id=to_user_id,
        status="pending"
    ).first()
    if existing_pending:
        return jsonify({"success": True, "message": "Already pending"})

    existing_accepted = FriendRequest.query.filter(
        FriendRequest.status == "accepted",
        or_(
            and_(FriendRequest.from_user_id == session["user_id"], FriendRequest.to_user_id == to_user_id),
            and_(FriendRequest.from_user_id == to_user_id, FriendRequest.to_user_id == session["user_id"])
        )
    ).first()
    if existing_accepted:
        return jsonify({"success": True, "message": "Already friends"})

    fr = FriendRequest(from_user_id=session["user_id"], to_user_id=to_user_id, status="pending")
    db.session.add(fr)
    db.session.commit()

    create_notification(
        user_id=to_user_id,
        type_="friend_request",
        actor_user_id=session["user_id"],
        friend_request_id=fr.id
    )

    return jsonify({"success": True})


@app.route("/friend_request/respond/<int:req_id>", methods=["POST"])
def respond_friend_request(req_id):
    if "user_id" not in session:
        return must_login_json()

    data = request.json or {}
    action = (data.get("action") or "").strip()

    fr = FriendRequest.query.get(req_id)
    if not fr:
        return jsonify({"error": "Request not found"}), 404

    if fr.to_user_id != session["user_id"]:
        return jsonify({"error": "No permission"}), 403

    if fr.status != "pending":
        return jsonify({"success": True, "message": "Already handled"})

    if action == "accept":
        fr.status = "accepted"
        fr.accepted_at = datetime.utcnow()
        db.session.commit()

        create_notification(
            user_id=fr.from_user_id,
            type_="friend_accepted",
            actor_user_id=session["user_id"],
            friend_request_id=fr.id
        )
    else:
        fr.status = "declined"
        db.session.commit()

    return jsonify({"success": True, "status": fr.status})


@app.route("/friend_request/cancel/<int:req_id>", methods=["POST"])
def cancel_friend_request(req_id):
    if "user_id" not in session:
        return must_login_json()

    fr = FriendRequest.query.get(req_id)
    if not fr:
        return jsonify({"error": "Request not found"}), 404

    if fr.from_user_id != session["user_id"]:
        return jsonify({"error": "No permission"}), 403

    if fr.status != "pending":
        return jsonify({"error": "Only pending requests can be canceled"}), 400

    db.session.delete(fr)
    db.session.commit()
    return jsonify({"success": True})


@app.route("/friend_request/unfriend/<int:other_user_id>", methods=["POST"])
def unfriend(other_user_id):
    if "user_id" not in session:
        return must_login_json()

    me_id = session["user_id"]
    if other_user_id == me_id:
        return jsonify({"error": "Can't unfriend yourself"}), 400

    fr = FriendRequest.query.filter(
        FriendRequest.status == "accepted",
        or_(
            and_(FriendRequest.from_user_id == me_id, FriendRequest.to_user_id == other_user_id),
            and_(FriendRequest.from_user_id == other_user_id, FriendRequest.to_user_id == me_id)
        )
    ).first()

    if not fr:
        return jsonify({"error": "Not friends"}), 404

    db.session.delete(fr)
    db.session.commit()
    return jsonify({"success": True})


@app.route("/friends/data")
def friends_data():
    if "user_id" not in session:
        return must_login_json()

    me_id = session["user_id"]

    incoming = FriendRequest.query.filter_by(
        to_user_id=me_id, status="pending"
    ).order_by(FriendRequest.created_at.desc()).all()

    outgoing = FriendRequest.query.filter_by(
        from_user_id=me_id, status="pending"
    ).order_by(FriendRequest.created_at.desc()).all()

    accepted_me = FriendRequest.query.filter(
        FriendRequest.status == "accepted",
        or_(FriendRequest.from_user_id == me_id, FriendRequest.to_user_id == me_id)
    ).all()

    friend_ids = set()
    friend_since_map = {}
    for fr in accepted_me:
        other = fr.from_user_id if fr.from_user_id != me_id else fr.to_user_id
        friend_ids.add(other)
        friend_since_map[other] = fr.accepted_at or fr.created_at

    pending_pairs = FriendRequest.query.filter(
        FriendRequest.status == "pending",
        or_(FriendRequest.from_user_id == me_id, FriendRequest.to_user_id == me_id)
    ).all()

    pending_ids = set()
    for fr in pending_pairs:
        pending_ids.add(fr.from_user_id if fr.from_user_id != me_id else fr.to_user_id)

    blocked_ids = friend_ids.union(pending_ids).union({me_id})
    suggestions = User.query.filter(~User.id.in_(blocked_ids)).limit(20).all()

    accepted_all = FriendRequest.query.filter(FriendRequest.status == "accepted").all()
    friends_map = {}

    def add_edge(a, b):
        friends_map.setdefault(a, set()).add(b)

    for fr in accepted_all:
        add_edge(fr.from_user_id, fr.to_user_id)
        add_edge(fr.to_user_id, fr.from_user_id)

    my_set = friends_map.get(me_id, set())

    def u_out(u):
        other_set = friends_map.get(u.id, set())
        mutual = len(my_set.intersection(other_set))
        since_dt = friend_since_map.get(u.id)
        since_str = since_dt.strftime("%b %d, %Y") if since_dt else None
        return {
            "id": u.id,
            "username": u.username,
            "avatar": avatar_url_for(u),
            "mutual_count": mutual,
            "friends_since": since_str
        }

    incoming_out = [{"id": fr.id, "user": u_out(User.query.get(fr.from_user_id))} for fr in incoming]
    outgoing_out = [{"id": fr.id, "user": u_out(User.query.get(fr.to_user_id))} for fr in outgoing]
    friends_list = User.query.filter(User.id.in_(friend_ids)).all() if friend_ids else []

    return jsonify({
        "suggestions": [u_out(u) for u in suggestions],
        "incoming": incoming_out,
        "outgoing": outgoing_out,
        "friends": [u_out(u) for u in friends_list]
    })

# =========================================================
# NOTIFICATIONS API
# =========================================================
@app.route("/notifications/counts")
def notif_counts():
    if "user_id" not in session:
        return must_login_json()

    me_id = session["user_id"]
    total = Notification.query.filter_by(user_id=me_id, is_read=False, is_dismissed=False).count()
    return jsonify({"total": total})


@app.route("/notifications/list")
def notif_list():
    if "user_id" not in session:
        return must_login_json()

    me_id = session["user_id"]
    items = Notification.query.filter_by(user_id=me_id, is_dismissed=False).order_by(Notification.id.desc()).limit(40).all()

    out = []
    for n in items:
        out.append({
            "id": n.id,
            "type": n.type,
            "is_read": bool(n.is_read),
            "created_at": n.created_at.strftime("%b %d, %Y %I:%M %p"),
            "from_user": notif_actor_dict(n.actor_user_id),
            "post_id": n.post_id,
            "friend_request_id": n.friend_request_id,
            "comment_id": n.comment_id
        })

    return jsonify({"items": out})


@app.route("/notifications/mark_all_read", methods=["POST"])
def notif_mark_all_read():
    if "user_id" not in session:
        return must_login_json()

    me_id = session["user_id"]
    Notification.query.filter_by(user_id=me_id, is_read=False, is_dismissed=False).update({"is_read": True})
    db.session.commit()
    return jsonify({"success": True})


@app.route("/notifications/mark_one_read/<int:notif_id>", methods=["POST"])
def notif_mark_one_read(notif_id):
    if "user_id" not in session:
        return must_login_json()

    me_id = session["user_id"]
    n = Notification.query.get(notif_id)
    if not n or n.user_id != me_id:
        return jsonify({"error": "Not found"}), 404

    n.is_read = True
    db.session.commit()
    return jsonify({"success": True})


@app.route("/notifications/dismiss/<int:notif_id>", methods=["POST"])
def notif_dismiss(notif_id):
    if "user_id" not in session:
        return must_login_json()

    me_id = session["user_id"]
    n = Notification.query.get(notif_id)
    if not n or n.user_id != me_id:
        return jsonify({"error": "Not found"}), 404

    n.is_dismissed = True
    db.session.commit()
    return jsonify({"success": True})

# =========================================================
# EVENTS API
# =========================================================
@app.route("/api/events")
@login_required
def api_events():
    me_id = session["user_id"]
    all_events = Event.query.order_by(Event.date.asc(), Event.id.asc()).all()

    out = []
    for e in all_events:
        payload = event_payload_for_user(e, me_id)
        visibility = (e.visibility or "public").lower()
        is_host = payload["is_host"]
        is_invited = payload["is_invited"]
        rsvp_val = (payload["rsvp"] or "maybe").lower()

        should_show_on_calendar = False

        if is_host:
            should_show_on_calendar = True
        elif visibility == "private":
            should_show_on_calendar = is_invited
        elif visibility == "friends":
            should_show_on_calendar = is_invited or are_friends(me_id, e.host_id)
        elif visibility == "public":
            should_show_on_calendar = is_invited or (rsvp_val == "yes")

        if should_show_on_calendar:
            out.append(payload)

    return jsonify(out)


@app.route("/api/events/discover")
@login_required
def api_events_discover():
    me_id = session["user_id"]
    all_events = Event.query.filter_by(visibility="public").order_by(Event.date.asc(), Event.id.asc()).all()

    out = []
    for e in all_events:
        payload = event_payload_for_user(e, me_id)

        if payload["is_host"]:
            continue
        if payload["is_invited"]:
            continue
        if (payload["rsvp"] or "maybe").lower() == "yes":
            continue

        out.append(payload)

    return jsonify(out)


@app.route("/api/events/mine")
@login_required
def api_events_mine():
    me_id = session["user_id"]
    all_events = Event.query.order_by(Event.date.asc(), Event.id.asc()).all()

    hosting = []
    invited = []
    going = []

    for e in all_events:
        payload = event_payload_for_user(e, me_id)

        if payload["is_host"]:
            hosting.append(payload)
            continue

        if payload["is_invited"]:
            invited.append(payload)

        if (payload["rsvp"] or "maybe").lower() == "yes":
            going.append(payload)

    return jsonify({
        "hosting": hosting,
        "invited": invited,
        "going": going
    })


@app.route("/api/events/create", methods=["POST"])
@login_required
def api_create_event():
    me_id = session["user_id"]

    title = (request.form.get("title") or "").strip()
    description = (request.form.get("description") or "").strip()
    date_str = (request.form.get("date") or "").strip()

    start_time = (request.form.get("start_time") or request.form.get("time") or "").strip()
    location = (request.form.get("location") or "").strip()

    visibility = (request.form.get("visibility") or "public").strip().lower()
    if visibility not in ("public", "friends", "private"):
        visibility = "public"

    theme = (request.form.get("theme") or "").strip().lower()
    allowed_themes = {"birthday", "wedding", "prom", "concert", "church"}
    if theme and theme not in allowed_themes:
        theme = ""

    if not title or not date_str:
        return jsonify({"error": "Title + date required"}), 400

    try:
        event_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    except Exception:
        return jsonify({"error": "Bad date"}), 400

    banner_file = request.files.get("banner")
    banner_url = None
    if banner_file and banner_file.filename:
        folder = os.path.join(app.config["UPLOAD_BASE"], "event_banners")
        os.makedirs(folder, exist_ok=True)
        filename = save_file(banner_file, folder)
        banner_url = f"/{folder}/{filename}".replace("\\", "/")

    e = Event(
        title=title,
        description=description,
        date=event_date,
        time=start_time,
        location=location,
        visibility=visibility,
        theme=theme,
        banner_image=banner_url,
        host_id=me_id
    )
    db.session.add(e)
    db.session.commit()

    return jsonify({"success": True, "id": e.id})


@app.route("/api/events/<int:event_id>/rsvp", methods=["POST"])
@login_required
def api_event_rsvp(event_id):
    me_id = session["user_id"]
    e, err = get_event_or_404_viewable(event_id, me_id)
    if err:
        return err

    data = request.json or {}
    val = (data.get("rsvp") or "").strip().lower()
    if val not in ("yes", "maybe", "no"):
        return jsonify({"error": "Bad rsvp"}), 400

    row = EventRSVP.query.filter_by(event_id=event_id, user_id=me_id).first()
    if not row:
        row = EventRSVP(event_id=event_id, user_id=me_id, rsvp=val, updated_at=datetime.utcnow())
        db.session.add(row)
    else:
        row.rsvp = val
        row.updated_at = datetime.utcnow()

    db.session.commit()
    return jsonify({"success": True, "rsvp": val})


@app.route("/api/events/<int:event_id>/invite-friends")
@login_required
def api_event_invite_friends(event_id):
    me_id = session["user_id"]
    e = Event.query.get(event_id)
    if not e:
        return jsonify({"error": "Event not found"}), 404

    if not can_view_event(e, me_id):
        return jsonify({"error": "No permission"}), 403

    is_host = (e.host_id == me_id)
    inviter_is_invited = is_invited_to_event(e.id, me_id)

    accepted_rows = FriendRequest.query.filter(
        FriendRequest.status == "accepted",
        or_(
            FriendRequest.from_user_id == me_id,
            FriendRequest.to_user_id == me_id
        )
    ).all()

    friend_ids = []
    for fr in accepted_rows:
        other_id = fr.to_user_id if fr.from_user_id == me_id else fr.from_user_id
        friend_ids.append(other_id)

    if not friend_ids:
        return jsonify({"friends": []})

    friends = User.query.filter(User.id.in_(friend_ids)).order_by(User.username.asc()).all()

    out = []
    for u in friends:
        existing_invite = EventInvite.query.filter_by(event_id=e.id, user_id=u.id).first()

        can_invite_this_friend = False
        if is_host:
            can_invite_this_friend = True
        else:
            if e.visibility == "public":
                can_invite_this_friend = True
            else:
                if inviter_is_invited and are_friends(me_id, u.id):
                    can_invite_this_friend = True

        out.append({
            "id": u.id,
            "username": u.username,
            "avatar": avatar_url_for(u),
            "name": u.username,
            "invited": existing_invite is not None,
            "can_invite": can_invite_this_friend
        })

    return jsonify({"friends": out})


@app.route("/api/events/<int:event_id>/invite", methods=["POST"])
@login_required
def api_event_invite(event_id):
    me_id = session["user_id"]
    e = Event.query.get(event_id)
    if not e:
        return jsonify({"error": "Event not found"}), 404

    if not can_view_event(e, me_id):
        return jsonify({"error": "No permission"}), 403

    data = request.json or {}
    user_id = data.get("user_id")
    username = (data.get("username") or "").strip()

    u = None
    if user_id:
        try:
            u = User.query.get(int(user_id))
        except Exception:
            return jsonify({"error": "Bad user id"}), 400
    elif username:
        u = User.query.filter_by(username=username).first()
    else:
        return jsonify({"error": "User required"}), 400

    if not u:
        return jsonify({"error": "User not found"}), 404

    if u.id == me_id:
        return jsonify({"error": "You can't invite yourself"}), 400

    is_host = (e.host_id == me_id)
    inviter_is_invited = is_invited_to_event(e.id, me_id)

    if not is_host:
        if e.visibility != "public":
            if not inviter_is_invited:
                return jsonify({"error": "Only invited users can invite"}), 403
            if not are_friends(me_id, u.id):
                return jsonify({"error": "You can only invite your friends"}), 403

    existing = EventInvite.query.filter_by(event_id=e.id, user_id=u.id).first()
    if existing:
        return jsonify({"success": True, "message": "Already invited"})

    inv = EventInvite(event_id=e.id, user_id=u.id, status="invited")
    db.session.add(inv)
    db.session.commit()
    return jsonify({"success": True})


@app.route("/api/events/<int:event_id>/guests")
@login_required
def api_event_guests(event_id):
    me_id = session["user_id"]
    e, err = get_event_or_404_viewable(event_id, me_id)
    if err:
        return err

    invites = EventInvite.query.filter_by(event_id=event_id).all()
    out = []

    for inv in invites:
        u = User.query.get(inv.user_id)
        if not u:
            continue

        rsvp_row = EventRSVP.query.filter_by(event_id=event_id, user_id=u.id).first()
        rsvp_val = (rsvp_row.rsvp if rsvp_row else "maybe").lower()

        out.append({
            "id": u.id,
            "username": u.username,
            "avatar": avatar_url_for(u),
            "invite_status": inv.status or "invited",
            "rsvp": rsvp_val
        })

    host_user = User.query.get(e.host_id)
    if host_user:
        host_rsvp_row = EventRSVP.query.filter_by(event_id=event_id, user_id=host_user.id).first()
        host_rsvp = (host_rsvp_row.rsvp if host_rsvp_row else "yes").lower()

        already_in = any(int(x["id"]) == int(host_user.id) for x in out)
        if not already_in:
            out.insert(0, {
                "id": host_user.id,
                "username": host_user.username,
                "avatar": avatar_url_for(host_user),
                "invite_status": "host",
                "rsvp": host_rsvp
            })

    return jsonify({"guests": out})


@app.route("/api/events/<int:event_id>/updates")
@login_required
def api_event_updates(event_id):
    me_id = session["user_id"]
    e, err = get_event_or_404_viewable(event_id, me_id)
    if err:
        return err

    updates = EventUpdate.query.filter_by(event_id=event_id).order_by(EventUpdate.id.desc()).all()
    out = []
    for u in updates:
        author = User.query.get(u.author_id)
        out.append({
            "id": u.id,
            "author": author.username if author else "Host",
            "created_at": u.created_at.strftime("%b %d, %Y %I:%M %p"),
            "text": u.text or "",
            "photo_url": u.photo_url or "",
            "can_edit": (me_id == e.host_id) or (me_id == u.author_id)
        })

    return jsonify(out)


@app.route("/api/events/<int:event_id>/updates/create", methods=["POST"])
@login_required
def api_event_updates_create(event_id):
    me_id = session["user_id"]
    e = Event.query.get(event_id)
    if not e:
        return jsonify({"error": "Event not found"}), 404
    if e.host_id != me_id:
        return jsonify({"error": "Only host can post updates"}), 403

    text = (request.form.get("text") or "").strip()
    photo = request.files.get("photo")

    if not text and not (photo and photo.filename):
        return jsonify({"error": "Nothing to post"}), 400

    photo_url = None
    if photo and photo.filename:
        folder = os.path.join(app.config["UPLOAD_BASE"], "event_updates")
        os.makedirs(folder, exist_ok=True)
        filename = save_file(photo, folder)
        photo_url = f"/{folder}/{filename}".replace("\\", "/")

    upd = EventUpdate(
        event_id=event_id,
        author_id=me_id,
        text=text or "",
        photo_url=photo_url,
        created_at=datetime.utcnow()
    )
    db.session.add(upd)
    db.session.commit()

    return jsonify({"success": True, "id": upd.id})


@app.route("/api/events/<int:event_id>/updates/<int:update_id>/edit", methods=["POST"])
@login_required
def api_event_updates_edit(event_id, update_id):
    me_id = session["user_id"]
    e = Event.query.get(event_id)
    if not e:
        return jsonify({"error": "Event not found"}), 404

    upd = EventUpdate.query.get(update_id)
    if not upd or upd.event_id != event_id:
        return jsonify({"error": "Update not found"}), 404

    if me_id != e.host_id and me_id != upd.author_id:
        return jsonify({"error": "No permission"}), 403

    data = request.json or {}
    new_text = (data.get("text") or "").strip()
    if not new_text:
        return jsonify({"error": "Text required"}), 400

    upd.text = new_text
    db.session.commit()
    return jsonify({"success": True})


@app.route("/api/events/<int:event_id>/updates/<int:update_id>/delete", methods=["POST"])
@login_required
def api_event_updates_delete(event_id, update_id):
    me_id = session["user_id"]
    e = Event.query.get(event_id)
    if not e:
        return jsonify({"error": "Event not found"}), 404

    upd = EventUpdate.query.get(update_id)
    if not upd or upd.event_id != event_id:
        return jsonify({"error": "Update not found"}), 404

    if me_id != e.host_id and me_id != upd.author_id:
        return jsonify({"error": "No permission"}), 403

    if upd.photo_url and upd.photo_url.startswith("/static/uploads/"):
        local_path = upd.photo_url.lstrip("/")
        delete_file_if_exists(local_path)

    db.session.delete(upd)
    db.session.commit()
    return jsonify({"success": True})

# =========================================================
# MESSAGES HELPERS
# =========================================================
active_ws = {}


def ws_send_to_user(user_id, payload):
    try:
        user_id = int(user_id)
    except Exception:
        return False

    ws = active_ws.get(user_id)
    if not ws:
        return False

    try:
        ws.send(json.dumps(payload))
        return True
    except Exception as e:
        print(f"WebSocket send failed to user {user_id}: {e}")
        try:
            if active_ws.get(user_id) is ws:
                del active_ws[user_id]
        except Exception:
            pass
        return False


def serialize_message_ws(msg, me_id):
    return {
        "id": msg.id,
        "conversation_id": msg.conversation_id,
        "sender_id": msg.sender_id,
        "body": msg.body,
        "media_url": msg.media_url,
        "media_type": msg.media_type,
        "file_name": msg.file_name,
        "is_me": msg.sender_id == me_id,
        "time_only": msg.created_at.strftime("%I:%M %p").lstrip("0") if msg.created_at else "",
        "read_status": "read" if msg.is_read else "sent"
    }

# =========================================================
# MESSAGES API
# =========================================================
@app.route("/api/messages/friends")
@login_required
def api_messages_friends():
    me_id = session["user_id"]

    accepted_rows = FriendRequest.query.filter(
        FriendRequest.status == "accepted",
        or_(
            FriendRequest.from_user_id == me_id,
            FriendRequest.to_user_id == me_id
        )
    ).all()

    friend_ids = []
    for fr in accepted_rows:
        other_id = fr.to_user_id if fr.from_user_id == me_id else fr.from_user_id
        friend_ids.append(other_id)

    if not friend_ids:
        return jsonify([])

    friends = User.query.filter(User.id.in_(friend_ids)).order_by(User.username.asc()).all()

    out = []
    for u in friends:
        conv = get_dm_conversation(me_id, u.id)
        last_message = None
        unread_count = 0

        if conv:
            last_message = Message.query.filter_by(conversation_id=conv.id) \
                .order_by(Message.created_at.desc(), Message.id.desc()) \
                .first()

            unread_count = Message.query.filter_by(
                conversation_id=conv.id,
                is_read=False
            ).filter(Message.sender_id != me_id).count()

        out.append({
            "id": u.id,
            "username": u.username,
            "avatar": avatar_url_for(u),
            "conversation_id": conv.id if conv else None,
            "last_message": last_message_preview(last_message),
            "last_message_time": (
                last_message.created_at.strftime("%I:%M %p").lstrip("0")
                if last_message else ""
            ),
            "unread_count": unread_count,
            "is_online": bool(active_ws.get(u.id))
        })

    def sort_key(x):
        has_msg = 1 if x["last_message_time"] else 0
        return (has_msg, x["conversation_id"] or 0, x["username"].lower())

    out.sort(key=sort_key, reverse=True)
    return jsonify(out)


@app.route("/api/messages/thread/<int:friend_id>")
@login_required
def api_messages_thread(friend_id):
    me_id = session["user_id"]

    if friend_id == me_id:
        return jsonify({"error": "Invalid friend"}), 400

    friend = User.query.get(friend_id)
    if not friend:
        return jsonify({"error": "User not found"}), 404

    if not are_friends(me_id, friend_id):
        return jsonify({"error": "You can only message friends"}), 403

    conv = get_or_create_dm_conversation(me_id, friend_id)

    msgs = Message.query.filter_by(conversation_id=conv.id) \
        .order_by(Message.created_at.asc(), Message.id.asc()).all()

    unread = Message.query.filter_by(
        conversation_id=conv.id,
        is_read=False
    ).filter(Message.sender_id == friend_id).all()

    changed = False
    read_ids = []

    for m in unread:
        m.is_read = True
        read_ids.append(m.id)
        changed = True

    if changed:
        db.session.commit()

        ws_send_to_user(friend_id, {
            "event": "messages_read",
            "data": {
                "by_user_id": me_id,
                "friend_id": friend_id,
                "message_ids": read_ids
            }
        })

    return jsonify({
        "conversation_id": conv.id,
        "friend": {
            "id": friend.id,
            "username": friend.username,
            "avatar": avatar_url_for(friend),
            "is_online": bool(active_ws.get(friend.id))
        },
        "messages": [serialize_message(m, me_id) for m in msgs]
    })


@app.route("/api/messages/send", methods=["POST"])
@login_required
def api_messages_send():
    me_id = session["user_id"]

    data = request.json or {}
    friend_id = data.get("friend_id")
    body = (data.get("body") or "").strip()

    if not friend_id:
        return jsonify({"error": "friend_id required"}), 400

    try:
        friend_id = int(friend_id)
    except Exception:
        return jsonify({"error": "Bad friend id"}), 400

    if friend_id == me_id:
        return jsonify({"error": "You can't message yourself"}), 400

    if not body:
        return jsonify({"error": "Message is empty"}), 400

    friend = User.query.get(friend_id)
    if not friend:
        return jsonify({"error": "User not found"}), 404

    if not are_friends(me_id, friend_id):
        return jsonify({"error": "You can only message friends"}), 403

    conv = get_or_create_dm_conversation(me_id, friend_id)

    msg = Message(
        conversation_id=conv.id,
        sender_id=me_id,
        body=body,
        media_url=None,
        media_type=None,
        file_name=None,
        is_read=False,
        created_at=datetime.utcnow()
    )
    db.session.add(msg)
    db.session.commit()

    create_notification(
        user_id=friend_id,
        type_="message",
        actor_user_id=me_id
    )

    message_payload = serialize_message_ws(msg, me_id)

    ws_send_to_user(friend_id, {
        "event": "incoming_message",
        "data": {
            "from_user_id": me_id,
            "from_name": session.get("username", "Someone"),
            "conversation_id": conv.id,
            "message": message_payload
        }
    })

    ws_send_to_user(me_id, {
        "event": "message_delivered",
        "data": {
            "message_id": msg.id,
            "conversation_id": conv.id
        }
    })

    return jsonify({
        "success": True,
        "message": message_payload,
        "conversation_id": conv.id
    })


@app.route("/api/messages/upload", methods=["POST"])
@login_required
def api_messages_upload():
    me_id = session["user_id"]

    file = request.files.get("media")
    friend_id = request.form.get("friend_id")

    if not friend_id:
        return jsonify({"ok": False, "error": "friend_id required"}), 400

    try:
        friend_id = int(friend_id)
    except Exception:
        return jsonify({"ok": False, "error": "Bad friend id"}), 400

    if friend_id == me_id:
        return jsonify({"ok": False, "error": "You can't message yourself"}), 400

    friend = User.query.get(friend_id)
    if not friend:
        return jsonify({"ok": False, "error": "User not found"}), 404

    if not are_friends(me_id, friend_id):
        return jsonify({"ok": False, "error": "You can only message friends"}), 403

    if not file or not file.filename:
        return jsonify({"ok": False, "error": "No file selected"}), 400

    if not allowed_message_file(file.filename):
        return jsonify({"ok": False, "error": "File type not allowed"}), 400

    conv = get_or_create_dm_conversation(me_id, friend_id)

    original_name = secure_filename(file.filename)
    ext = original_name.rsplit(".", 1)[1].lower()
    new_name = f"{uuid.uuid4().hex}.{ext}"
    save_path = os.path.join(app.config["MESSAGE_UPLOADS"], new_name)
    file.save(save_path)

    media_url = f"/static/message_uploads/{new_name}"
    media_type = get_message_file_kind(original_name)

    msg = Message(
        conversation_id=conv.id,
        sender_id=me_id,
        body="[media]",
        media_url=media_url,
        media_type=media_type,
        file_name=original_name,
        is_read=False,
        created_at=datetime.utcnow()
    )

    db.session.add(msg)
    db.session.commit()

    create_notification(
        user_id=friend_id,
        type_="message",
        actor_user_id=me_id
    )

    message_payload = serialize_message_ws(msg, me_id)

    ws_send_to_user(friend_id, {
        "event": "incoming_message",
        "data": {
            "from_user_id": me_id,
            "from_name": session.get("username", "Someone"),
            "conversation_id": conv.id,
            "message": message_payload
        }
    })

    ws_send_to_user(me_id, {
        "event": "message_delivered",
        "data": {
            "message_id": msg.id,
            "conversation_id": conv.id
        }
    })

    return jsonify({
        "ok": True,
        "url": media_url,
        "kind": media_type,
        "filename": original_name,
        "time_only": msg.created_at.strftime("%I:%M %p").lstrip("0"),
        "message": message_payload
    })


@app.route("/api/messages/unread-count")
@login_required
def api_messages_unread_count():
    me_id = session["user_id"]

    my_conversation_rows = ConversationParticipant.query.filter_by(user_id=me_id).all()
    conv_ids = [row.conversation_id for row in my_conversation_rows]

    if not conv_ids:
        return jsonify({"count": 0})

    count = Message.query.filter(
        Message.conversation_id.in_(conv_ids),
        Message.sender_id != me_id,
        Message.is_read == False
    ).count()

    return jsonify({"count": count})


@app.post("/api/messages/read/<int:friend_id>")
@login_required
def mark_messages_read(friend_id):
    me_id = session["user_id"]

    if friend_id == me_id:
        return jsonify({"error": "Invalid friend"}), 400

    if not are_friends(me_id, friend_id):
        return jsonify({"error": "You can only message friends"}), 403

    conv = get_or_create_dm_conversation(me_id, friend_id)

    unread = Message.query.filter_by(
        conversation_id=conv.id,
        is_read=False
    ).filter(Message.sender_id == friend_id).all()

    ids = []
    changed = False

    for msg in unread:
        msg.is_read = True
        ids.append(msg.id)
        changed = True

    if changed:
        db.session.commit()

    ws_send_to_user(friend_id, {
        "event": "messages_read",
        "data": {
            "by_user_id": me_id,
            "friend_id": friend_id,
            "message_ids": ids
        }
    })

    return jsonify({"ok": True, "message_ids": ids})

# =========================================================
# STORIES API
# =========================================================
@app.route("/api/stories", methods=["GET"])
@login_required
def api_get_stories():
    cleanup_expired_stories()

    me_id = session["user_id"]
    friend_ids = get_friends_ids(me_id)

    visible_user_ids = [me_id] + friend_ids

    active_stories = Story.query.filter(
        Story.user_id.in_(visible_user_ids),
        Story.expires_at > datetime.utcnow()
    ).order_by(Story.created_at.asc()).all()

    grouped = {}
    for story in active_stories:
        grouped.setdefault(story.user_id, []).append(story)

    story_groups = []

    if me_id in grouped:
        me_user = User.query.get(me_id)
        if me_user:
            story_groups.append(serialize_story_group(me_user, grouped[me_id], me_id))

    for user_id, stories in grouped.items():
        if user_id == me_id:
            continue

        user_obj = User.query.get(user_id)
        if user_obj:
            story_groups.append(serialize_story_group(user_obj, stories, me_id))

    return jsonify({
        "success": True,
        "stories": story_groups
    })


@app.route("/api/stories/create", methods=["POST"])
@login_required
def api_create_story():
    cleanup_expired_stories()

    me_id = session["user_id"]

    caption = request.form.get("caption", "").strip()
    text_overlay = request.form.get("text_overlay", "").strip()
    bg_color = request.form.get("bg_color", "").strip()
    uploaded_file = request.files.get("media")

    media_url = None
    media_type = "text"

    if uploaded_file and uploaded_file.filename:
        media_url, detected_type = save_story_file(uploaded_file, me_id)

        if not media_url:
            return jsonify({
                "success": False,
                "error": "Invalid story file type."
            }), 400

        media_type = detected_type

    elif not text_overlay and not caption:
        return jsonify({
            "success": False,
            "error": "Add a file, caption, or text overlay."
        }), 400

    story = Story(
        user_id=me_id,
        media_url=media_url,
        media_type=media_type,
        caption=caption,
        text_overlay=text_overlay,
        bg_color=bg_color if media_type == "text" else None,
        expires_at=get_story_expiration()
    )

    db.session.add(story)
    db.session.commit()

    return jsonify({
        "success": True,
        "message": "Story created successfully.",
        "story": serialize_story(story, me_id)
    })


@app.route("/api/stories/<int:story_id>", methods=["GET"])
@login_required
def api_get_story(story_id):
    cleanup_expired_stories()

    me_id = session["user_id"]
    friend_ids = get_friends_ids(me_id)

    story = Story.query.filter(
        Story.id == story_id,
        Story.expires_at > datetime.utcnow()
    ).first()

    if not story:
        return jsonify({
            "success": False,
            "error": "Story not found."
        }), 404

    if story.user_id != me_id and story.user_id not in friend_ids:
        return jsonify({
            "success": False,
            "error": "Not allowed to view this story."
        }), 403

    return jsonify({
        "success": True,
        "story": serialize_story(story, me_id)
    })


@app.route("/api/stories/<int:story_id>/view", methods=["POST"])
@login_required
def api_view_story(story_id):
    cleanup_expired_stories()

    me_id = session["user_id"]
    friend_ids = get_friends_ids(me_id)

    story = Story.query.filter(
        Story.id == story_id,
        Story.expires_at > datetime.utcnow()
    ).first()

    if not story:
        return jsonify({
            "success": False,
            "error": "Story not found."
        }), 404

    if story.user_id != me_id and story.user_id not in friend_ids:
        return jsonify({
            "success": False,
            "error": "Not allowed to view this story."
        }), 403

    if story.user_id != me_id:
        existing_view = StoryView.query.filter_by(
            story_id=story.id,
            viewer_id=me_id
        ).first()

        if not existing_view:
            db.session.add(StoryView(
                story_id=story.id,
                viewer_id=me_id
            ))
            db.session.commit()

    return jsonify({
        "success": True,
        "message": "Story marked as viewed."
    })


@app.route("/api/stories/<int:story_id>/viewers", methods=["GET"])
@login_required
def api_story_viewers(story_id):
    cleanup_expired_stories()

    me_id = session["user_id"]

    story = Story.query.filter(
        Story.id == story_id,
        Story.expires_at > datetime.utcnow()
    ).first()

    if not story:
        return jsonify({
            "success": False,
            "error": "Story not found."
        }), 404

    if story.user_id != me_id:
        return jsonify({
            "success": False,
            "error": "Only the owner can see viewers."
        }), 403

    viewers = StoryView.query.filter_by(story_id=story.id).order_by(StoryView.viewed_at.desc()).all()

    data = []
    for view in viewers:
        user_obj = User.query.get(view.viewer_id)
        if not user_obj:
            continue

        data.append({
            "user_id": user_obj.id,
            "username": user_obj.username,
            "profile_pic": avatar_url_for(user_obj),
            "viewed_at": view.viewed_at.isoformat() if view.viewed_at else None
        })

    return jsonify({
        "success": True,
        "viewers": data
    })


@app.route("/api/stories/<int:story_id>/delete", methods=["POST"])
@login_required
def api_delete_story(story_id):
    cleanup_expired_stories()

    me_id = session["user_id"]

    story = Story.query.get(story_id)
    if not story:
        return jsonify({
            "success": False,
            "error": "Story not found."
        }), 404

    if story.user_id != me_id:
        return jsonify({
            "success": False,
            "error": "You can only delete your own story."
        }), 403

    if story.media_url:
        file_path = story.media_url.lstrip("/")
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except Exception:
                pass

    StoryView.query.filter_by(story_id=story.id).delete()
    db.session.delete(story)
    db.session.commit()

    return jsonify({
        "success": True,
        "message": "Story deleted."
    })


@app.route("/api/stories/my", methods=["GET"])
@login_required
def api_my_stories():
    cleanup_expired_stories()

    me_id = session["user_id"]

    stories = Story.query.filter(
        Story.user_id == me_id,
        Story.expires_at > datetime.utcnow()
    ).order_by(Story.created_at.asc()).all()

    return jsonify({
        "success": True,
        "stories": [serialize_story(story, me_id) for story in stories]
    })

# =========================================================
# WEBSOCKET SIGNALING / TYPING / READS / CALLS
# =========================================================
@sock.route("/ws")
def websocket_route(ws):
    user_id = session.get("user_id")
    if not user_id:
        try:
            ws.close()
        except Exception:
            pass
        return

    user_id = int(user_id)
    active_ws[user_id] = ws

    try:
        ws.send(json.dumps({
            "event": "ws_ready",
            "data": {
                "user_id": user_id
            }
        }))
    except Exception:
        pass

    try:
        while True:
            raw = ws.receive()
            if raw is None:
                break

            try:
                packet = json.loads(raw)
            except Exception:
                continue

            event = packet.get("event")
            data = packet.get("data", {}) or {}

            if event == "join":
                active_ws[user_id] = ws

            elif event == "call_user":
                target_user_id = data.get("target_user_id")
                room = data.get("room")

                if target_user_id and room:
                    ws_send_to_user(target_user_id, {
                        "event": "incoming_call",
                        "data": {
                            "room": room,
                            "caller_id": user_id,
                            "caller_name": session.get("username", "Someone"),
                            "caller_avatar": data.get("caller_avatar", ""),
                            "type": data.get("type", "audio"),
                            "offer": data.get("offer")
                        }
                    })

            elif event == "answer_call":
                target_user_id = data.get("target_user_id")
                room = data.get("room")

                if target_user_id and room:
                    ws_send_to_user(target_user_id, {
                        "event": "call_answered",
                        "data": {
                            "room": room,
                            "answer": data.get("answer")
                        }
                    })

            elif event == "ice_candidate":
                target_user_id = data.get("target_user_id")
                candidate = data.get("candidate")
                room = data.get("room")

                if target_user_id and candidate:
                    ws_send_to_user(target_user_id, {
                        "event": "ice_candidate",
                        "data": {
                            "room": room,
                            "candidate": candidate
                        }
                    })

            elif event == "reject_call":
                target_user_id = data.get("target_user_id")
                room = data.get("room")

                if target_user_id:
                    ws_send_to_user(target_user_id, {
                        "event": "call_rejected",
                        "data": {
                            "room": room,
                            "by_user_id": user_id
                        }
                    })

            elif event == "end_call":
                target_user_id = data.get("target_user_id")
                room = data.get("room")

                if target_user_id:
                    ws_send_to_user(target_user_id, {
                        "event": "call_ended",
                        "data": {
                            "room": room,
                            "by_user_id": user_id
                        }
                    })

            elif event == "typing_start":
                to_user_id = data.get("to_user_id")

                if to_user_id:
                    ws_send_to_user(to_user_id, {
                        "event": "typing_start",
                        "data": {
                            "from_user_id": user_id,
                            "from_name": session.get("username", "Someone")
                        }
                    })

            elif event == "typing_stop":
                to_user_id = data.get("to_user_id")

                if to_user_id:
                    ws_send_to_user(to_user_id, {
                        "event": "typing_stop",
                        "data": {
                            "from_user_id": user_id
                        }
                    })

            elif event == "messages_read":
                friend_id = data.get("friend_id")

                if friend_id:
                    ws_send_to_user(friend_id, {
                        "event": "messages_read",
                        "data": {
                            "by_user_id": user_id,
                            "friend_id": friend_id,
                            "message_ids": data.get("message_ids", [])
                        }
                    })

    except Exception as e:
        print(f"WebSocket disconnected/error for user {user_id}: {e}")

    finally:
        current = active_ws.get(user_id)
        if current is ws:
            del active_ws[user_id]

# =========================================================
# PLACEHOLDER PAGES
# =========================================================
@app.route("/marketplace")
def marketplace():
    return render_template("marketplace.html")

# =========================================================
# SETTINGS PAGE
# =========================================================

@app.route("/settings")
@login_required
def settings_page():
    me = current_user()
    header_avatar = avatar_url_for(me)
    return render_template("settings.html", user=me, header_avatar=header_avatar)

@app.route("/settings/account", methods=["POST"])
@login_required
def update_account():
    user = current_user()

    data = request.json
    username = (data.get("username") or "").strip()
    email = (data.get("email") or "").strip()

    if username:
        user.username = username
    if email:
        user.email = email

    db.session.commit()
    return jsonify({"success": True})

@app.route("/settings/privacy", methods=["POST"])
@login_required
def update_privacy():
    user = current_user()
    data = request.json

    user.profile_visibility = data.get("visibility", "everyone")
    user.is_private_account = bool(data.get("private"))

    db.session.commit()
    return jsonify({"success": True})

@app.route("/settings/password", methods=["POST"])
@login_required
def change_password():
    user = current_user()
    data = request.json

    current = data.get("current")
    new = data.get("new")

    if not check_password_hash(user.password, current):
        return jsonify({"error": "Wrong password"}), 400

    user.password = generate_password_hash(new)
    db.session.commit()

    return jsonify({"success": True})

@app.route("/settings/delete-account", methods=["POST"])
@login_required
def delete_account():
    user = current_user()
    if not user:
        return jsonify({"error": "User not found"}), 404

    data = request.get_json(silent=True) or {}
    password = (data.get("password") or "").strip()

    if not password:
        return jsonify({"error": "Password required"}), 400

    if not check_password_hash(user.password, password):
        return jsonify({"error": "Wrong password"}), 400

    user_id = user.id

    # delete post files
    post_folder = user_upload_dir(user, "posts")
    avatar_folder = user_upload_dir(user, "avatars")

    for post in Post.query.filter_by(user_id=user_id).all():
        for m in post.media:
            delete_file_if_exists(os.path.join(post_folder, m.filename))

    if user.avatar_filename:
        delete_file_if_exists(os.path.join(avatar_folder, user.avatar_filename))

    # delete story files
    stories = Story.query.filter_by(user_id=user_id).all()
    for story in stories:
        if story.media_url:
            delete_file_if_exists(story.media_url.lstrip("/"))

    # delete related rows
    StoryView.query.filter_by(viewer_id=user_id).delete()
    Story.query.filter_by(user_id=user_id).delete()

    Notification.query.filter_by(user_id=user_id).delete()
    Notification.query.filter_by(actor_user_id=user_id).delete()

    Reaction.query.filter_by(user_id=user_id).delete()
    Comment.query.filter_by(user_id=user_id).delete()

    FriendRequest.query.filter(
        or_(
            FriendRequest.from_user_id == user_id,
            FriendRequest.to_user_id == user_id
        )
    ).delete(synchronize_session=False)

    EventInvite.query.filter_by(user_id=user_id).delete()
    EventRSVP.query.filter_by(user_id=user_id).delete()
    EventUpdate.query.filter_by(author_id=user_id).delete()

    events = Event.query.filter_by(host_id=user_id).all()
    for event in events:
        EventInvite.query.filter_by(event_id=event.id).delete()
        EventRSVP.query.filter_by(event_id=event.id).delete()
        EventUpdate.query.filter_by(event_id=event.id).delete()
        db.session.delete(event)

    Message.query.filter_by(sender_id=user_id).delete()
    ConversationParticipant.query.filter_by(user_id=user_id).delete()

    Post.query.filter_by(user_id=user_id).delete()

    db.session.delete(user)
    db.session.commit()

    session.clear()
    return jsonify({"success": True, "redirect": url_for("login")})

@app.route("/settings/feedback", methods=["POST"])
@login_required
def submit_feedback():
    user = current_user()
    if not user:
        return jsonify({"error": "User not found"}), 404

    data = request.get_json(silent=True) or {}
    feedback = (data.get("feedback") or "").strip()

    if not feedback:
        return jsonify({"error": "Feedback cannot be empty"}), 400

    if len(feedback) > 5000:
        return jsonify({"error": "Feedback is too long"}), 400

    try:
        send_feedback_email(user, feedback)
    except Exception as e:
        print("Feedback email error:", e)
        return jsonify({"error": "Could not send feedback right now."}), 500

    return jsonify({"success": True, "message": "Feedback sent."})
# =========================================================
# My page info tab
# =========================================================
RESERVED_ROUTES = {
    "settings",
    "messages",
    "friends",
    "events",
    "my_page",
    "logout",
    "login",
    "signup",
    "check_username",
    "signup_finish",
    "marketplace",
    "api",
    "static"
}
@app.route("/<username>")
@login_required
def view_user(username):
    if username in RESERVED_ROUTES:
        abort(404)

    user = User.query.filter_by(username=username).first_or_404()
    current_user = User.query.get(session["user_id"])
    tab = (request.args.get("tab") or "posts").strip().lower()

    posts = Post.query.filter_by(user_id=user.id).order_by(Post.id.desc()).all()

    stats = {
        "posts": len(posts),
        "media": sum(len(p.media) for p in posts),
        "reactions": sum(len(p.reactions) for p in posts),
        "friends": FriendRequest.query.filter(
            FriendRequest.status == "accepted",
            or_(
                FriendRequest.from_user_id == user.id,
                FriendRequest.to_user_id == user.id
            )
        ).count()
    }

    header_avatar = avatar_url_for(current_user)

    return render_template(
        "mypage.html",
        user=user,
        posts=posts,
        stats=stats,
        tab=tab,
        header_avatar=header_avatar
    )

@app.route("/update_info", methods=["POST"])
@login_required
def update_info():
    user = User.query.get(session["user_id"])
    if not user:
        return jsonify({"error": "User not found"}), 404

    birthday = (request.form.get("birthday") or "").strip()
    location = (request.form.get("location") or "").strip()

    if birthday:
        try:
            datetime.strptime(birthday, "%Y-%m-%d")
        except ValueError:
            return jsonify({"error": "Invalid birthday format"}), 400
        user.birthday = birthday
    else:
        user.birthday = None

    if len(location) > 120:
        return jsonify({"error": "Location too long (max 120)"}), 400

    user.location = location or None

    db.session.commit()

    return jsonify({
        "success": True,
        "birthday": user.birthday or "",
        "location": user.location or ""
    })


# =========================================================
# RUN
# =========================================================
if __name__ == "__main__":
    with app.app_context():
        db.create_all()
    app.run(host="127.0.0.1", port=5000, debug=False)
