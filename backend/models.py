from __future__ import annotations

from datetime import datetime

from backend.database import db


class User(db.Model):
    __tablename__ = "users"
    __table_args__ = (
        db.CheckConstraint("role IN ('admin','editor','viewer')", name="ck_users_role"),
    )

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(254), unique=True, nullable=False, index=True)
    role = db.Column(db.String(20), nullable=False)  # admin, editor, viewer
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)


class Product(db.Model):
    __tablename__ = "products"
    __table_args__ = (
        db.CheckConstraint("scan_frequency IN ('monthly','quarterly','annual')", name="ck_products_scan_frequency"),
    )

    id = db.Column(db.String(100), primary_key=True)  # URL-safe slug
    name = db.Column(db.String(100), nullable=False)
    owner = db.Column(db.String(100), nullable=False)
    owner_email = db.Column(db.String(254), nullable=False)
    env = db.Column(db.String(100), nullable=False)
    subscription_ids = db.Column(db.JSON, nullable=False, default=list)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    scan_frequency = db.Column(db.String(20), nullable=False, default="quarterly")  # monthly, quarterly, annual
    # Denormalized for fast listing — kept in sync on every save/delete.
    latest_version = db.Column(db.String(20), nullable=True)
    latest_risk_score = db.Column(db.Integer, nullable=True)

    snapshots = db.relationship(
        "ReportSnapshot", back_populates="product",
        cascade="all, delete-orphan", order_by="ReportSnapshot.id",
    )
    memory_entries = db.relationship(
        "ProductMemoryEntry", back_populates="product",
        cascade="all, delete-orphan",
    )


class ReportSnapshot(db.Model):
    __tablename__ = "report_snapshots"
    __table_args__ = (
        db.UniqueConstraint("product_id", "version"),
        db.CheckConstraint("status IN ('draft','published')", name="ck_snapshots_status"),
        db.CheckConstraint("version_type IN ('major','minor','draft')", name="ck_snapshots_version_type"),
    )

    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.String(100), db.ForeignKey("products.id"), nullable=False, index=True)
    version = db.Column(db.String(20), nullable=False)
    report_version = db.Column(db.String(20), nullable=False, default="1.0")
    version_notes = db.Column(db.Text, nullable=True)
    version_type = db.Column(db.String(20), nullable=False)  # major, minor, draft
    status = db.Column(db.String(20), nullable=False, default="draft", index=True)  # draft, published
    saved_at = db.Column(db.DateTime, nullable=False)
    published_at = db.Column(db.DateTime, nullable=True, index=True)
    risk_score = db.Column(db.Integer, nullable=False, default=0)
    # Full snapshot payload minus findings (stored separately) and minus version metadata.
    snapshot_data = db.Column(db.JSON, nullable=False, default=dict)

    product = db.relationship("Product", back_populates="snapshots")
    findings = db.relationship(
        "Finding", back_populates="snapshot",
        cascade="all, delete-orphan",
    )


class Finding(db.Model):
    __tablename__ = "findings"

    id = db.Column(db.Integer, primary_key=True)
    snapshot_id = db.Column(db.Integer, db.ForeignKey("report_snapshots.id"), nullable=False, index=True)
    # Indexed columns for efficient risk-score calculation and future cross-snapshot queries.
    severity = db.Column(db.String(20), nullable=True, index=True)
    exception_active = db.Column(db.Boolean, nullable=False, default=False, index=True)
    # Full finding payload (includes all dynamic Wiz fields: policies, resourceId, etc.)
    finding_data = db.Column(db.JSON, nullable=False, default=dict)

    snapshot = db.relationship("ReportSnapshot", back_populates="findings")


class ProductMemoryEntry(db.Model):
    __tablename__ = "product_memory_entries"
    __table_args__ = (
        db.UniqueConstraint("product_id", "subscription", "title"),
        db.CheckConstraint("source IN ('excepted','deleted')", name="ck_memory_source"),
    )

    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.String(100), db.ForeignKey("products.id"), nullable=False, index=True)
    subscription = db.Column(db.String(200), nullable=False)
    title = db.Column(db.String(500), nullable=False)
    reason = db.Column(db.String(1000), nullable=True)
    source = db.Column(db.String(20), nullable=False, default="excepted")  # excepted, deleted

    product = db.relationship("Product", back_populates="memory_entries")
