"""口令哈希方案（2026-09-17 升级）：全局盐 + 单轮 SHA-256 → PBKDF2-HMAC-SHA256 + 每用户随机盐。

旧方案的两个问题：
① **全局盐** —— 所有账号同一个口令就是同一个哈希（彩虹表/撞库直接可用）；
② **单轮 SHA-256** —— GPU 上每秒几十亿次，拿到库基本等于拿到明文口令。

升级要求：新格式自描述（算法 + 迭代数 + 盐，都存在哈希串里）；**旧哈希仍能登录**，
并在下次成功登录时自动升级（复用既有 `used_legacy` 迁移通道）。
"""
import hashlib

from app.db import SessionLocal
from app.models import User
from app.security import PBKDF2_PREFIX, hash_password, verify_password, verify_password_full


def test_same_password_gets_different_hashes():
    """每用户随机盐：同一口令两次哈希必须不同（旧方案是同一个）。"""
    first = hash_password("same-password")
    second = hash_password("same-password")
    assert first.startswith(PBKDF2_PREFIX + "$")
    assert first != second
    assert "same-password" not in first  # 不含明文
    assert verify_password("same-password", first)
    assert verify_password("same-password", second)
    assert not verify_password("other-password", first)


def test_hash_is_self_describing():
    """哈希串自带算法/迭代数/盐，校验方不需要外部配置就能复算。"""
    algo, iterations, salt, digest = hash_password("pw").split("$", 3)
    assert algo == PBKDF2_PREFIX
    assert int(iterations) >= 1
    assert salt and digest

    # 用哈希串里的参数复算一遍，必须与它自己一致（证明确实是 PBKDF2 而非别的算法）
    from base64 import urlsafe_b64decode

    padding = "=" * (-len(salt) % 4)
    raw_salt = urlsafe_b64decode(salt + padding)
    recomputed = hashlib.pbkdf2_hmac("sha256", b"pw", raw_salt, int(iterations))
    expected = urlsafe_b64decode(digest + "=" * (-len(digest) % 4))
    assert recomputed == expected


def test_legacy_hashes_still_verify_and_ask_for_upgrade():
    """三种旧盐（password_salt / jwt_secret / 历史硬编码）都还能登录，并被标记为"该升级"。"""
    from app.security import _LEGACY_HASH_SALTS, get_settings

    settings = get_settings()
    for salt in (settings.password_salt, settings.jwt_secret, *_LEGACY_HASH_SALTS):
        legacy = hashlib.sha256(f"{salt}::demo123".encode()).hexdigest()
        ok, used_legacy = verify_password_full("demo123", legacy)
        assert ok, f"旧盐 {salt!r} 的哈希必须仍可登录"
        assert used_legacy, "旧哈希必须被标记为需要升级"


def test_new_hash_is_not_marked_as_legacy():
    ok, used_legacy = verify_password_full("demo123", hash_password("demo123"))
    assert ok and not used_legacy


def test_malformed_hash_never_passes_and_never_raises():
    for bad in ("", "not-a-hash", f"{PBKDF2_PREFIX}$", f"{PBKDF2_PREFIX}$abc$x$y", f"{PBKDF2_PREFIX}$0$a$b"):
        ok, _ = verify_password_full("demo123", bad)
        assert ok is False


def test_legacy_row_is_upgraded_on_login(client):
    """接口级：库里的旧哈希在成功登录后被重写成新方案，且换新哈希后仍能登录。"""
    assert client.post("/api/auth/register", json={"username": "hash_up", "password": "pw123456"}).status_code == 200

    from app.security import get_settings

    legacy = hashlib.sha256(f"{get_settings().password_salt}::pw123456".encode()).hexdigest()
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == "hash_up").first()
        assert user is not None
        user.password_hash = legacy
        db.commit()
    finally:
        db.close()

    assert client.post("/api/auth/login", json={"username": "hash_up", "password": "pw123456"}).status_code == 200

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == "hash_up").first()
        assert user is not None
        assert user.password_hash.startswith(PBKDF2_PREFIX + "$"), "登录后应已升级为新方案"
        assert user.password_hash != legacy
    finally:
        db.close()

    # 升级后的哈希照常能登录（迁移不能把人锁在门外）
    assert client.post("/api/auth/login", json={"username": "hash_up", "password": "pw123456"}).status_code == 200
