# Deweys Media

Deweys Media is a full-stack Flask social media platform with authentication, posts, messaging, stories, notifications, and file uploads.

---

# Tech Stack

* Python (Flask)
* Flask-SQLAlchemy
* Gunicorn
* Nginx
* SQLite
* HTML / CSS / JavaScript

---

# Project Structure

```bash
/var/www/deweys-media/
├── app.py
├── wsgi.py
├── requirements.txt
├── instance/
│   └── database.db
├── static/
│   ├── uploads/
│   ├── message_uploads/
│   └── story_uploads/
├── templates/
└── venv/
```

---

# 1. LOCAL DEVELOPMENT SETUP

## Install Requirements

```bash
python3 --version
pip3 --version
```

---

## Virtual Environment

```bash
python3 -m venv venv
source venv/bin/activate
```

Windows:

```cmd
python -m venv venv
venv\Scripts\activate
```

---

---

## Required Folders

```bash
mkdir -p instance
mkdir -p static/uploads
mkdir -p static/message_uploads
mkdir -p static/story_uploads
```

---

## Environment Variables

```bash
export FLASK_APP=app.py
export FLASK_ENV=development
export SECRET_KEY="change-this"
export DEWEYS_GMAIL_APP_PASSWORD="your-password"
```

---

## Run Dev Server

```bash
flask run
```

---

## Setup Database

```bash
python
```

```python
from app import app, db

with app.app_context():
    db.create_all()
```

---

# 2. PRODUCTION SERVER SETUP

## Install Packages

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3 python3-venv python3-pip nginx certbot python3-certbot-nginx
```

---

## Setup App

```bash
sudo mkdir -p /var/www/deweys-media
sudo chown -R $USER:$USER /var/www/deweys-media
cd /var/www/deweys-media
git clone https://github.com/yourusername/deweys-media.git .
```

---

## Virtual Env + Gunicorn

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
pip install gunicorn
```

---

## Test Gunicorn

```bash
gunicorn --bind 127.0.0.1:8001 wsgi:app
```

---

# 3. SYSTEMD SERVICE

```bash
sudo nano /etc/systemd/system/deweys-media.service
```

```ini
[Unit]
Description=Deweys Media Gunicorn
After=network.target

[Service]
User=root
Group=www-data
WorkingDirectory=/var/www/deweys-media

Environment="PATH=/var/www/deweys-media/venv/bin"
Environment="SECRET_KEY=change-this"
Environment="DEWEYS_GMAIL_APP_PASSWORD=your-password"
Environment="DEPLOY_SECRET=super-secret-key"

ExecStart=/var/www/deweys-media/venv/bin/gunicorn \
    --workers 3 \
    --bind 127.0.0.1:8001 \
    wsgi:app

Restart=always

[Install]
WantedBy=multi-user.target
```

---

## Start Service

```bash
sudo systemctl daemon-reload
sudo systemctl enable deweys-media
sudo systemctl start deweys-media
```

---

# 4. NGINX SETUP

```bash
sudo nano /etc/nginx/sites-available/deweys-media
```

```nginx
server {
    server_name yourdomain.com;

    client_max_body_size 100M;

    location /static/ {
        alias /var/www/deweys-media/static/;
    }

    location / {
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/deweys-media /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

---

# 5. SSL (HTTPS)

```bash
sudo certbot --nginx -d yourdomain.com
```

---

# 7. PERMISSIONS

```bash
sudo chown -R www-data:www-data /var/www/deweys-media
sudo chmod -R 755 /var/www/deweys-media
```

---

# 8. TROUBLESHOOTING

```bash
sudo systemctl status deweys-media
sudo journalctl -u deweys-media -f
sudo nginx -t
```

---

# DONE

Your app will be live at:
(Your domain)
[https://deweys-media.deweyshosting.com:8081/]
