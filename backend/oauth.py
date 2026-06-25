"""Shared Authlib OAuth instance — initialized via oauth.init_app(app) in app.py."""
from authlib.integrations.flask_client import OAuth

oauth = OAuth()
