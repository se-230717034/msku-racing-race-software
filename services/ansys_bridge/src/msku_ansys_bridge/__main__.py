from __future__ import annotations

import os
import secrets

import uvicorn


def main() -> None:
    token = os.getenv("MSKU_ANSYS_BRIDGE_TOKEN", "").strip()
    if len(token) < 32:
        token = secrets.token_urlsafe(32)
        os.environ["MSKU_ANSYS_BRIDGE_TOKEN"] = token

    print("MSKU Racing ANSYS yerel köprüsü")
    print("Adres : http://127.0.0.1:8765")
    print(f"Token : {token}")
    print("Bu token yalnızca yerel tarayıcı paneline girilmelidir; Vercel'e gönderilmez.")
    uvicorn.run(
        "msku_ansys_bridge.main:app",
        host="127.0.0.1",
        port=8765,
        log_level="info",
        access_log=False,
    )


if __name__ == "__main__":
    main()
