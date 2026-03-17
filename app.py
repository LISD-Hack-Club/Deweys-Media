from flask import Flask, render_template, request, redirect, url_for, session, flash, jsonify
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from flask_socketio import SocketIO, emit, join_room
from sqlalchemy import or_, and_
from datetime import date, datetime
from functools import wraps
import os
import uuid

# =========================================================
# APP SETUP
# =========================================================
app = Flask(__name__)
app.secret_key = "supersecretkey"

socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///database.db"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

app.config["UPLOAD_BASE"] = "static/uploads"
os.makedirs(app.config["UPLOAD_BASE"], exist_ok=True)

app.config["MESSAGE_UPLOADS"] = "static/message_uploads"
os.makedirs(app.config["MESSAGE_UPLOADS"], exist_ok=True)

db = SQLAlchemy(app)


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


@app.context_processor
def inject_helpers():
    return dict(avatar_url=avatar_url_for, post_media_url=post_media_url_for)


# =========================================================
# MODELS
# =========================================================
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(150), unique=True, nullable=False)
    password = db.Column(db.String(200), nullable=False)

    email = db.Column(db.String(200), unique=True, nullable=True)
    birthday = db.Column(db.String(10), nullable=True)

    upload_slug = db.Column(db.String(150), unique=True, nullable=True)
    avatar_filename = db.Column(db.String(300), nullable=True)
    bio = db.Column(db.String(280), nullable=True)

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
    media_type = db.Column(db.String(50), nullable=True)   # image, video, audio, file
    file_name = db.Column(db.String(255), nullable=True)

    is_read = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


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
# BASIC PAGES
# =========================================================
@app.route("/")
def home():
    if "user_id" not in session:
        return redirect(url_for("login"))

    posts = Post.query.order_by(Post.id.desc()).all()
    me = current_user()
    header_avatar = avatar_url_for(me)

    suggestions = User.query.filter(User.id != session["user_id"]).limit(5).all()
    return render_template("home.html", posts=posts, suggestions=suggestions, header_avatar=header_avatar)


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
    email = (request.form.get("email") or "").strip()
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
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""

        user = User.query.filter_by(username=username).first()
        if user and check_password_hash(user.password, password):
            session["user_id"] = user.id
            session["username"] = user.username
            ensure_user_slug(user)
            return redirect(url_for("home"))

        flash("Invalid login")

    return render_template("login.html")


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

# ------------------ My Page ------------------
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
def api_event_updates():
    event_id = request.view_args["event_id"]
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
            "unread_count": unread_count
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
    for m in unread:
        m.is_read = True
        changed = True

    if changed:
        db.session.commit()

    return jsonify({
        "conversation_id": conv.id,
        "friend": {
            "id": friend.id,
            "username": friend.username,
            "avatar": avatar_url_for(friend)
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

    return jsonify({
        "success": True,
        "message": serialize_message(msg, me_id),
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

    return jsonify({
        "ok": True,
        "url": media_url,
        "kind": media_type,
        "filename": original_name,
        "time_only": msg.created_at.strftime("%I:%M %p").lstrip("0"),
        "message": serialize_message(msg, me_id)
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


# =========================================================
# SOCKET.IO CALL / VIDEO
# =========================================================
@socketio.on("connect")
def handle_connect():
    if "user_id" in session:
        join_room(f"user_{session['user_id']}")


@socketio.on("join_call_room")
def handle_join_call_room(data):
    room = (data or {}).get("room")
    if room:
        join_room(room)


@socketio.on("call_user")
def handle_call_user(data):
    data = data or {}
    target_user_id = data.get("target_user_id")
    room = data.get("room")

    if not target_user_id or not room:
        return

    emit("incoming_call", {
        "room": room,
        "caller_name": session.get("username", "Someone"),
        "type": data.get("type", "audio"),
        "offer": data.get("offer")
    }, room=f"user_{target_user_id}")


@socketio.on("answer_call")
def handle_answer_call(data):
    data = data or {}
    room = data.get("room")
    if not room:
        return

    emit("call_answered", {
        "answer": data.get("answer")
    }, room=room, include_self=False)


@socketio.on("ice_candidate")
def handle_ice_candidate(data):
    data = data or {}
    room = data.get("room")
    if not room:
        return

    emit("ice_candidate", {
        "candidate": data.get("candidate")
    }, room=room, include_self=False)


@socketio.on("reject_call")
def handle_reject_call(data):
    data = data or {}
    room = data.get("room")
    if not room:
        return

    emit("call_rejected", {}, room=room, include_self=False)


@socketio.on("end_call")
def handle_end_call(data):
    data = data or {}
    room = data.get("room")
    if not room:
        return

    emit("call_ended", {}, room=room, include_self=False)

# =========================================================
# Marketplace API
# =========================================================
@app.route("/marketplace")
def marketplace():
    return render_template("marketplace.html")
# =========================================================
# RUN
# =========================================================
if __name__ == "__main__":
    with app.app_context():
        db.create_all()
    socketio.run(
        app,
        host="0.0.0.0",
        port=5000,
        debug=True,
        ssl_context="adhoc"
    )